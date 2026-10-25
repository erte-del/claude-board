import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string
  mtimeMs: number
  messageCount: number
}

type Entry = Record<string, any>

// Claude names each project folder after the launch cwd with every non-alphanumeric char turned into '-'.
// Lossy to decode, but cheap to check a candidate cwd against.
export const encodeCwd = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

// Injected pseudo-messages (slash-command echoes, reminders) are not what the user typed.
const NOT_A_PROMPT = /^<(local-command|command-|system-reminder|bash-)|^\[Request interrupted/

function userText(e: Entry): string | null {
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.find((b) => b?.type === 'text' && typeof b.text === 'string')?.text ?? null
  return null
}

const oneLine = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** projectDir is the folder name under ~/.claude/projects; used to pick the right cwd. */
export function parseTranscript(text: string, projectDir: string) {
  const cwds: string[] = []
  let relocated: string | null = null
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let firstPrompt: string | null = null
  let prompts = 0
  const assistantIds = new Set<string>()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e: Entry
    try { e = JSON.parse(line) } catch { continue } // truncated/partial last line while claude is writing
    if (!e || typeof e !== 'object') continue

    if (typeof e.cwd === 'string' && e.cwd) cwds.push(e.cwd)
    if (e.type === 'relocated' && typeof e.relocatedCwd === 'string') relocated = e.relocatedCwd
    else if (e.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle) customTitle = e.customTitle
    else if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle) aiTitle = e.aiTitle
    else if (e.isSidechain || e.isMeta) continue
    else if (e.type === 'user') {
      const t = userText(e)
      if (t && !NOT_A_PROMPT.test(t.trimStart())) {
        prompts++
        firstPrompt ??= t
      }
    } else if (e.type === 'assistant') assistantIds.add(e.message?.id ?? e.uuid ?? String(assistantIds.size))
  }

  // cwd changes mid-session when Claude cd's, so prefer the one matching the project folder (where --resume looks).
  const cwd = cwds.find((c) => encodeCwd(c) === projectDir) ?? relocated ?? cwds[0] ?? null
  const picked = customTitle ?? aiTitle ?? firstPrompt
  return { cwd, title: picked ? oneLine(picked) : '(empty)', messageCount: prompts + assistantIds.size }
}

// Re-parsing 200MB every few seconds is wasteful; only files whose mtime/size changed get re-read.
const cache = new Map<string, { mtimeMs: number; size: number; info: SessionInfo | null }>()

export async function scanSessions(root = path.join(os.homedir(), '.claude', 'projects')): Promise<SessionInfo[]> {
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const out: SessionInfo[] = []
  await Promise.all(dirs.filter((d) => d.isDirectory()).map(async (d) => {
    const files = (await readdir(path.join(root, d.name)).catch(() => [])).filter((f) => f.endsWith('.jsonl'))
    await Promise.all(files.map(async (f) => {
      const file = path.join(root, d.name, f)
      try {
        const st = await stat(file)
        let hit = cache.get(file)
        if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
          const p = parseTranscript(await readFile(file, 'utf8'), d.name)
          const info = p.cwd ? { sessionId: f.slice(0, -'.jsonl'.length), cwd: p.cwd, title: p.title, mtimeMs: st.mtimeMs, messageCount: p.messageCount } : null
          cache.set(file, (hit = { mtimeMs: st.mtimeMs, size: st.size, info }))
        }
        if (hit.info) out.push(hit.info)
      } catch { /* unreadable or vanished mid-scan: skip */ }
    }))
  }))
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function groupByCwd(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const m = new Map<string, SessionInfo[]>()
  for (const s of sessions) m.set(s.cwd, [...(m.get(s.cwd) ?? []), s])
  return m
}
