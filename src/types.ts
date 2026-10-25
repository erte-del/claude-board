// working = Claude is producing output; waiting = a tool call is pending and the terminal went quiet (permission prompt / question);
// idle = turn finished; limit = a usage limit was hit (applies to every live chat); ended = process exited
export type Status = 'working' | 'idle' | 'waiting' | 'limit' | 'ended'
export type SubInfo = { id: string; title: string; status: Status; feed: string[] }
import type { PermMode, WaitKind } from './screen.mts'
export type ChatInfo = {
  id: string
  cwd: string
  sessionId: string
  status: Status
  model: string | null
  branch: string | null
  tps: number | null
  feed: string[]
  subagents: SubInfo[]
  limitResetAt: number | null // while status is 'limit': when it lifts (epoch ms), if the notice said
  contextTokens: number | null // size of the latest request (what's in the window now)
  contextWindow: number | null // window of that model, if known
  costUSD: number | null // estimated spend, only for models with a verified price
  interrupted: boolean // idle because the user stopped the turn (Esc / Ctrl+C), not because it finished
  stalled: boolean // working for a long time with nothing new in the transcript: a hint, never a colour change
  waitKind: WaitKind | null // while waiting: a tool permission, a question, or the trust dialog (null = unknown, e.g. a tool call in flight)
  crashed: boolean // ended with an error exit (not killed by the user): the card offers Restart
  permMode: PermMode | null // from Claude Code's status line; null until it has been seen
  prompt: string | null // a tool-permission question the card can answer with Yes / No buttons, while waiting on one
  resumable: boolean // ended (or restored from a previous run) and has a transcript, so a click can resume it
}
export type Pt = { x: number; y: number }
// world coordinates: clusters[cwd] is the folder hub's centre; cards[sessionId] is the card's offset from its hub
// titles: names the user gave cards; view: where the board was panned/zoomed to (absent = keep it framed automatically)
// collapsed: folders whose cards are folded away; hideEnded: hide gray (ended / restored) cards
export type Layout = {
  clusters: Record<string, Pt>
  cards: Record<string, Pt>
  titles: Record<string, string>
  collapsed: Record<string, boolean>
  hideEnded: boolean
  notes?: Record<string, string> // sessionId -> a short note shown under the card's name
  pinned?: Record<string, boolean> // sessionId -> pinned to the top of the ⌘1–9 / Tab order
  muted?: Record<string, boolean> // sessionId -> no "finished" notifications for this chat
  view?: { x: number; y: number; k: number }
}
export const emptyLayout = (): Layout => ({ clusters: {}, cards: {}, titles: {}, collapsed: {}, hideEnded: false })

export const DEFAULT_TERM_FONT = 'Terminal (SF Mono)'
export type Theme = 'dark' | 'light' | 'midnight'
export type StateKey = 'working' | 'idle' | 'waiting' | 'limit' | 'ended'
export type KeepAwake = 'off' | 'always' | 'auto'
export type Settings = {
  theme: Theme
  colors: Record<StateKey, string> // outline / dot / line colour per status
  cardW: number
  cardH: number
  radius: number // card corner radius
  cardFont: number // card text size
  lineWidth: number
  curved: boolean // curved instead of straight links
  grid: boolean // dotted board background
  motion: boolean // easing and animations
  termFont: number // chat view font size
  termFontFamily: string // chat view font (DEFAULT_TERM_FONT = Terminal.app's SF Mono)
  notifications: boolean // macOS notification + Dock badge when a chat needs you
  quietLaunch: boolean // apps and URLs a chat opens stay behind the board (applies to chats started after the change)
  finishNotify: boolean // a notification when a chat finishes a turn (off by default)
  waitingSound: boolean // play a sound with the "needs you" notification
  quietHours: boolean // no notifications between quietStart and quietEnd
  quietStart: number // hour 0–23
  quietEnd: number
  stallMinutes: number // flag a working chat whose transcript has been silent this long as "stalled?" (0 = off)
  autoResume: boolean // resume crashed chats by themselves, at most 3 times in 10 minutes each
  keepAwake: KeepAwake // stop the Mac from sleeping: never / always / only while a chat is working
}
export const defaultSettings: Settings = {
  theme: 'dark',
  colors: { working: '#3fb950', idle: '#000000', waiting: '#f0883e', limit: '#f85149', ended: '#666666' },
  cardW: 220,
  cardH: 150,
  radius: 12,
  cardFont: 11,
  lineWidth: 2.5,
  curved: false,
  grid: true,
  motion: true,
  termFont: 12,
  termFontFamily: 'Terminal (SF Mono)',
  notifications: true,
  quietLaunch: true,
  keepAwake: 'off',
  finishNotify: false,
  waitingSound: false,
  quietHours: false,
  quietStart: 22,
  quietEnd: 8,
  stallMinutes: 10,
  autoResume: false,
}
