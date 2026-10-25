import '@xterm/xterm/css/xterm.css'
import './styles.css'
import type { Api } from '../preload'
import { createBoard } from './board'
import { createChatView } from './chatview'
import { closePicker, pickerOpen } from './colorpicker'
import { applySettings, createSettings, mergeSettings } from './settings'
import type { SessionInfo } from '../scanner.mts'
import { DEFAULT_TERM_FONT, defaultSettings, type ChatInfo, type Settings } from '../types'

const api = (window as unknown as { api: Api }).api
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const homeView = $('home'), chatSection = $('chat')

const ICONS = {
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/></svg>',
  arrange: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="1.6"/><rect x="1.8" y="1.8" width="3.4" height="3" rx="0.8"/><rect x="10.8" y="1.8" width="3.4" height="3" rx="0.8"/><rect x="1.8" y="11.2" width="3.4" height="3" rx="0.8"/><rect x="10.8" y="11.2" width="3.4" height="3" rx="0.8"/><path d="M5.2 4.3L6.9 6.9M10.8 4.3L9.1 6.9M5.2 11.7L6.9 9.1M10.8 11.7L9.1 9.1"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
}
$('gear').innerHTML = ICONS.gear
$('arrange').innerHTML = ICONS.arrange
$('back').innerHTML = `${ICONS.back}Board`

let chats: ChatInfo[] = []
let settings: Settings = defaultSettings
let lastChatId: string | null = null // the chat you were last viewing: shift-click opens another beside it

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const nameOf = (c: ChatInfo) => board.titleOf(c.sessionId) ?? base(c.cwd)

