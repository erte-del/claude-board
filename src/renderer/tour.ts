const STEPS: [string, string][] = [
  ['All your Claude Code chats, one board', 'Each card is a real `claude` running in a terminal. The outline colour says what it is doing: green working, black idle, orange waiting for you, red usage limit, gray ended.'],
  ['Start or add a chat', '⌘N starts a chat in a folder: type a path like `cd`, and optionally an opening prompt. ⌘O adds a chat from your Claude Code history.'],
  ['Open, answer, switch', 'Click a card to open its terminal, ⌘⇧B comes back. A card waiting on a permission has Yes / No buttons. ⌘1–9 jumps to a chat and ⌘\\ shows two side by side.'],
  ['Make it yours', 'Right-click a card to rename it, add a note, pin, fork or show it in Finder. ⌘, opens Customize: themes, colours, notifications and window options. You can open this tour again there.'],
]

/** A short, dismissible walk through the board. `done` runs however it ends (finished, skipped, Esc). */
export function openTour(done: () => void) {
  document.getElementById('tour')?.remove()
  const root = document.createElement('div')
  root.id = 'tour'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  const box = document.createElement('div')
  box.className = 'tour-box'
  root.append(box)
  let i = 0
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); done() }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (i > 0) { i--; draw() } }
  }
  const next = () => { if (i === STEPS.length - 1) close(); else { i++; draw() } }
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text })
  function draw() {
    const [title, body] = STEPS[i]
    const dots = el('div', 'tour-dots')
    STEPS.forEach((_, n) => dots.append(el('i', n === i ? 'on' : '')))
    const back = el('button', '', 'Back'), skip = el('button', 'tour-skip', 'Skip'), go = el('button', 'tour-next', i === STEPS.length - 1 ? 'Done' : 'Next')
    back.disabled = i === 0
    back.onclick = () => { i--; draw() }
    skip.onclick = close
    go.onclick = next
    const foot = el('div', 'tour-foot')
    foot.append(skip, dots, back, go)
    box.replaceChildren(el('h2', '', title), el('p', '', body), foot)
    go.focus()
  }
  window.addEventListener('keydown', onKey, true)
  document.body.append(root)
  draw()
}
