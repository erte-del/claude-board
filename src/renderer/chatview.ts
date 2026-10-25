import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Api } from '../preload'
import { shellEscapePath } from '../shellpath.mts'
import { parseOsc52 } from '../osc52.mts'
import { termTheme } from '../termthemes.mts'
import { DEFAULT_TERM_FONT, type ChatInfo, type Settings } from '../types'

export const fontCss = (label: string) => (label === DEFAULT_TERM_FONT ? 'TermSF, Menlo, monospace' : `"${label}", TermSF, Menlo, monospace`)

type Pane = {
  id: string
  el: HTMLElement
  nameEl: HTMLElement
  dotEl: HTMLElement
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  ro: ResizeObserver
}

type Deps = {
  api: Api
  wrap: HTMLElement // holds the panes
  chats(): ChatInfo[]
  settings(): Settings
  nameOf(c: ChatInfo): string
  fontsReady(): Promise<unknown>
  onEmpty(): void // the last pane was closed
  onActive(): void // the active pane changed (the title bar follows it)
}

// Find highlights (xterm wants #RRGGBB here)
const DECOR = { matchBackground: '#3b4a5f', matchBorder: '#5b7aa0', matchOverviewRuler: '#5b7aa0', activeMatchBackground: '#c9772b', activeMatchBorder: '#f0883e', activeMatchColorOverviewRuler: '#f0883e' }