// ---- terminal fonts: Terminal.app's SF Mono, the system's monospace fonts, and any font files in ~/Library/Fonts
// (Chromium can't use those by name, so each file is loaded as a web font and kept only if it really is monospace)
const measure = document.createElement('canvas').getContext('2d')!
const width = (family: string, text: string) => { measure.font = `16px "${family}", serif`; return measure.measureText(text).width }
const isMono = (family: string) => {
  const w = width(family, 'i')
  return Math.abs(w - width(family, 'W')) < 0.5 && Math.abs(w - width(family, 'm')) < 0.5 && Math.abs(w - width('Definitely Not A Font', 'i')) > 0.5 // equal widths, and not just the fallback
}
async function loadFonts(): Promise<string[]> {
  const system = new Set<string>()
  try {
    const all = await (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts?.()
    for (const f of all ?? []) if (!/wingdings|webdings|dingbats|symbol/i.test(f.family) && isMono(f.family)) system.add(f.family)
  } catch { /* no permission: fall back to the usual suspects */ }
  if (!system.size) for (const f of ['Menlo', 'Monaco', 'Courier New', 'Andale Mono', 'PT Mono']) if (isMono(f)) system.add(f)
  const user: string[] = []
  const files = await api.listFonts().catch(() => [])
  await Promise.all(files.map(async (f) => {
    try {
      const face = new FontFace(f.name, `url("${f.regular}")`, { weight: '400' })
      document.fonts.add(await face.load())
      if (!isMono(f.name)) { document.fonts.delete(face); return }
      if (f.bold) document.fonts.add(await new FontFace(f.name, `url("${f.bold}")`, { weight: '700' }).load().catch(() => face))
      user.push(f.name)
    } catch { /* unreadable or not a font */ }
  }))
  return [...system, ...user.sort((x, y) => x.localeCompare(y))].filter((n) => n !== DEFAULT_TERM_FONT)
}
const fontsReady = loadFonts()

// ---- the chat view: one terminal, or two side by side
const chatPanes = createChatView({
  api,
  wrap: $('wrap'),
  chats: () => chats,
  settings: () => settings,
  nameOf,
  fontsReady: () => fontsReady,
  onEmpty: () => back(), // closing the last pane goes back to the board
  onActive: () => syncBar(),
})

function syncBar() {
  const c = chats.find((x) => x.id === chatPanes.activeId())
  $('chat-name').textContent = c ? nameOf(c) : ''
  $('chat-path').textContent = c?.cwd ?? ''
  $('chat-dot').className = `dot s-${c?.status ?? 'ended'}`
  chatPanes.sync()
}

/** Show a chat in the chat view: focus it if it is already on screen, beside the focused one (split), or replacing it. */
async function showChat(id: string, o: { split?: boolean } = {}) {
  homeView.hidden = true
  chatSection.hidden = false
  closePopover()
  closeSplitMenu()
  await chatPanes.open(id, o)
}

// A chat that ended can be resumed; "show" does that first. Errors (folder gone, claude missing) land in the new-chat bar.
async function show(c: ChatInfo, o: { split?: boolean } = {}) {
  if (c.status === 'ended' && c.resumable) {
    const r = await api.resumeChat(c.sessionId)
    if (!r.ok) return showError(r.error)
    return showChat(r.id, o)
  }
  return showChat(c.id, o)
}
function showError(message: string) {
  if (!form.classList.contains('open')) togglePopover()
  cmdError.textContent = message
}

// Starting a chat can fail (claude missing, bad folder, spawn error): say so in the new-chat bar instead of silently doing nothing.
async function startChat(cwd: string) {
  const r = await api.newChat(cwd)
  if (r.ok) { closePopover(); return showChat(r.id) }
  showError(r.error)
}

// From the board. Shift-click (or Shift+Enter) opens the chat beside the one you were last viewing.
async function openFromBoard(id: string, beside = false) {
  if (beside && lastChatId && lastChatId !== id && chats.some((c) => c.id === lastChatId)) {
    await showChat(lastChatId)
    await showChat(id, { split: true })
  } else await showChat(id)
}
async function resumeFromBoard(sessionId: string, beside = false) {
  const r = await api.resumeChat(sessionId)
  if (r.ok) return openFromBoard(r.id, beside)
  showError(r.error)
}

function back() {
  if (chatSection.hidden) return
  const leaving = chats.find((c) => c.id === chatPanes.activeId())
  if (leaving) lastChatId = leaving.id
  chatPanes.closeAll() // the ptys keep running and buffering in main
  closeSplitMenu()
  chatSection.hidden = true
  homeView.hidden = false
  if (leaving) board.reveal(leaving.sessionId)
}

// ---- split: pick the chat to show beside the focused one
const splitMenu = $('split-menu')
function closeSplitMenu() { splitMenu.classList.remove('open') }
function toggleSplitMenu() {
  if (splitMenu.classList.contains('open')) return closeSplitMenu()
  const open = new Set(chatPanes.ids())
  const options = chats.filter((c) => !open.has(c.id) && (c.status !== 'ended' || c.resumable))
  splitMenu.replaceChildren(...(options.length ? options.map((c) => {
    const row = document.createElement('div')
    row.className = 'menu-item'
    const dot = document.createElement('span'), name = document.createElement('span'), meta = document.createElement('small')
    dot.className = `dot s-${c.status}`
    name.className = 'menu-name'
    name.textContent = nameOf(c)
    meta.textContent = c.status === 'ended' ? '↻ resume' : base(c.cwd)
    row.append(dot, name, meta)
    row.onclick = () => { closeSplitMenu(); void show(c, { split: true }) }
    return row
  }) : [Object.assign(document.createElement('div'), { className: 'menu-msg', textContent: 'No other chats to show beside this one.' })]))
  splitMenu.classList.add('open')
}
$('split').onclick = toggleSplitMenu

const board = createBoard($('board'), { open: openFromBoard, resume: resumeFromBoard, kill: (id) => void api.killChat(id), newIn: (cwd) => void startChat(cwd), answer: (id, q, yes) => void api.answerPrompt(id, q, yes ? 'yes' : 'no'), save: (l) => void api.saveLayout(l) })

// ---- settings: applied live, saved shortly after the last change
let saveTimer = 0
function onSettings(s: Settings, persist = true) {
  settings = s
  board.setOptions({ cardW: s.cardW, cardH: s.cardH, curved: s.curved, grid: s.grid, smooth: s.motion })
  chatPanes.applySettings()
  if (!persist) return
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void api.saveSettings(s), 300)
}
const drawer = createSettings($('settings'), settings, onSettings)
fontsReady.then((list) => drawer.setFonts(list)).catch(() => {})
// ---- filter: type to dim the chats that don't match; Enter jumps to the next match; the toggle hides ended chats
const filter = $<HTMLInputElement>('filter'), filterCount = $('filter-count'), hideEnded = $('hide-ended')
function refreshCount() {
  if (!filter.value.trim()) { filterCount.textContent = ''; return }
  const { matches, total } = board.counts()
  filterCount.textContent = `${matches} of ${total}`
}
function syncHideEnded() {
  hideEnded.classList.toggle('on', board.hideEnded())
  hideEnded.setAttribute('aria-pressed', String(board.hideEnded()))
}
filter.oninput = () => { board.setQuery(filter.value); refreshCount() }
filter.onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); board.nextMatch(e.shiftKey ? -1 : 1) }
  else if (e.key === 'Escape') { filter.value = ''; board.setQuery(''); refreshCount(); filter.blur() }
}
hideEnded.onclick = () => { board.setHideEnded(!board.hideEnded()); syncHideEnded(); refreshCount() }

