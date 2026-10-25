import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Notification, powerSaveBlocker, screen, session, shell } from 'electron'
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { encodeCwd, scanSessions, type SessionInfo } from './scanner.mts'
import { sanitizeLayout } from './layoutio.mts'
import { HOTKEY, winPrefs } from './winprefs.mts'
import { pushRemoved, sanitizeRemoved, takeRestorable, type Removed } from './removed.mts'
import { EDITORS, installedEditors } from './editors.mts'
import { staleImages } from './pasteimg.mts'
import { planRestart } from './restart.mts'
import { openingArgs, resolveDir } from './paths.mts'
import { sanitizeRegistry, type RegEntry } from './registry.mts'
import { SubagentWatcher, Tailer } from './tailer.mts'
import { modelFromScreen, dialogKind, permissionMode, permissionPrompt, waitingForUser, type PermMode, type WaitKind } from './screen.mts'
import { createLogger } from './logger.mts'
import { badgeText, isStalled, inQuietHours, planContext, planFinished, planLimitReset, planNotifications, wantAwake, type CtxLevel } from './attention.mts'
import { CONTEXT_WINDOW } from './pricing.mts'
import { restoreBounds } from './windowstate.mts'
import { groupFontFiles } from './fontfiles.mts'
import { quietEnv, SHIM_SCRIPT } from './quiet.mts'
import { commonBinDirs, findExecutable, parseEnv0 } from './shellenv.mts'
import { emptyLayout, type ChatInfo, type Layout, type Status, type SubInfo } from './types'

const MAX_BUFFER = 200_000

// The packaged app is named "Claude Board", which would move its data folder; keep it where `npm run dev` already uses.
// (An explicit --user-data-dir, e.g. for testing, wins.)
if (app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'claude-board'))

type Chat = {
  id: string; pty: pty.IPty; cwd: string; sessionId: string; status: Status; buffer: string
  lastData: number // last pty output that was not an echo of our own input
  lastInput: number
  tailer: Tailer
  subs: SubagentWatcher
  screen: Terminal // headless mirror of the pty, used to read what is on screen
  gitBranch: string | null
  prev?: Status // status at the previous tick, to spot transitions
  killed: boolean // ended because the user killed it
  seenReply: string | null // last reply already announced (or present before this process started), so "finished" fires once per new reply
  workingSince: number | null // when the current run of 'working' began
  forked: boolean // started as a fork: its history is copied in when the transcript first appears, and none of it is news
  ctxLevel: CtxLevel | null // context warning level last seen (null = not yet seen)
  waitKind: WaitKind | null // what the dialog blocking this chat is (set each tick while waiting)
  crashed: boolean // ended with a non-zero exit or a signal, not killed by the user
  endNote: string[] | null // what the card shows once the process is gone
  permMode: PermMode | null // last permission mode seen on the status line (kept while a dialog hides it)
  screenModel: string | null // model named on the start-up banner, used until the transcript has one
}

const chats = new Map<string, Chat>()
let win: BrowserWindow | null = null
const attached = new Set<string>() // chats currently shown in the chat view (one pane, or two side by side); empty = the board is showing
let claudeBin: string | null = null
let lastSig = ''
let confirmedQuit = false
let notifyOn = true // from settings.json (renderer's "Notify me" toggle)
let notifyPrefs = { finish: false, sound: false, quiet: false, quietStart: 22, quietEnd: 8 } // from settings.json
let stallMinutes = 10 // from settings.json: flag a working chat with a silent transcript after this long (0 = never)
let autoResume = false // from settings.json: resume crashed chats by themselves (a few times, then give up)
const restarts = new Map<string, number[]>() // sessionId -> recent auto-restart times
let keepAwake = 'off' // from settings.json: off / always / auto
let quietLaunch = true // from settings.json: chats open apps and URLs in the background
let shimOk = true // false if the shim could not be written
let blockerId: number | null = null
let lastBadge = ''
let wasLimited = false
let limitResetAt: number | null = null // when the current limit lifts, if its notice said (applies to every limited chat)
let muted: Record<string, boolean> = {} // sessionIds whose "finished" notifications are off (kept in the layout file)
let removedLog: Removed[] = [] // cards the user removed, newest last (removed.json), so "Undo" can bring them back
let titles: Record<string, string> = {} // names the user gave cards (kept in the layout file), for notification text
let stopping = false

// Chats the app started, remembered across launches. On launch each becomes a "dormant" card (no process) that a click resumes.
type Dormant = { id: string; cwd: string; sessionId: string; tailer: Tailer; subs: SubagentWatcher }
const dormant = new Map<string, Dormant>() // by sessionId
let registry: RegEntry[] = []
const transcriptFile = (cwd: string, sessionId: string) => path.join(os.homedir(), '.claude', 'projects', encodeCwd(cwd), `${sessionId}.jsonl`)

const liveChats = () => [...chats.values()].filter((c) => c.status !== 'ended')
// The window can already be gone while a pty is still exiting during shutdown.
const send = (channel: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args) }