/** The chat view: one terminal, or two side by side, each attached to a real pty. */
export function createChatView(d: Deps) {
  const panes: Pane[] = []
  const byId = new Map<string, Pane>() // includes panes still waiting for their replay
  const opening = new Set<string>()
  let active: Pane | null = null

  // ---- find in scrollback (applies to the focused pane)
  const findEl = document.getElementById('find')!
  const findInput = document.getElementById('find-input') as HTMLInputElement
  const findCount = document.getElementById('find-count')!
  const findCase = document.getElementById('find-case')!
  let caseSensitive = false
  const findOpen = () => findEl.classList.contains('open')

  function runFind(dir: 'incremental' | 'next' | 'prev') {
    const p = active
    if (!p) return
    const q = findInput.value
    if (!q) { p.search.clearDecorations(); findCount.textContent = ''; return }
    const opts = { caseSensitive, decorations: DECOR, incremental: dir === 'incremental' }
    const found = dir === 'prev' ? p.search.findPrevious(q, opts) : p.search.findNext(q, opts)
    if (!found) findCount.textContent = 'No results'
  }
  function openFind() {
    if (!active) return
    const sel = active.term.getSelection()
    if (sel && !sel.includes('\n')) findInput.value = sel.slice(0, 200)
    findEl.classList.add('open')
    findInput.focus()
    findInput.select()
    runFind('incremental')
  }
  function closeFind() {
    findEl.classList.remove('open')
    for (const p of panes) p.search.clearDecorations()
    findCount.textContent = ''
    active?.term.focus()
  }
  findInput.oninput = () => runFind('incremental')
  findInput.onkeydown = (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? 'prev' : 'next') }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
    else if (e.metaKey && e.code === 'KeyG') { e.preventDefault(); runFind(e.shiftKey ? 'prev' : 'next') }
  }
  findCase.onclick = () => { caseSensitive = !caseSensitive; findCase.classList.toggle('on', caseSensitive); runFind('incremental') }
  document.getElementById('find-next')!.onclick = () => runFind('next')
  document.getElementById('find-prev')!.onclick = () => runFind('prev')
  document.getElementById('find-close')!.onclick = closeFind

  // ---- Shift-drag selects even while Claude Code has the mouse. xterm.js only lets Option force that on a Mac, so while a program is
  // using the mouse, a Shift press / drag / release inside a terminal is passed on as the same event with Option instead of Shift.
  const asOption = (e: MouseEvent) => new MouseEvent(e.type, { bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail, screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, altKey: true, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: false })
  let shiftDrag: Pane | null = null
  const forward = (e: MouseEvent) => {
    if (!shiftDrag || e.altKey || !e.isTrusted) return
    e.stopImmediatePropagation()
    ;(e.target as Element).dispatchEvent(asOption(e))
    if (e.type === 'mouseup') { shiftDrag.term.focus(); shiftDrag = null } // focus back in the terminal, so ⌘C copies the selection
  }
  window.addEventListener('mousedown', (e) => {
    if (!e.shiftKey || e.altKey || e.button !== 0 || !e.isTrusted) return
    const p = panes.find((x) => x.el.contains(e.target as Node))
    if (!p || p.term.modes.mouseTrackingMode === 'none') return // nothing is using the mouse: xterm's own Shift-click (extend) applies
    shiftDrag = p
    forward(e)
  }, true)
  window.addEventListener('mousemove', forward, true)
  window.addEventListener('mouseup', forward, true)

  // ---- panes
  function termOptions(s: Settings) {
    return { fontFamily: fontCss(s.termFontFamily), fontSize: s.termFont }
  }

  async function createPane(id: string): Promise<Pane> {
    await d.fontsReady().catch(() => {})
    const s = d.settings()
    await document.fonts.load(`${s.termFont}px TermSF`).catch(() => {}) // measure cells with the real font

    const el = document.createElement('div')
    el.className = 'pane'
    const head = document.createElement('div')
    head.className = 'pane-head'
    const dotEl = document.createElement('span')
    dotEl.className = 'dot'
    const nameEl = document.createElement('span')
    nameEl.className = 'pane-name'
    const close = document.createElement('button')
    close.className = 'pane-close'
    close.textContent = '✕'
    close.title = 'Close this pane (the chat keeps running)'
    head.append(dotEl, nameEl, close)
    const body = document.createElement('div')
    body.className = 'pane-body'
    const host = document.createElement('div')
    host.className = 'pane-term' // no padding here: fit measures this box
    body.append(host)
    el.append(head, body)
    d.wrap.append(el)

    const term = new Terminal({ ...termOptions(s), cursorBlink: true, macOptionIsMeta: true, macOptionClickForcesSelection: true, allowProposedApi: true, scrollback: 5000, theme: termTheme(s.termTheme) })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(host)
    try { term.loadAddon(new WebglAddon()) } catch { /* falls back to DOM renderer */ }

    // OSC 52: Claude Code copies by asking the terminal to (Terminal.app ignores that, xterm.js needs a handler). Write only, never read.
    term.parser.registerOscHandler(52, (data) => {
      const text = d.settings().osc52 ? parseOsc52(data) : null
      if (text !== null) void d.api.copyText(text)
      return true
    })

    // Shift+Enter -> ESC+CR (Claude Code's "newline"). The app's own shortcuts are not the terminal's.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) { d.api.ptyWrite(id, '\x1b\r'); return false }
      if (e.metaKey && e.shiftKey && e.code === 'KeyB') return false
      if (e.metaKey && /^Digit[1-9]$/.test(e.code)) return false // ⌘1-9 jump between chats
      if (e.metaKey && (e.code === 'KeyF' || e.code === 'KeyG')) return false // find
      return true
    })
    term.onData((data) => d.api.ptyWrite(id, data))
    term.onResize(({ cols, rows }) => d.api.ptyResize(id, cols, rows))

    const doFit = () => {
      // A hidden/collapsed container measures 0x0; never push that to the pty.
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
    }
    const ro = new ResizeObserver(doFit)
    ro.observe(host)
    doFit()

    const pane: Pane = { id, el, nameEl, dotEl, term, fit, search, ro }
    search.onDidChangeResults((r) => {
      if (pane !== active) return
      findCount.textContent = r.resultCount ? `${r.resultIndex >= 0 ? r.resultIndex + 1 : '?'}/${r.resultCount}` : findInput.value ? 'No results' : ''
    })
    el.addEventListener('pointerdown', () => { if (active !== pane) focus(pane) }, true)
    close.onclick = () => closePane(pane)

    // Dropping files types their paths at the prompt, escaped for the shell, like Terminal.app does.
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    body.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); body.classList.add('drop') } })
    body.addEventListener('dragleave', () => body.classList.remove('drop'))
    body.addEventListener('drop', (e) => {
      body.classList.remove('drop')
      if (!hasFiles(e)) return
      e.preventDefault()
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => d.api.getPathForFile(f)).filter(Boolean)
      if (!paths.length) return
      focus(pane)
      term.paste(paths.map(shellEscapePath).join(' ') + ' ') // paste (not write) so bracketed-paste mode applies, and Claude can attach an image
    })
    // ⌘V with an image on the clipboard (a screenshot) types the path of a saved copy, so Claude can attach it. Text still pastes as before.
    body.addEventListener('paste', (e) => {
      const cd = e.clipboardData
      if (!cd || !([...cd.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) || cd.getData('text/plain')) return
      e.preventDefault()
      e.stopPropagation()
      void d.api.pasteImage().then((p) => { if (p) { focus(pane); term.paste(shellEscapePath(p) + ' ') } })
    }, true)
    return pane
  }

  // Free a pane's terminal and DOM. The pty itself keeps running; `detach` tells main to stop streaming it to us.
  function release(p: Pane, detach: boolean) {
    p.ro.disconnect()
    p.term.dispose()
    p.el.remove()
    byId.delete(p.id)
    if (detach) d.api.detach(p.id)
  }
  function dispose(p: Pane, detach: boolean) {
    release(p, detach)
    const i = panes.indexOf(p)
    if (i >= 0) panes.splice(i, 1)
  }

  function layout() {
    d.wrap.classList.toggle('split', panes.length === 2)
    sync()
  }

  function focus(p: Pane) {
    if (active && active !== p) active.search.clearDecorations()
    active = p
    for (const q of panes) q.el.classList.toggle('active', q === p)
    p.term.focus()
    sync()
    d.onActive()
    if (findOpen()) runFind('incremental')
  }

  /** Show a chat: focus it if it is already on screen, add it beside the focused one (split), or replace the focused one. */
  async function open(id: string, o: { split?: boolean } = {}) {
    const ex = byId.get(id)
    if (ex) { if (panes.includes(ex)) focus(ex); return }
    if (opening.has(id)) return
    opening.add(id)
    try {
      const p = await createPane(id)
      byId.set(id, p) // data that arrives before the replay is written straight into the terminal
      if (!panes.length || !active) panes.push(p)
      else if (o.split && panes.length < 2) panes.push(p) // beside the one that is there
      else {
        // replace a pane in place: the focused one, or (split with two already open) the one that is not focused
        const old = o.split ? panes.find((q) => q !== active)! : active
        d.wrap.insertBefore(p.el, old.el)
        panes[panes.indexOf(old)] = p
        release(old, true)
      }
      layout()
      const replay = await d.api.openChat(id)
      if (replay) p.term.write(replay)
      // The replay is only the tail of what Claude Code drew, and it repaints just what changed, so the screen comes out
      // with missing letters and stray fragments. A resize makes it repaint everything; one column narrower first, because
      // a resize to the size the pty already has sends no signal.
      if (p.term.cols > 1) d.api.ptyResize(id, p.term.cols - 1, p.term.rows)
      d.api.ptyResize(id, p.term.cols, p.term.rows)
      focus(p)
    } finally {
      opening.delete(id)
    }
  }

  function closePane(p: Pane) {
    dispose(p, true)
    if (!panes.length) { active = null; closeFind(); d.onEmpty(); return }
    layout()
    focus(panes[0])
  }

  function closeAll() {
    for (const p of [...panes]) dispose(p, false)
    d.api.detach() // all of them
    active = null
    findEl.classList.remove('open')
    d.wrap.classList.remove('split')
  }

  /** Keep names and status dots in step with the chats list. */
  function sync() {
    const chats = d.chats()
    for (const p of panes) {
      const c = chats.find((x) => x.id === p.id)
      p.nameEl.textContent = c ? d.nameOf(c) : ''
      p.dotEl.className = `dot s-${c?.status ?? 'ended'}`
    }
  }

  return {
    open,
    closeAll,
    closePane: (id: string) => { const p = byId.get(id); if (p) closePane(p) },
    sync,
    count: () => panes.length,
    ids: () => panes.map((p) => p.id),
    activeId: () => active?.id ?? null,
    write(id: string, data: string) { byId.get(id)?.term.write(data) },
    applySettings() {
      const s = d.settings()
      for (const p of panes) {
        p.term.options.fontSize = s.termFont
        p.term.options.fontFamily = fontCss(s.termFontFamily)
        p.term.options.theme = termTheme(s.termTheme)
        p.fit.fit()
      }
    },
    find: { open: openFind, close: closeFind, isOpen: findOpen },
  }
}
