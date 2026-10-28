import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import { contextOf, messageCost, type Usage } from './pricing.mts'
import { parseReset } from './reset.mts'

type Entry = Record<string, any>

const FEED_MAX = 12
const toolArg = (i: Entry = {}) => String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? '').replace(/\s+/g, ' ').slice(0, 80)

/** Claude Code records Esc / Ctrl+C as a user entry whose text is "[Request interrupted by user]" (or "… for tool use" when a tool was refused). */
export const isInterruptMarker = (content: unknown): boolean => {
  const texts = Array.isArray(content) ? content.map((b) => (b && b.type === 'text' ? b.text : null)) : [content]
  return texts.some((x) => typeof x === 'string' && x.startsWith('[Request interrupted by user'))
}

/** Claude Code names every chat itself (an `ai-title` entry, or `custom-title` after /rename): reuse that, capped to a few words for the card. */
export const shortTitle = (t: string | null, words = 4): string | null => t?.trim().split(/\s+/).slice(0, words).join(' ') || null

/** What a card shows, folded out of a session's transcript entries one at a time. */
export class TranscriptState {
  model: string | null = null
  branch: string | null = null
  tps: number | null = null
  feed: string[] = []
  pending = new Set<string>() // tool_use ids with no tool_result yet: Claude is running a tool or waiting for approval
  interrupted = false // the newest thing in the transcript is the user stopping the turn
  lastReply: string | null = null // the newest assistant text, in full (the card feed clips it)
  limit: string | null = null // set while the newest assistant entry is a rate-limit notice
  title: string | null = null // Claude Code's own name for the chat (custom-title beats ai-title)
  private custom = false
  limitResetAt: number | null = null // when that limit lifts (epoch ms), read from the notice; null if it gave no time
  private prevTs = 0
  // Final usage per assistant message (a message is written once per content block, each carrying the same totals).
  private usage = new Map<string, { model: string | null; u: Usage }>()
  private lastMsg: string | null = null
  private sidechain: boolean // sub-agent transcripts are all isSidechain; the main one has none
  constructor(sidechain = false) { this.sidechain = sidechain }

  /** Tokens in the context window as of the latest request, or null before the first reply. */
  contextTokens(): number | null {
    const last = this.lastMsg ? this.usage.get(this.lastMsg) : undefined
    return last ? contextOf(last.u) : null
  }
  /** Model of the latest request (what the window size depends on). */
  lastModel(): string | null {
    return (this.lastMsg && this.usage.get(this.lastMsg)?.model) || null
  }
  /** Estimated spend in USD, or null if there is no usage yet or any message used a model with no verified price. */
  costUSD(): number | null {
    if (!this.usage.size) return null
    let total = 0
    for (const { model, u } of this.usage.values()) {
      const c = messageCost(model, u)
      if (c === null) return null
      total += c
    }
    return total
  }

  private push(text: string) {
    const t = text.trim()
    if (!t) return
    this.feed.push(t.length > 300 ? t.slice(0, 299) + '…' : t)
    if (this.feed.length > FEED_MAX) this.feed.shift()
  }

  apply(e: Entry) {
    if (!e || typeof e !== 'object' || !!e.isSidechain !== this.sidechain) return
    if (typeof e.gitBranch === 'string' && e.gitBranch) this.branch = e.gitBranch
    const ts = Date.parse(e.timestamp)

    if (e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle) { this.title = e.customTitle; this.custom = true }
    else if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle && !this.custom) this.title = e.aiTitle
    else if (e.type === 'user') {
      const c = e.message?.content
      if (!e.isMeta) this.interrupted = isInterruptMarker(c)
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result') this.pending.delete(b.tool_use_id)
      if (!e.isMeta && !Number.isNaN(ts)) this.prevTs = ts
    } else if (e.type === 'assistant') {
      const m = e.message ?? {}
      const blocks: Entry[] = Array.isArray(m.content) ? m.content : []
      this.interrupted = false
      if (e.error) {
        const text = blocks.map((b) => b?.text ?? '').join(' ').trim() || String(e.error)
        if (e.error === 'rate_limit') {
          this.limit = text
          this.limitResetAt = parseReset(text, Number.isNaN(ts) ? Date.now() : ts) // anchored to when the notice was written
        }
        this.push(text)
        return
      }
      this.limit = null
      this.limitResetAt = null
      if (m.model && m.model !== '<synthetic>') this.model = m.model
      for (const b of blocks) {
        if (b?.type === 'text') { this.push(String(b.text ?? '')); if (String(b.text ?? '').trim()) this.lastReply = String(b.text).trim() }
        else if (b?.type === 'tool_use') {
          this.pending.add(b.id)
          this.push(`▸ ${b.name} ${toolArg(b.input)}`)
        }
      }
      const ur = m.usage
      if (ur) {
        const id = String(m.id ?? e.uuid ?? this.usage.size)
        const split = ur.cache_creation // 1h writes cost more than 5m ones
        const total = ur.cache_creation_input_tokens ?? 0
        const write1h = split ? (split.ephemeral_1h_input_tokens ?? 0) : total
        this.usage.set(id, { model: m.model ?? null, u: { in: ur.input_tokens ?? 0, out: ur.output_tokens ?? 0, read: ur.cache_read_input_tokens ?? 0, write1h, write5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : 0 } })
        this.lastMsg = id
      }
      // output_tokens is the message total repeated on each block; the last block's timestamp gives the best rate.
      const out = m.usage?.output_tokens
      if (out && ts && this.prevTs && ts - this.prevTs > 500) this.tps = out / ((ts - this.prevTs) / 1000)
    }
  }
}