// An app opened from the Dock or Finder gets launchd's bare environment, not the one Terminal.app builds from ~/.zshrc and
// friends. So ask the user's own shell (interactive + login, so it reads everything) for its environment, once, and use it both
// to find `claude` and as the environment of every chat: Claude's hooks, node, npx and MCP servers need the same PATH as in a terminal.
const ENV_MARKER = '__CLAUDE_BOARD_ENV__'
let shellEnv: Record<string, string> | null = null
function captureShellEnv(): Promise<void> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '%s' ${ENV_MARKER}; env -0`], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } }, (_err, stdout) => {
      const env = parseEnv0(stdout ?? '', ENV_MARKER)
      if (env?.PATH) shellEnv = env // a shell that hangs or dies leaves us with the process environment plus the usual folders
      resolve()
    })
  })
}
let envReady = captureShellEnv()

const isExecutable = (p: string) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false } }
function resolveClaude(): string {
  if (claudeBin) return claudeBin
  const found = findExecutable('claude', shellEnv?.PATH ?? process.env.PATH ?? '', commonBinDirs(os.homedir()), isExecutable)
  if (!found) throw new Error('`claude` not found on your PATH or in the usual install folders (~/.local/bin, /opt/homebrew/bin, /usr/local/bin)')
  return (claudeBin = found)
}

// The last `n` rows of what is on screen. Blank rows below the content are ignored: a chat that prints near the top of a tall,
// mostly empty terminal (an early crash message) would otherwise show nothing.
function screenBottom(c: Chat, n = 14): string[] {
  const b = c.screen.buffer.active
  const rows: string[] = []
  for (let y = b.baseY; y < b.baseY + c.screen.rows; y++) rows.push(b.getLine(y)?.translateToString(true) ?? '')
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop()
  return rows.slice(-n)
}

// The banner sits at the top of the screen; once it scrolls away or the chat ends, the value found earlier is kept.
function bannerModel(c: Chat): string | null {
  if (!c.screenModel && c.status !== 'ended') {
    const b = c.screen.buffer.active
    const rows: string[] = []
    for (let y = b.baseY; y < b.baseY + Math.min(12, c.screen.rows); y++) rows.push(b.getLine(y)?.translateToString(true) ?? '')
    c.screenModel = modelFromScreen(rows)
  }
  return c.screenModel
}

// With answer buttons on the card, the numbered options are redundant: show what is being asked (the command, the file) instead.
const dialogText = (c: Chat, forButtons = false) =>
  screenBottom(c, forButtons ? 30 : 14).map((l) => l.trim()).filter((l) => l && !/^[─━│╭╮╰╯╌\s]+$/.test(l) && !(forButtons && /^[❯>]?\s*\d+\.\s/.test(l))).slice(-8)

const summary = (c: Chat): ChatInfo => {
  const t = c.tailer.state
  // A blocking dialog isn't in the transcript yet, so show what is on screen: that is what the user is being asked.
  const prompt = c.status === 'waiting' ? permissionPrompt(screenBottom(c, 30))?.question ?? null : null
  const feed = c.status === 'waiting' ? dialogText(c, prompt !== null) : t.feed
  return { id: c.id, cwd: c.cwd, sessionId: c.sessionId, status: c.status, model: t.model ?? bannerModel(c), branch: t.branch ?? c.gitBranch, tps: t.tps, feed: c.endNote ?? feed, subagents: subagentsOf(c), ...usageOf(t, c.subs), limitResetAt: c.status === 'limit' ? limitResetAt : null, permMode: c.permMode, interrupted: c.status === 'idle' && t.interrupted, waitKind: c.waitKind, stalled: c.status === 'working' && isStalled({ status: c.status, workingSince: c.workingSince, lastGrowth: Math.max(c.tailer.lastGrowth, c.subs.lastGrowth()) }, Date.now(), stallMinutes), crashed: c.crashed, prompt, resumable: c.status === 'ended' && c.tailer.exists }
}

// A running sub-agent is working by definition; it is only "waiting" when the parent is blocked on a dialog and this one has a pending tool.
function subagentsOf(c: Chat): SubInfo[] {
  if (c.status === 'ended') return []
  return c.subs.running().map((a) => ({
    id: a.id,
    title: a.title,
    feed: a.tailer.state.feed.slice(-3),
    status: a.done ? 'ended' : c.status === 'limit' ? 'limit' : c.status === 'waiting' && a.tailer.state.pending.size > 0 ? 'waiting' : 'working',
  }))
}
// Context fill and estimated cost. Cost is null unless every message (sub-agents included) used a model with a verified price.
function usageOf(t: Tailer['state'], subs: SubagentWatcher) {
  const main = t.costUSD(), sub = subs.costUSD()
  return {
    contextTokens: t.contextTokens(),
    contextWindow: CONTEXT_WINDOW[t.lastModel() ?? ''] ?? null,
    costUSD: main !== null && sub !== null ? main + sub : null,
  }
}

const dormantInfo = (d: Dormant): ChatInfo => {
  const t = d.tailer.state
  return { id: d.id, cwd: d.cwd, sessionId: d.sessionId, status: 'ended', model: t.model, branch: t.branch, tps: t.tps, feed: t.feed.slice(-4), subagents: [], ...usageOf(t, d.subs), limitResetAt: null, permMode: null, interrupted: false, waitKind: null, stalled: false, crashed: false, prompt: null, resumable: true }
}
const allInfos = () => [...chats.values()].map(summary).concat([...dormant.values()].map(dormantInfo))
const notifyChanged = () => {
  const list = allInfos()
  lastSig = JSON.stringify(list)
  send('chats:changed', list)
}

const shimDir = () => path.join(app.getPath('userData'), 'quiet-bin')
async function writeShim() { // rewritten at every start so an update to the script reaches existing installs
  try {
    await mkdir(shimDir(), { recursive: true })
    await writeFile(path.join(shimDir(), 'open'), SHIM_SCRIPT)
    await chmod(path.join(shimDir(), 'open'), 0o755)
  } catch (e) { log(`quiet shim: ${e}`); shimOk = false; quietLaunch = false } // no shim, no PATH override: chats behave as before
}

function spawnChat(folder: string, args: string[], sessionId: string, resumed = false): string {
  const dir = resolveDir(folder)
  if (!dir.ok) throw new Error(dir.error)
  const cwd = dir.path // the real path: it is what the chat will report, and so where its transcript is filed
  const id = randomUUID()
  let env = { ...process.env, ...shellEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', CLAUDE_CODE_NO_FLICKER: '1' } as Record<string, string>
  // Don't inherit another Claude session's identity if the app was launched from inside one.
  for (const k of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN']) delete env[k]
  if (quietLaunch) env = quietEnv(env, shimDir())
  const claudePath = resolveClaude()
  const p = pty.spawn(claudePath, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd, env })
  log(`start pid=${p.pid} cwd=${cwd} ${args.join(' ')}`)
  const file = transcriptFile(cwd, sessionId)
  const chat: Chat = { id, pty: p, cwd, sessionId, status: 'working', buffer: '', lastData: Date.now(), lastInput: 0, tailer: new Tailer(file), subs: new SubagentWatcher(path.join(path.dirname(file), sessionId, 'subagents')), screen: new Terminal({ cols: 80, rows: 24, allowProposedApi: true }), gitBranch: null, killed: false, seenReply: null, workingSince: null, forked: false, ctxLevel: null, waitKind: null, crashed: false, endNote: null, screenModel: null, permMode: null, prev: undefined }
  if (resumed) { chat.tailer.catchUp(); chat.subs.catchUp() } // history is shown; its stale limit / pending-tool state is not
  // Branch for the card before the first transcript entry exists.
  execFile('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], (err, out) => { if (!err) chat.gitBranch = out.trim() })
  p.onData((d) => {
    // shortcut: slicing can cut an escape sequence in half at the buffer head; harmless in practice, fix if replay glitches
    chat.buffer = (chat.buffer + d).slice(-MAX_BUFFER)
    chat.screen.write(d)
    // Output right after a keystroke/resize is the terminal echoing or redrawing, not Claude working.
    if (Date.now() - chat.lastInput > 300) chat.lastData = Date.now()
    if (attached.has(id)) send('pty:data', id, d)
  })
  p.onExit(async ({ exitCode, signal }) => {
    await new Promise<void>((resolve) => chat.screen.write('', resolve)) // let the screen mirror parse the last output (a crash message) before it is read
    chat.tailer.poll()
    const failed = (exitCode !== 0 || !!signal) && !chat.killed // a signal death reports exit code 0 plus a signal
    const note = chat.killed ? '[chat killed]' : `[process exited${exitCode ? ` with code ${exitCode}` : ''}${signal ? `, signal ${signal}` : ''}]`
    // A crash/early exit: show what claude printed (that's the error). A normal end: show the last of the conversation.
    chat.endNote = [...(failed ? dialogText(chat).slice(-5) : chat.tailer.state.feed.slice(-4)), note]
    const line = `\r\n\x1b[2m${note}\x1b[0m\r\n` // so the chat view says so too
    chat.buffer += line
    if (attached.has(id)) send('pty:data', id, line)
    log(`exit pid=${p.pid} cwd=${cwd} code=${exitCode} signal=${signal ?? 'none'}${chat.killed ? ' (killed by user)' : ''}${failed ? `\n  screen: ${dialogText(chat).join(' | ')}` : ''}`)
    chat.status = 'ended'
    chat.crashed = failed
    chat.screen.dispose()
    notifyChanged()
    if (failed && autoResume && !stopping && chat.tailer.exists) autoRestart(chat)
  })
  if (resumed) { chat.tailer.poll(); chat.seenReply = chat.tailer.state.lastReply } // its old last reply is not news
  chats.set(id, chat)
  notifyChanged()
  return id
}

// Choosing the session id up front means the card and its transcript match exactly; no guessing from files appearing.
const newChat = (cwd: string, prompt?: unknown): { ok: true; id: string } | { ok: false; error: string } => {
  try {
    const sessionId = randomUUID()
    const id = spawnChat(cwd, ['--session-id', sessionId, ...openingArgs(prompt)], sessionId)
    registry.push({ sessionId, cwd: chats.get(id)!.cwd }) // the resolved folder: that is where the transcript is filed
    void writeJson('chats.json', registry)
    return { ok: true, id }
  } catch (e) {
    log(`newChat failed in ${cwd}: ${e instanceof Error ? e.stack : e}`)
    return { ok: false, error: e instanceof Error ? e.message : String(e) } // claude missing, bad folder, spawn failure
  }
}

// A crashed chat resumes itself after a second, at most 3 times in 10 minutes; after that the card keeps its Restart button.
function autoRestart(chat: Chat) {
  const plan = planRestart(restarts.get(chat.sessionId) ?? [], Date.now())
  if (!plan.ok) { log(`auto-restart: giving up on ${chat.sessionId} (3 restarts in 10 minutes)`); return }
  restarts.set(chat.sessionId, plan.times)
  log(`auto-restart ${plan.times.length}/3: ${chat.sessionId}`)
  setTimeout(() => { if (!stopping && chats.get(chat.id) === chat && autoResume) resumeChat(chat.sessionId) }, 1000)
}

// `claude --resume <id>` appends to the same transcript under the same id, so the card keeps its identity and position.
function resumeChat(sessionId: string): { ok: true; id: string } | { ok: false; error: string } {
  const old = [...chats.values()].find((c) => c.sessionId === sessionId)
  if (old && old.status !== 'ended') return { ok: true, id: old.id } // already running
  const cwd = dormant.get(sessionId)?.cwd ?? old?.cwd
  if (!cwd) return { ok: false, error: 'That chat is no longer on the board.' }
  if (old) chats.delete(old.id) // so two cards never share a session while the new process starts
  try {
    const id = spawnChat(cwd, ['--resume', sessionId], sessionId, true)
    dormant.delete(sessionId)
    return { ok: true, id }
  } catch (e) {
    log(`resume ${sessionId} failed: ${e instanceof Error ? e.stack : e}`)
    if (old) chats.set(old.id, old) // keep the card if resuming failed (folder gone, claude missing)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// A new chat that starts from a copy of this one's history: `claude --resume <id> --fork-session`, under a session id we choose.
function forkChat(sessionId: string): { ok: true; id: string } | { ok: false; error: string } {
  const src = [...chats.values()].find((c) => c.sessionId === sessionId)
  const cwd = dormant.get(sessionId)?.cwd ?? src?.cwd
  if (!cwd) return { ok: false, error: 'That chat is no longer on the board.' }
  if (src && !src.tailer.exists) return { ok: false, error: 'Nothing to fork yet: this chat has no messages.' }
  try {
    const newId = randomUUID()
    const id = spawnChat(cwd, ['--resume', sessionId, '--fork-session', '--session-id', newId], newId)
    chats.get(id)!.forked = true
    registry.push({ sessionId: newId, cwd: chats.get(id)!.cwd })
    void writeJson('chats.json', registry)
    return { ok: true, id }
  } catch (e) {
    log(`fork ${sessionId} failed: ${e instanceof Error ? e.stack : e}`)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Removing a card forgets the chat (its transcript stays in Claude's history); keep a record so it can come back.
function logRemoval(sessionId: string, cwd: string) {
  removedLog = pushRemoved(removedLog, { sessionId, cwd, name: titles[sessionId] || path.basename(cwd), at: Date.now() })
  void writeJson('removed.json', removedLog)
}

function forget(sessionId: string) {
  registry = registry.filter((r) => r.sessionId !== sessionId)
  void writeJson('chats.json', registry)
}

// node-pty makes the child a session leader (pgid == pid), so signalling the group also reaches hooks and MCP servers it started.
function killTree(c: Chat, sig: NodeJS.Signals) {
  try { process.kill(-c.pty.pid, sig) } catch { try { c.pty.kill(sig) } catch { /* already gone */ } }
}
function stopChat(c: Chat) {
  return new Promise<void>((resolve) => {
    c.pty.onExit(() => resolve())
    killTree(c, 'SIGHUP')
    setTimeout(() => { killTree(c, 'SIGKILL'); resolve() }, 2000) // something ignored the hangup
  })
}

function tick() {
  const live = [...chats.values()].filter((c) => c.status !== 'ended')
  for (const c of live) {
    c.tailer.poll(); c.subs.poll()
    if (c.forked && c.tailer.exists) { // the copied history arrived: forget what only matters live, like a resume does
      c.forked = false
      const s = c.tailer.state
      s.limit = null; s.limitResetAt = null; s.pending.clear()
      c.seenReply = s.lastReply
    }
  }
  // A limit holds until a normal reply clears it, or until the time its notice gave has passed (nobody has to reply for it to lift).
  const limitActive = (c: Chat) => !!c.tailer.state.limit && !(c.tailer.state.limitResetAt && Date.now() >= c.tailer.state.limitResetAt)
  const limited = live.some(limitActive)
  const resets = live.filter(limitActive).map((c) => c.tailer.state.limitResetAt).filter((t): t is number => t !== null)
  limitResetAt = limited && resets.length ? Math.min(...resets) : null
  for (const c of live) {
    c.status = limited ? 'limit'
      : Date.now() - c.lastData < 2000 ? 'working'
      : waitingForUser(screenBottom(c)) || c.tailer.state.pending.size > 0 ? 'waiting'
      : 'idle'
  }
  for (const c of live) c.workingSince = c.status === 'working' ? (c.workingSince ?? Date.now()) : null
  for (const c of live) c.waitKind = c.status === 'waiting' ? dialogKind(screenBottom(c, 30)) : null
  for (const c of live) c.permMode = permissionMode(screenBottom(c, 6)) ?? c.permMode
  attend(live, limited)
  setAwake(wantAwake(keepAwake, live))
  if (JSON.stringify(allInfos()) !== lastSig) notifyChanged()
}

function setAwake(on: boolean) {
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  else if (!on && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null }
}

function ctxWarnings(live: Chat[], enabled: boolean, watching: (id: string) => boolean) {
  const pct = (c: Chat) => { const t = c.tailer.state.contextTokens(), w = CONTEXT_WINDOW[c.tailer.state.lastModel() ?? '']; return t !== null && w ? (t / w) * 100 : null }
  const { plans, levels } = planContext(live.map((c) => ({ id: c.id, cwd: c.cwd, name: titles[c.sessionId], pct: pct(c), level: c.ctxLevel })), { enabled, watching })
  for (const c of live) if (pct(c) !== null) c.ctxLevel = levels.get(c.id) ?? c.ctxLevel // stays unseen until there is a usage figure
  return plans
}

// Tell the user when a chat needs them while they're elsewhere: a notification (click opens that chat) and a Dock badge.
function attend(live: Chat[], limited: boolean) {
  if (stopping) return // shutting down: no notifications, no badge changes
  const watching = (id: string) => !!win && win.isFocused() && (attached.size === 0 || attached.has(id)) // board visible, or that chat is on screen
  const quiet = notifyPrefs.quiet && inQuietHours(new Date().getHours(), notifyPrefs.quietStart, notifyPrefs.quietEnd)
  const enabled = notifyOn && !quiet && Notification.isSupported()
  const plans = [
    ...planNotifications(
      live.map((c) => ({ id: c.id, cwd: c.cwd, name: titles[c.sessionId], status: c.status, prev: c.prev, kind: c.waitKind, detail: c.status === 'limit' ? (c.tailer.state.limit ?? '') : dialogText(c).slice(0, 3).join(' · ') })),
      { enabled, watching },
    ),
    ...ctxWarnings(live, enabled, watching),
    ...planFinished(
      live.map((c) => ({ id: c.id, cwd: c.cwd, name: titles[c.sessionId], status: c.status, prev: c.prev, reply: c.tailer.state.lastReply, seen: c.seenReply, muted: muted[c.sessionId] })),
      { enabled: enabled && notifyPrefs.finish, watching },
    ),
  ]
  for (const c of live) if (c.prev === 'working' && c.status === 'idle') c.seenReply = c.tailer.state.lastReply // announced or not, don't announce it later
  for (const p of plans) {
    const n = new Notification({ title: p.title, body: p.body, ...(p.kind === 'waiting' ? (notifyPrefs.sound ? { sound: 'Ping' } : { silent: true }) : {}) })
    n.on('click', () => { win?.show(); win?.focus(); send('open-chat', p.chatId) })
    n.show()
  }
  const lifted = planLimitReset(wasLimited, limited, !!win && win.isFocused() && attached.size === 0, enabled, live.length > 0)
  if (lifted) new Notification(lifted).show()
  wasLimited = limited
  for (const c of live) c.prev = c.status
  const badge = notifyOn ? badgeText(live) : ''
  if (badge !== lastBadge) { lastBadge = badge; app.dock?.setBadge(badge) }
}
setInterval(tick, 500)

const userFile = (name: string) => path.join(app.getPath('userData'), name)
// Problems that would otherwise vanish: chat crashes, spawn failures, and errors in the app itself. One file, one rolled-over copy.
const log = (msg: string) => createLogger(userFile('claude-board.log'))(msg)
process.on('uncaughtException', (e) => log(`uncaughtException: ${e.stack ?? e}`))
process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e instanceof Error ? e.stack : e}`))
app.on('render-process-gone', (_e, _wc, d) => log(`renderer gone: ${d.reason} (exit ${d.exitCode})`))
app.on('child-process-gone', (_e, d) => log(`${d.type} process gone: ${d.reason} (exit ${d.exitCode})`))
const readJson = (name: string): unknown => { try { return JSON.parse(readFileSync(userFile(name), 'utf8')) } catch { return null } }
async function writeJson(name: string, data: unknown) {
  const tmp = userFile(name) + '.tmp' // write-then-rename so a crash can't leave half a file
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, userFile(name))
}

