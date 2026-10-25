export type AttnStatus = 'working' | 'idle' | 'waiting' | 'limit' | 'ended'
export type AttnChat = { id: string; cwd: string; name?: string; status: AttnStatus; prev?: AttnStatus; detail: string }
export type Plan = { title: string; body: string; chatId: string }

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
      out.push({ title: `${c.name || base(c.cwd)} needs you`, body: clip(c.detail) || 'Waiting for your input', chatId: c.id })
    }
  }
  const first = limited.find((c) => !opts.watching(c.id)) && limited[0]
  if (first) out.push({ title: 'Usage limit reached', body: clip(first.detail) || 'All chats are paused until it resets', chatId: first.id })
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