$('arrange').onclick = () => board.arrange()
$('gear').onclick = () => { closePopover(); drawer.toggle() }

// ---- new chat: a one-line "cd" bar, with a folder picker as the fallback
const form = $('newchat'), cmd = $<HTMLInputElement>('cmd'), cmdError = $('cmd-error')
function closePopover() { form.classList.remove('open'); picker.classList.remove('open'); cmdError.textContent = '' }
function togglePopover() {
  const open = !form.classList.contains('open')
  closePopover()
  if (open) { drawer.close(); form.classList.add('open'); cmd.focus() }
}
$('new').onclick = togglePopover

// ---- add an existing chat: search Claude Code's history, add it as a gray resumable card
const picker = $('picker'), search = $<HTMLInputElement>('search'), results = $('results'), pickerNote = $('picker-note')
const NOTE = pickerNote.textContent!
let history: SessionInfo[] = []
let shown: SessionInfo[] = []
let hi = 0
const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}
function renderResults() {
  const q = search.value.trim().toLowerCase()
  shown = history.filter((s) => !q || `${s.title} ${s.cwd}`.toLowerCase().includes(q)).slice(0, 60)
  hi = Math.max(0, Math.min(hi, shown.length - 1))
  if (!shown.length) { results.replaceChildren(Object.assign(document.createElement('div'), { className: 'results-msg', textContent: history.length ? 'No chats match.' : 'No other chats found.' })); return }
  results.replaceChildren(...shown.map((s, i) => {
    const row = document.createElement('div')
    row.className = `result${i === hi ? ' on' : ''}`
    const title = document.createElement('b'), meta = document.createElement('small')
    title.textContent = s.title
    meta.textContent = `${s.cwd} · ${s.messageCount} msgs · ${ago(s.mtimeMs)}`
    row.append(title, meta)
    row.onmouseenter = () => { hi = i; for (const [j, r] of [...results.children].entries()) r.classList.toggle('on', j === i) }
    row.onclick = () => addChat(s)
    return row
  }))
  results.children[hi]?.scrollIntoView({ block: 'nearest' })
}
async function addChat(s: SessionInfo) {
  const r = await api.addChat(s.sessionId)
  if (r.ok) { closePopover(); board.reveal(s.sessionId); return }
  pickerNote.textContent = r.error
  pickerNote.classList.add('err')
}
async function togglePicker() {
  const open = !picker.classList.contains('open')
  closePopover()
  if (!open) return
  drawer.close()
  pickerNote.textContent = NOTE
  pickerNote.classList.remove('err')
  picker.classList.add('open')
  search.value = ''
  search.focus()
  results.replaceChildren(Object.assign(document.createElement('div'), { className: 'results-msg', textContent: 'Scanning your chats…' }))
  history = await api.listHistory()
  hi = 0
  renderResults()
}
$('add').onclick = togglePicker
search.oninput = () => { hi = 0; renderResults() }
search.onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); renderResults() }
  else if (e.key === 'Enter' && shown[hi]) addChat(shown[hi])
}
cmd.oninput = () => { cmdError.textContent = '' }
form.onsubmit = async (e) => {
  e.preventDefault()
  const r = await api.resolveDir(cmd.value)
  if (!r.ok) { cmdError.textContent = r.error; return }
  cmd.value = ''
  await startChat(r.path)
}
$('browse').onclick = async () => {
  const cwd = await api.pickFolder()
  if (cwd) await startChat(cwd)
}
$('board').addEventListener('pointerdown', () => { closePopover(); drawer.close() })