ipcMain.handle('pickFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('resolveDir', (_e, input: string) => resolveDir(input))
ipcMain.handle('claudeStatus', async () => {
  await envReady
  for (let attempt = 0; ; attempt++) {
    try { return { ok: true, path: resolveClaude() } } catch (e) {
      if (attempt > 0) return { ok: false, error: (e as Error).message }
      envReady = captureShellEnv() // not found: the user may have just fixed their shell config, so ask the shell again before giving up
      await envReady
    }
  }
})
ipcMain.handle('newChat', async (_e, cwd: string, prompt?: string) => { await envReady; return newChat(cwd, prompt) })
ipcMain.handle('openChat', (_e, id: string) => {
  const c = chats.get(id)
  if (!c) return null
  attached.add(id)
  return c.buffer
})
ipcMain.handle('listChats', () => allInfos())
ipcMain.handle('forkChat', async (_e, sessionId: string) => { await envReady; return forkChat(sessionId) })
ipcMain.handle('resumeChat', async (_e, sessionId: string) => { await envReady; return resumeChat(sessionId) })

// "Add existing chat": anything in Claude Code's history that isn't already on the board (and has at least one message).
ipcMain.handle('listHistory', async (): Promise<SessionInfo[]> => {
  const onBoard = new Set([...chats.values()].map((c) => c.sessionId).concat([...dormant.keys()]))
  return (await scanSessions()).filter((s) => s.messageCount > 0 && !onBoard.has(s.sessionId))
})
// Puts it on the board as a gray resumable card (not resumed yet: the user may still have it open elsewhere).
ipcMain.handle('addChat', async (_e, sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (dormant.has(sessionId) || [...chats.values()].some((c) => c.sessionId === sessionId)) return { ok: true }
  const s = (await scanSessions()).find((x) => x.sessionId === sessionId)
  if (!s) return { ok: false, error: 'That chat was not found in your Claude Code history.' }
  const d = makeDormant(s.cwd, s.sessionId)
  if (!d) return { ok: false, error: "Couldn't read that chat's transcript." }
  dormant.set(s.sessionId, d)
  registry.push({ sessionId: s.sessionId, cwd: s.cwd })
  void writeJson('chats.json', registry)
  notifyChanged()
  return { ok: true }
})
ipcMain.handle('loadLayout', (): Layout => ({ ...emptyLayout(), ...(readJson('board-layout.json') as object | null) }))
ipcMain.handle('saveLayout', (_e, layout: Layout) => {
  titles = layout.titles ?? {}
  muted = layout.muted ?? {}
  return writeJson('board-layout.json', layout)
})
// Export / import the board layout (positions, names, notes, pins, folds) as a JSON file the user picks. Imports are re-validated field by field.
ipcMain.handle('exportLayout', async (_e, layout: unknown): Promise<{ ok: true; path: string } | { ok: false; error?: string }> => {
  const clean = sanitizeLayout(layout)
  if (!clean) return { ok: false, error: 'Nothing to export yet.' }
  const r = await dialog.showSaveDialog(win!, { title: 'Export board layout', defaultPath: 'claude-board-layout.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return { ok: false }
  try { await writeFile(r.filePath, JSON.stringify(clean, null, 2)); return { ok: true, path: r.filePath } } catch (e) { return { ok: false, error: (e as Error).message } }
})
ipcMain.handle('importLayout', async (): Promise<{ ok: true; layout: Layout } | { ok: false; error?: string }> => {
  const r = await dialog.showOpenDialog(win!, { title: 'Import board layout', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false }
  try {
    if (statSync(r.filePaths[0]).size > 5_000_000) return { ok: false, error: 'That file is too big to be a layout.' }
    const layout = sanitizeLayout(JSON.parse(readFileSync(r.filePaths[0], 'utf8')))
    if (!layout) return { ok: false, error: "That file isn't a Claude Board layout." }
    titles = layout.titles
    muted = layout.muted ?? {}
    await writeJson('board-layout.json', layout)
    return { ok: true, layout }
  } catch (e) { return { ok: false, error: `Couldn't read that file: ${(e as Error).message}` } }
})
// Font files the user has installed (Chromium can't use ~/Library/Fonts by name, but it can load the files).
ipcMain.handle('listFonts', () => {
  const seen = new Set<string>()
  const out: { name: string; regular: string; bold?: string }[] = []
  for (const dir of [path.join(os.homedir(), 'Library', 'Fonts'), '/Library/Fonts']) {
    let files: string[]
    try { files = readdirSync(dir) } catch { continue }
    for (const g of groupFontFiles(files)) {
      if (seen.has(g.name)) continue
      seen.add(g.name)
      out.push({ name: g.name, regular: pathToFileURL(path.join(dir, g.regular)).href, bold: g.bold ? pathToFileURL(path.join(dir, g.bold)).href : undefined })
    }
  }
  return out
})
// Window and system settings. Launch at login only means something for the packaged app (unpackaged, it would register Electron itself).
let wprefs = winPrefs(null)
function toggleWindow() {
  if (!win) return
  if (win.isVisible() && win.isFocused()) app.hide()
  else { app.show(); win.show(); win.focus() }
}
function applyWindowPrefs() {
  if (win && !win.isDestroyed()) { win.setAlwaysOnTop(wprefs.alwaysOnTop); win.setOpacity(wprefs.opacity) }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: wprefs.launchAtLogin })
  globalShortcut.unregister(HOTKEY)
  if (wprefs.hotkey && !globalShortcut.register(HOTKEY, toggleWindow)) log(`global shortcut ${HOTKEY} is taken by another app`)
}

function applySettings(settings: unknown) {
  wprefs = winPrefs(settings)
  applyWindowPrefs()
  const o = settings as { stallMinutes?: number; finishNotify?: boolean; waitingSound?: boolean; quietHours?: boolean; quietStart?: number; quietEnd?: number; autoResume?: boolean; notifications?: boolean; keepAwake?: string; quietLaunch?: boolean } | null
  notifyOn = o?.notifications !== false
  keepAwake = o?.keepAwake ?? 'off'
  autoResume = o?.autoResume === true
  stallMinutes = typeof o?.stallMinutes === 'number' && o.stallMinutes >= 0 && o.stallMinutes <= 600 ? o.stallMinutes : 10
  const hour = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : d)
  notifyPrefs = { finish: o?.finishNotify === true, sound: o?.waitingSound === true, quiet: o?.quietHours === true, quietStart: hour(o?.quietStart, 22), quietEnd: hour(o?.quietEnd, 8) }
  quietLaunch = o?.quietLaunch !== false && shimOk
}
// ⌘V with an image on the clipboard: save it as a PNG/JPEG and hand back its path (the renderer types it, like a dropped file).
// Read from the clipboard here, never taken from the page, so the page can't make us write arbitrary bytes.
const pasteDir = () => path.join(os.tmpdir(), 'claude-board-paste')
async function sweepPasted() {
  try {
    const dir = pasteDir()
    const files = readdirSync(dir).map((name) => ({ name, mtimeMs: statSync(path.join(dir, name)).mtimeMs }))
    for (const n of staleImages(files, Date.now())) await rm(path.join(dir, n), { force: true })
  } catch { /* no folder yet */ }
}
ipcMain.handle('pasteImage', async () => {
  try {
    const item = (await clipboard.read()).find((it) => it.types.some((t) => t === 'image/png' || t === 'image/jpeg'))
    const type = item?.types.find((t) => t === 'image/png' || t === 'image/jpeg')
    if (!item || !type) return null
    const bytes = Buffer.from(await (await item.getType(type)).arrayBuffer())
    mkdirSync(pasteDir(), { recursive: true, mode: 0o700 })
    const file = path.join(realpathSync(pasteDir()), `paste-${randomUUID()}.${type === 'image/png' ? 'png' : 'jpg'}`)
    await writeFile(file, bytes, { mode: 0o600 })
    void sweepPasted()
    return file
  } catch (e) {
    log(`paste image failed: ${e instanceof Error ? e.stack : e}`)
    return null
  }
})
// Card menu: show a chat's folder in Finder or open it in an editor. The folder is looked up from the chat; the page only names the chat and a fixed action.
// CB_OPEN lets the smoke tests substitute a recorder for /usr/bin/open.
// A program in a chat asked to copy (OSC 52). Text only, capped; the renderer has already checked the setting.
ipcMain.handle('copyText', async (_e, text: unknown) => { if (typeof text === 'string' && text.length <= 1_000_000) await clipboard.writeText(text) })
// First-launch tour: seen once, remembered in its own file (so "Reset to defaults" doesn't bring it back).
ipcMain.handle('tourSeen', () => (readJson('tour.json') as { seen?: boolean } | null)?.seen === true)
ipcMain.handle('markTourSeen', () => writeJson('tour.json', { seen: true }))
ipcMain.handle('editors', () => installedEditors(existsSync, os.homedir()).map(({ id, label }) => ({ id, label })))
ipcMain.handle('openFolder', async (_e, sessionId: string, how: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  const cwd = [...chats.values()].find((c) => c.sessionId === sessionId)?.cwd ?? dormant.get(sessionId)?.cwd
  if (!cwd) return { ok: false, error: 'That chat is no longer on the board.' }
  if (how === 'copy') { await clipboard.writeText(cwd); return { ok: true } } // the chat's folder, never text supplied by the page
  const editor = EDITORS.find((e) => e.id === how)
  if (how !== 'finder' && !editor) return { ok: false, error: 'Unknown action.' }
  const args = editor ? ['-a', editor.app, cwd] : [cwd]
  return new Promise((resolve) => execFile(process.env.CB_OPEN || '/usr/bin/open', args, (err) => resolve(err ? { ok: false, error: `Couldn't open ${editor?.label ?? 'Finder'}: ${err.message.split('\n')[0]}` } : { ok: true })))
})
ipcMain.handle('loadSettings', () => readJson('settings.json'))
ipcMain.handle('saveSettings', (_e, settings: unknown) => {
  applySettings(settings)
  return writeJson('settings.json', settings)
})
ipcMain.handle('killChat', (_e, id: string): string | null => { // the name of the card if this removed it, else null (a kill)
  const dormantEntry = [...dormant.values()].find((d) => d.id === id)
  if (dormantEntry) { // a restored card: removing it means forgetting the chat (its transcript stays in Claude's history)
    dormant.delete(dormantEntry.sessionId)
    forget(dormantEntry.sessionId)
    logRemoval(dormantEntry.sessionId, dormantEntry.cwd)
    notifyChanged()
    return removedLog[removedLog.length - 1].name
  }
  const c = chats.get(id)
  if (!c) return null
  if (c.status === 'ended') { // already dead: this is "remove card"
    chats.delete(id)
    forget(c.sessionId)
    logRemoval(c.sessionId, c.cwd)
    attached.delete(id)
    notifyChanged()
    return removedLog[removedLog.length - 1].name
  }
  c.killed = true
  killTree(c, 'SIGHUP')
  return null
})
// Undo: the newest removed card whose transcript still exists comes back as a gray resumable card (title and position are still in the layout).
ipcMain.handle('undoRemove', (): { ok: true; name: string } | { ok: false } => {
  const onBoard = (s: string) => dormant.has(s) || [...chats.values()].some((c) => c.sessionId === s)
  let restored: Dormant | null = null
  const got = takeRestorable(removedLog, (e) => {
    if (onBoard(e.sessionId)) return false
    restored = makeDormant(e.cwd, e.sessionId)
    return restored !== null
  })
  removedLog = got.log
  void writeJson('removed.json', removedLog)
  if (!got.entry || !restored) return { ok: false }
  const d = restored as Dormant
  dormant.set(d.sessionId, d)
  registry.push({ sessionId: d.sessionId, cwd: d.cwd })
  void writeJson('chats.json', registry)
  notifyChanged()
  return { ok: true, name: got.entry.name }
})
ipcMain.on('pty:write', (_e, id: string, data: string) => {
  const c = chats.get(id)
  if (c && c.status !== 'ended') { c.lastInput = Date.now(); c.pty.write(data) }
})
// Yes / No from a card. The renderer names the question it was showing; the keys come from the screen as it is now, so a newer or
// different dialog is never answered by mistake, and no arbitrary keystrokes cross this boundary.
ipcMain.handle('answerPrompt', (_e, id: string, question: string, answer: 'yes' | 'no'): { ok: boolean; error?: string } => {
  const c = chats.get(id)
  const p = c && c.status !== 'ended' ? permissionPrompt(screenBottom(c, 30)) : null
  if (!c || !p || p.question !== question) return { ok: false, error: 'That question is no longer showing.' }
  log(`answer ${answer} pid=${c.pty.pid} "${p.question}"`)
  c.lastInput = Date.now()
  c.pty.write(answer === 'yes' ? p.yes : p.no)
  return { ok: true }
})
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
  const c = chats.get(id)
  if (c && c.status !== 'ended' && cols > 0 && rows > 0) { c.lastInput = Date.now(); c.pty.resize(cols, rows); c.screen.resize(cols, rows) }
})
ipcMain.on('detach', (_e, id?: string) => { if (id) attached.delete(id); else attached.clear() }) // one pane closed, or all of them

