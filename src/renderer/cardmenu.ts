export type MenuItem = { label: string; run: () => void; danger?: boolean } | 'sep'

let menu: HTMLElement | null = null

export function closeCardMenu() {
  menu?.remove()
  menu = null
}

/** A small right-click menu at (x, y), kept inside the window. Closes on a choice, Esc, a click elsewhere or losing focus. */
export function openCardMenu(x: number, y: number, items: MenuItem[]) {
  closeCardMenu()
  const m = document.createElement('div')
  m.className = 'ctxmenu'
  m.setAttribute('role', 'menu')
  const buttons: HTMLButtonElement[] = []
  for (const it of items) {
    if (it === 'sep') { m.append(Object.assign(document.createElement('hr'))); continue }
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    b.textContent = it.label
    if (it.danger) b.className = 'danger'
    b.onclick = () => { closeCardMenu(); it.run() }
    buttons.push(b)
    m.append(b)
  }
  m.onkeydown = (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.stopPropagation(); closeCardMenu() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus() }
  }
  document.body.append(m)
  const r = m.getBoundingClientRect()
  m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`
  m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`
  buttons[0]?.focus()
  menu = m
  // a click anywhere else (or the window losing focus) dismisses it; the listener goes away with the menu
  const away = (e: Event) => { if (!(e.target instanceof Node) || !m.contains(e.target)) { closeCardMenu(); cleanup() } }
  const cleanup = () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('blur', away) }
  window.addEventListener('pointerdown', away, true)
  window.addEventListener('blur', away)
  const obs = new MutationObserver(() => { if (!m.isConnected) { cleanup(); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
}