api.onPtyData((id, d) => chatPanes.write(id, d))
api.onOpenChat((id) => { const c = chats.find((x) => x.id === id); if (c) void showChat(c.id) }) // a notification was clicked
api.onChatsChanged((c) => { chats = c; board.setChats(c); syncBar(); refreshCount() })
$('back').onclick = back

// ⌘1-9: jump to the nth chat from anywhere, including from inside another chat. Holding ⌘ shows the numbers.
function jumpTo(n: number) {
  const c = chats.find((x) => x.sessionId === board.order()[n])
  if (!c) return
  if (chatSection.hidden) board.activateAt(n)
  else void show(c) // already on screen: focus it; otherwise it takes the focused pane's place
}
const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
window.addEventListener('keyup', (e) => { if (e.key === 'Meta') board.showKeys(false) }, true)
window.addEventListener('blur', () => board.showKeys(false))

window.addEventListener('keydown', (e) => {
  if (e.key === 'Meta' && chatSection.hidden) board.showKeys(true)
  if (e.metaKey && e.shiftKey && e.code === 'KeyB') { e.preventDefault(); back(); return }
  if (e.metaKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); jumpTo(+e.code.slice(5) - 1); return }
  if (!chatSection.hidden) { // in a chat: ⌘F finds in the terminal, ⌘\ opens the split menu (everything else belongs to the terminal)
    if (e.metaKey && e.code === 'KeyF') { e.preventDefault(); chatPanes.find.open() }
    else if (e.metaKey && e.code === 'Backslash') { e.preventDefault(); toggleSplitMenu() }
    else if (e.key === 'Escape') closeSplitMenu()
    return
  }
  // board navigation (never while typing in a box, and never in the terminal)
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !typing()) {
    if (ARROWS[e.key]) { e.preventDefault(); board.moveSelection(ARROWS[e.key]); return }
    if (e.key === 'Tab') { e.preventDefault(); board.cycleSelection(e.shiftKey ? -1 : 1); return }
    if (e.key === 'Enter' && board.selectedId()) { e.preventDefault(); board.activateSelected(e.shiftKey); return }
  }
  if (e.metaKey && e.code === 'KeyN') { e.preventDefault(); togglePopover() }
  else if (e.metaKey && e.code === 'KeyF') { e.preventDefault(); filter.focus(); filter.select() }
  else if (e.metaKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); board.arrange() }
  else if (e.metaKey && e.code === 'KeyO') { e.preventDefault(); togglePicker() }
  else if (e.metaKey && e.code === 'Digit0') { e.preventDefault(); board.fitAll() }
  else if (e.metaKey && e.code === 'Comma') { e.preventDefault(); closePopover(); drawer.toggle() }
  else if (e.key === 'Escape') { closePopover(); board.clearSelection(); if (pickerOpen()) closePicker(); else drawer.close() }
}, true)

// A file dropped anywhere but a terminal pane must do nothing (by default the browser would open it).
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// Without claude on PATH nothing can start; tell the user up front rather than on first click.
async function checkClaude() {
  const r = await api.claudeStatus()
  $('banner').hidden = r.ok
  if (!r.ok) $('banner-text').textContent = `${r.error}. Install Claude Code and make sure \`claude\` works in a new Terminal window, then press Retry.`
}
$('banner-retry').onclick = checkClaude
checkClaude()

Promise.all([api.loadSettings(), api.loadLayout(), api.listChats()]).then(([s, l, c]) => {
  settings = mergeSettings(s)
  applySettings(settings)
  onSettings(settings, false) // board options; nothing changed, so nothing to save
  drawer.set(settings)
  chats = c
  board.setLayout(l); board.setChats(c)
  syncHideEnded(); refreshCount()
})