// Restore last run's chats as dormant cards. A chat that never got a message has no transcript, so there is nothing to resume.
// A restored card has no process; it reads the transcript (and its sub-agents') once for what it shows.
function makeDormant(cwd: string, sessionId: string): Dormant | null {
  const file = transcriptFile(cwd, sessionId)
  const tailer = new Tailer(file)
  tailer.catchUp()
  if (!tailer.exists) return null
  const subs = new SubagentWatcher(path.join(path.dirname(file), sessionId, 'subagents'))
  subs.catchUp()
  return { id: `dormant-${sessionId}`, cwd, sessionId, tailer, subs }
}

const realpathOr = (p: string) => { try { return realpathSync(p) } catch { return p } }

function loadRegistry() {
  const kept: RegEntry[] = []
  for (const saved of sanitizeRegistry(readJson('chats.json'))) {
    const r = { ...saved, cwd: realpathOr(saved.cwd) } // entries saved before folders were resolved may name a symlink
    const d = makeDormant(r.cwd, r.sessionId)
    if (!d) continue
    kept.push(r)
    dormant.set(r.sessionId, d)
  }
  registry = kept
  void writeJson('chats.json', registry)
}

function confirmQuit(): boolean {
  const n = liveChats().length
  if (!n) return true
  const r = dialog.showMessageBoxSync(win!, {
    type: 'warning',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: n === 1 ? '1 chat is still running.' : `${n} chats are still running.`,
    detail: 'Quitting stops them. Their transcripts stay in Claude Code history, but anything in flight is lost.',
  })
  return r === 0
}

