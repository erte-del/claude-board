export type AttnStatus = 'working' | 'idle' | 'waiting' | 'limit' | 'ended'
export type AttnChat = { id: string; cwd: string; name?: string; status: AttnStatus; prev?: AttnStatus; detail: string; kind?: 'permission' | 'question' | 'trust' | null }
const WAITING_TITLE = { permission: 'needs a Yes/No', question: 'asked you a question', trust: 'asks whether you trust this folder' }
export type Plan = { title: string; body: string; chatId: string; kind: 'waiting' | 'limit' | 'finished' | 'context' }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/**
 * Which notifications to show this tick. A chat gets one when it *becomes* waiting. A usage limit hits every chat at
 * once, so it produces a single notification however many chats turned red. Chats the user is already looking at
 * (window focused and on the board, or inside that chat) are skipped.
 */
export function planNotifications(chats: AttnChat[], opts: { enabled: boolean; watching: (id: string) => boolean }): Plan[] {
  if (!opts.enabled) return []
  const out: Plan[] = []
  const limited = chats.filter((c) => c.status === 'limit' && c.prev !== 'limit')
  for (const c of chats) {
    if (c.status === 'waiting' && c.prev !== 'waiting' && !opts.watching(c.id)) {
      out.push({ title: `${c.name || base(c.cwd)} ${c.kind ? WAITING_TITLE[c.kind] : 'needs you'}`, body: clip(c.detail) || 'Waiting for your input', chatId: c.id, kind: 'waiting' })
    }
  }
  const first = limited.find((c) => !opts.watching(c.id)) && limited[0]
  if (first) out.push({ title: 'Usage limit reached', body: clip(first.detail) || 'All chats are paused until it resets', chatId: first.id, kind: 'limit' })
  return out
}

/**
 * One notification when a usage limit lifts (by the clock or by a reply) while the user is not looking. Chats ending is not a
 * limit lifting: with no live chats left (e.g. the app is quitting) there is nothing to say.
 */
export function planLimitReset(wasLimited: boolean, limited: boolean, watching: boolean, enabled: boolean, anyLive = true): Pick<Plan, 'title' | 'body'> | null {
  if (!enabled || !wasLimited || limited || watching || !anyLive) return null
  return { title: 'Usage limit reset', body: 'Your chats can continue.' }
}

/** Dock badge: "!" while a limit is hit, otherwise how many chats are waiting for you, otherwise nothing. */
export function badgeText(chats: { status: AttnStatus }[]): string {
  if (chats.some((c) => c.status === 'limit')) return '!'
  const n = chats.filter((c) => c.status === 'waiting').length
  return n ? String(n) : ''
}

/** Whether the Mac should be kept awake: always, or only while some chat is working (a limit or waiting chat is not burning anything). */
export function wantAwake(mode: string | undefined, chats: { status: AttnStatus }[]): boolean {
  return mode === 'always' || (mode === 'auto' && chats.some((c) => c.status === 'working'))
}

export type FinishChat = { id: string; cwd: string; name?: string; status: AttnStatus; prev?: AttnStatus; reply: string | null; seen: string | null; muted?: boolean }

/** First line of a reply as notification text: markdown markers and blank lines dropped, clipped. */
export const firstLine = (reply: string) => clip((reply.split('\n').map((l) => l.replace(/^[\s#>*\-`]+/, '').trim()).find(Boolean) ?? '').replace(/`/g, ''))

/**
 * "Chat finished": a chat that goes from working to idle with a reply it has not announced yet. Muted chats and the chat you are
 * looking at are skipped; so is a reply already seen (a resumed chat's old last reply, or a turn that only ran tools).
 */
export function planFinished(chats: FinishChat[], opts: { enabled: boolean; watching: (id: string) => boolean }): Plan[] {
  if (!opts.enabled) return []
  return chats
    .filter((c) => c.prev === 'working' && c.status === 'idle' && c.reply && c.reply !== c.seen && !c.muted && !opts.watching(c.id))
    .map((c) => ({ title: `${c.name || base(c.cwd)} finished`, body: firstLine(c.reply!) || 'Done', chatId: c.id, kind: 'finished' as const }))
}

/** Whether `hour` (0–23) falls in the quiet window [start, end); the window may wrap midnight. Equal start and end means no window. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export type CtxLevel = 0 | 1 | 2 // below 80% / 80% and up / 95% and up

/** The warning level for a context fill (percent). It only steps down once the fill is 5 points under the threshold, so hovering around 80% doesn't repeat the warning. */
export function contextLevel(pct: number | null, prev: CtxLevel): CtxLevel {
  if (pct === null) return prev
  const up: CtxLevel = pct >= 95 ? 2 : pct >= 80 ? 1 : 0
  if (up >= prev) return up
  return pct >= 90 ? 2 : pct >= 75 ? 1 : 0 // fell: keep the old level until clearly below it
}

export type CtxChat = { id: string; cwd: string; name?: string; pct: number | null; level: CtxLevel | null }

/**
 * Context warnings: one when a chat first reaches 80% and one at 95%. `level` is what we last knew (null = never seen, so a chat
 * restored at 90% doesn't warn at launch). Returns the plans and each chat's new level; the caller stores the levels even when
 * nothing was shown, so a warning that was skipped (you were looking) isn't shown later.
 */
export function planContext(chats: CtxChat[], opts: { enabled: boolean; watching: (id: string) => boolean }): { plans: Plan[]; levels: Map<string, CtxLevel> } {
  const plans: Plan[] = []
  const levels = new Map<string, CtxLevel>()
  for (const c of chats) {
    const next = contextLevel(c.pct, c.level ?? 0)
    levels.set(c.id, next)
    if (c.level === null || next <= c.level || !opts.enabled || opts.watching(c.id)) continue
    plans.push({
      title: `${c.name || base(c.cwd)}: context ${next === 2 ? '95' : '80'}% full`,
      body: next === 2 ? 'Almost out of room. Compact (/compact) or start a new chat.' : 'Consider compacting (/compact) before it fills up.',
      chatId: c.id,
      kind: 'context',
    })
  }
  return { plans, levels }
}

/**
 * A chat that has looked busy for `minutes` without anything new reaching its transcript (or its sub-agents') may be hung on a dead
 * request. Only a hint: a long build or test run looks the same. 0 (or less) turns it off.
 */
export function isStalled(c: { status: AttnStatus; workingSince: number | null; lastGrowth: number }, now: number, minutes: number): boolean {
  if (!(minutes > 0) || c.status !== 'working' || c.workingSince === null) return false
  return now - Math.max(c.workingSince, c.lastGrowth) > minutes * 60_000
}