/** Incrementally reads a growing .jsonl file and feeds complete lines to a TranscriptState. */
export class Tailer {
  readonly state: TranscriptState
  lastGrowth = 0 // when the file last got bigger (ms)
  exists = false // the transcript has been seen on disk (a chat that never got a message has none, so can't be resumed)
  private offset = 0
  private rest = Buffer.alloc(0)
  private file: string
  constructor(file: string, sidechain = false) {
    this.file = file
    this.state = new TranscriptState(sidechain)
  }

  /**
   * Read everything already on disk, then forget what only matters live: an old rate-limit notice or a tool call
   * that was pending when the last session ended must not turn a resumed or restored chat red/orange.
   */
  catchUp() {
    this.poll()
    this.state.limit = null
    this.state.limitResetAt = null
    this.state.pending.clear()
  }

  /** Returns true if new entries were applied. */
  poll(): boolean {
    let size: number
    try { size = statSync(this.file).size } catch { return false } // not written yet
    this.exists = true
    if (size === this.offset) return false
    this.lastGrowth = Date.now()
    const fd = openSync(this.file, 'r')
    try {
      const buf = Buffer.alloc(size - this.offset)
      readSync(fd, buf, 0, buf.length, this.offset)
      this.offset = size
      let data = Buffer.concat([this.rest, buf])
      const nl = data.lastIndexOf(0x0a)
      if (nl < 0) { this.rest = data; return false }
      this.rest = data.subarray(nl + 1)
      data = data.subarray(0, nl)
      for (const line of data.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try { this.state.apply(JSON.parse(line)) } catch { /* malformed line: skip */ }
      }
      return true
    } finally {
      closeSync(fd)
    }
  }
}

export type SubAgent = { id: string; title: string; done: boolean; doneAt: number; tailer: Tailer }

const STALE_MS = 15 * 60_000 // an unfinished sub-agent that hasn't written for this long is assumed dead
const LINGER_MS = 6_000 // a finished one stays visible briefly so it doesn't just vanish

/** Watches <session>/subagents/ for sub-agent transcripts and their .meta.json. */
export class SubagentWatcher {
  private agents = new Map<string, SubAgent>()
  private dir: string
  constructor(dir: string) { this.dir = dir }

  poll() {
    let names: string[]
    try { names = readdirSync(this.dir) } catch { return } // no sub-agents yet
    for (const n of names) {
      const m = /^agent-(.+)\.jsonl$/.exec(n)
      if (!m) continue
      let a = this.agents.get(m[1])
      if (!a) this.agents.set(m[1], (a = { id: m[1], title: 'sub-agent', done: false, doneAt: 0, tailer: new Tailer(path.join(this.dir, n), true) }))
      a.tailer.poll()
      if (a.done) continue
      try {
        const metaFile = path.join(this.dir, `agent-${m[1]}.meta.json`)
        const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
        a.title = String(meta.description || meta.agentType || a.title)
        if (meta.finished === true) { a.done = true; a.doneAt = statSync(metaFile).mtimeMs }
      } catch { /* meta not written yet */ }
    }
  }

  /** Spend of every sub-agent seen so far (running or finished), or null if any of it can't be priced. */
  costUSD(): number | null {
    let total = 0
    for (const a of this.agents.values()) {
      const c = a.tailer.state.costUSD()
      if (a.tailer.state.contextTokens() !== null && c === null) return null
      total += c ?? 0
    }
    return total
  }

  /** Sub-agents already on disk belong to a past process: they are dead, whatever their meta says. */
  catchUp() {
    this.poll()
    for (const a of this.agents.values()) { a.done = true; a.doneAt = 0 }
  }

  /** When any sub-agent transcript last grew (0 if none): a chat whose helpers are busy isn't stalled. */
  lastGrowth(): number { return Math.max(0, ...[...this.agents.values()].map((a) => a.tailer.lastGrowth)) }

  running(now = Date.now()): SubAgent[] {
    return [...this.agents.values()].filter((a) => (a.done ? now - a.doneAt < LINGER_MS : now - a.tailer.lastGrowth < STALE_MS))
  }
}