app.whenReady().then(async () => {
  void sweepPasted()
  await writeShim()
  applySettings(readJson('settings.json'))
  const saved = readJson('board-layout.json') as { titles?: Record<string, string>; muted?: Record<string, boolean> } | null
  titles = saved?.titles ?? {}
  muted = saved?.muted ?? {}
  loadRegistry()
  removedLog = sanitizeRemoved(readJson('removed.json'))
  // The app itself makes no network requests; this makes sure nothing in the page can either.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }))

  // Reopen where the window was left (size, position, maximized), unless that spot is no longer on a connected display.
  const b = restoreBounds(readJson('window.json'), screen.getAllDisplays().map((d) => d.workArea), { width: 1200, height: 800 })
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  if (b.maximized) win.maximize()
  applyWindowPrefs()
  let boundsTimer: NodeJS.Timeout | undefined
  const rememberBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return
      void writeJson('window.json', { ...win.getNormalBounds(), maximized: win.isMaximized() })
    }, 400)
  }
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)
  win.loadFile(path.join(__dirname, 'index.html'))
  // Links clicked in the terminal open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Never navigate away from the app: a file dropped on the window would otherwise open as a page.
  win.webContents.on('will-navigate', (e, url) => { if (url !== win!.webContents.getURL()) e.preventDefault() })
  win.on('close', (e) => {
    if (confirmedQuit) return
    if (confirmQuit()) confirmedQuit = true
    else e.preventDefault()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('before-quit', (e) => {
  if (confirmedQuit) return
  if (confirmQuit()) confirmedQuit = true
  else e.preventDefault()
})
app.on('window-all-closed', () => app.quit())
// Stop every chat's process group and wait for it, so nothing is orphaned and no exit callback fires into a dead runtime.
app.on('will-quit', (e) => {
  const live = liveChats()
  if (!live.length || stopping) return
  e.preventDefault()
  stopping = true
  Promise.all(live.map(stopChat)).then(() => app.quit())
})
