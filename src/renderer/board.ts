import { formatTokens, formatUsd } from '../pricing.mts'
import { hubSpot, ringOffset, type Placed } from '../placement.mts'
import { formatCountdown } from '../reset.mts'
import { matches } from '../filter.mts'
import { cycle, nextInDirection, type Dir } from '../nav.mts'
import { emptyLayout, type ChatInfo, type Layout, type Pt, type SubInfo } from '../types'

// Geometry in world px. Sizes and spacing are the knobs for restyling.
let CARD_W = 220, CARD_H = 150 // set from settings
const USE_H = 18 // the context / cost row
const NAME_H = 22 // the user-given name line
const HUB_BOX = { w: 200, h: 48 } // room the folder pill takes in the middle of a ring
const MINI_W = 150, MINI_H = 74, MINI_GAP = 6, CARD_PAD = 12
let SPAN = 230, MIN_RING = 250 // nominal spacing between neighbours on a ring, and the smallest ring radius (follow the card width)
const GRID = 24 // dot-grid spacing

type Handlers = { open(chatId: string, beside?: boolean): void; resume(sessionId: string, beside?: boolean): void; kill(chatId: string): void; newIn(cwd: string): void; answer(chatId: string, question: string, yes: boolean): void; save(l: Layout): void }
type MiniEls = { el: HTMLElement; title: HTMLElement; feed: HTMLElement; feedSig: string }
type CardEls = {
  card: HTMLElement; idx: HTMLElement; kill: HTMLElement; name: HTMLElement; nameInput: HTMLInputElement; use: HTMLElement; ctx: HTMLElement; cost: HTMLElement; bar: HTMLElement; model: HTMLElement; branch: HTMLElement; tps: HTMLElement; feed: HTMLElement; ask: HTMLElement; feedSig: string
  subs: HTMLElement; minis: Map<string, MiniEls>; line: SVGPathElement
}
type Drag = { kind: 'card' | 'hub' | 'pan'; key: string; start: Pt; orig: Pt; moved: boolean; shift: boolean; onClick?: (shift: boolean) => void }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
const feedNodes = (feed: string[], placeholder: string) =>
  (feed.length ? feed : [placeholder]).map((t) => el('div', !feed.length ? 'f dim' : t.startsWith('▸') ? 'f tool' : t.startsWith('↻') ? 'f dim' : 'f', t))

// A chat with running sub-agents grows to hold them as a grid of mini cards under its own text.
function sizeOf(c: ChatInfo, titled: boolean) {
  const k = c.subagents.length
  const extra = USE_H + (titled ? NAME_H : 0)
  if (!k) return { w: CARD_W, h: CARD_H + extra }
  const cols = k > 1 ? 2 : 1
  return {
    w: Math.max(CARD_W, 2 * CARD_PAD + cols * MINI_W + (cols - 1) * MINI_GAP + 6),
    h: CARD_H + extra + Math.ceil(k / cols) * (MINI_H + MINI_GAP) + 4,
  }
}

export function createBoard(root: HTMLElement, h: Handlers) {
  const world = el('div', 'world')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('lines')
  const empty = el('div', 'empty')
  empty.append(el('b', '', 'No chats yet'), el('span', '', 'Press ⌘N or click “+ New chat” to start one.'))
  world.append(svg)
  root.append(world, empty)

  let chats: ChatInfo[] = []
  let layout: Layout = emptyLayout()
  let view = { x: 0, y: 0, k: 1 }
  let userMoved = false // until the user pans/zooms/drags, keep the whole graph framed as it grows
  let fitted = false
  let curved = false
  let smooth = true
  let zoomTarget = 1, zoomRaf = 0
  let zoomAnchor = { sx: 0, sy: 0, wx: 0, wy: 0 }
  let drag: Drag | null = null
  let raf = 0
  let saveTimer = 0
  let editing: string | null = null // sessionId of the card being renamed
  let query = '' // board filter text (not saved)
  let selected: string | null = null // keyboard-selected card (sessionId)
  const cards = new Map<string, CardEls>()
  const hubs = new Map<string, HTMLElement>()

  // New elements are placed without a transition, then released into the animated state on the next frame.
  const settle = (...els: Element[]) => {
    void root.offsetWidth
    requestAnimationFrame(() => els.forEach((e) => e.classList.remove('no-anim', 'enter')))
  }

  // size of a card, including the name line when it has one (or is being named)
  const sz = (c: ChatInfo) => sizeOf(c, !!layout.titles[c.sessionId] || editing === c.sessionId)

  // ---- filter: collapsed folders and "hide ended" remove cards; the search text dims the cards that don't match
  const isVisible = (c: ChatInfo) => !layout.collapsed[c.cwd] && !(layout.hideEnded && c.status === 'ended')
  const searchable = (c: ChatInfo) => [layout.titles[c.sessionId], base(c.cwd), c.cwd, c.model, c.branch, ...c.feed, ...c.subagents.flatMap((s) => [s.title, ...s.feed])]
  const isMatch = (c: ChatInfo) => matches(query, searchable(c))
  const shown = () => chats.filter(isVisible)

  // ---- layout: folder hub in the middle, its chats on a ring. Positions are stored the first time they are chosen.
  const hubOf = (cwd: string) => layout.clusters[cwd]
  const cardAt = (c: ChatInfo): Pt => ({ x: hubOf(c.cwd).x + layout.cards[c.sessionId].x, y: hubOf(c.cwd).y + layout.cards[c.sessionId].y })

  const radiusOf = (arr: ChatInfo[]) => Math.max(110, ...arr.map((c) => Math.hypot(layout.cards[c.sessionId].x, layout.cards[c.sessionId].y) + Math.hypot(sz(c).w, sz(c).h) / 2))

  function ensureLayout(groups: Map<string, ChatInfo[]>): boolean {
    let changed = false
    for (const arr of groups.values()) {
      for (const c of arr) {
        if (layout.cards[c.sessionId]) continue
        const others: Placed[] = arr.filter((o) => layout.cards[o.sessionId]).map((o) => ({ p: layout.cards[o.sessionId], s: sz(o) }))
        layout.cards[c.sessionId] = ringOffset(sz(c), others, { minRing: MIN_RING, span: SPAN, total: arr.length, hub: HUB_BOX })
        changed = true
      }
    }
    for (const [cwd, arr] of groups) {
      if (hubOf(cwd)) continue
      const others = [...groups].filter(([o]) => o !== cwd && hubOf(o)).map(([o, a]) => ({ p: hubOf(o), r: radiusOf(a) }))
      layout.clusters[cwd] = hubSpot(radiusOf(arr), others)
      changed = true
    }
    return changed
  }

  // Every save also records where the view is (or forgets it, while the board is auto-framed).
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      if (userMoved) layout.view = { ...view }
      else delete layout.view
      h.save(layout)
    }, 300)
  }

  // ---- view (pan / zoom). animate=true glides to the new view; direct manipulation never animates.
  function applyView(animate = false) {
    const ease = animate ? '.45s cubic-bezier(.2,.8,.2,1)' : 'none'
    world.style.transition = animate ? `transform ${ease}` : 'none'
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
    // the dot grid follows the world so panning/zooming feels like moving across a surface
    root.style.transition = animate ? `background-position ${ease}, background-size ${ease}` : 'none'
    root.style.backgroundPosition = `${view.x}px ${view.y}px`
    root.style.backgroundSize = `${GRID * view.k}px ${GRID * view.k}px`
  }
  function centreOn(p: Pt, animate = true) {
    cancelAnimationFrame(zoomRaf); zoomRaf = 0
    view.x = root.clientWidth / 2 - p.x * view.k
    view.y = root.clientHeight / 2 - p.y * view.k
    applyView(animate)
  }
  function fit() {
    if (!shown().length || !root.clientWidth) return
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const c of shown()) {
      const p = cardAt(c), s = sz(c)
      x0 = Math.min(x0, p.x - s.w / 2); x1 = Math.max(x1, p.x + s.w / 2)
      y0 = Math.min(y0, p.y - s.h / 2); y1 = Math.max(y1, p.y + s.h / 2)
    }
    view.k = Math.min(1, Math.max(0.25, Math.min(root.clientWidth / (x1 - x0 + 120), root.clientHeight / (y1 - y0 + 120))))
    centreOn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, fitted) // the very first fit just snaps
    fitted = true
  }
  // Zoom eases toward its target each frame, keeping the world point under the cursor fixed.
  function setZoom(k: number) {
    view.k = k
    view.x = zoomAnchor.sx - zoomAnchor.wx * k
    view.y = zoomAnchor.sy - zoomAnchor.wy * k
    applyView()
  }
  function zoomStep() {
    const d = zoomTarget - view.k
    if (Math.abs(d) < 0.0008) { setZoom(zoomTarget); zoomRaf = 0; save(); return }
    setZoom(view.k + d * 0.22)
    zoomRaf = requestAnimationFrame(zoomStep)
  }
  root.addEventListener('wheel', (e) => {
    e.preventDefault()
    userMoved = true
    if (e.ctrlKey || e.metaKey) { // pinch, or Cmd+scroll
      const r = root.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      zoomAnchor = { sx, sy, wx: (sx - view.x) / view.k, wy: (sy - view.y) / view.k }
      zoomTarget = Math.min(2, Math.max(0.2, (zoomRaf ? zoomTarget : view.k) * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))))
      if (!smooth) setZoom(zoomTarget)
      else if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep)
    } else { view.x -= e.deltaX; view.y -= e.deltaY; applyView() } // two-finger scroll: pan
    save()
  }, { passive: false })
  const isBackground = (t: EventTarget | null) => t === root || t === world || t === empty
  root.addEventListener('pointerdown', (e) => { if (isBackground(e.target) && selected) { selected = null; schedule() } })
  root.addEventListener('pointerdown', (e) => { if (isBackground(e.target)) startDrag(e, { kind: 'pan', key: '', orig: { x: view.x, y: view.y } }) })
  root.addEventListener('dblclick', (e) => { if (isBackground(e.target)) { userMoved = false; fit(); save() } })

  // Straight, or a gentle bow to one side (control point pushed along the perpendicular).
  function linkPath(a: Pt, b: Pt) {
    if (!curved) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    return `M ${a.x} ${a.y} Q ${mx - (b.y - a.y) * 0.18} ${my + (b.x - a.x) * 0.18} ${b.x} ${b.y}`
  }

  // ---- keyboard selection
  const order = () => shown().map((c) => c.sessionId)
  const centreOf = (id: string): Pt | null => { const c = chats.find((x) => x.sessionId === id); return c && layout.cards[id] ? cardAt(c) : null }
  function select(id: string | null) {
    selected = id
    const p = id ? centreOf(id) : null
    if (p) { // bring it into view if it is off screen (or near the edge); keep the zoom
      const sx = view.x + p.x * view.k, sy = view.y + p.y * view.k, m = 140
      if (sx < m || sy < m || sx > root.clientWidth - m || sy > root.clientHeight - m) { userMoved = true; centreOn(p); save() }
    }
    schedule()
  }
  function activate(c: ChatInfo, beside = false) { // same as clicking the card (shift: open it beside the last chat viewed)
    if (c.status === 'ended' && c.resumable) h.resume(c.sessionId, beside)
    else h.open(c.id, beside)
  }

  function toggleCollapse(cwd: string) {
    if (layout.collapsed[cwd]) delete layout.collapsed[cwd]
    else layout.collapsed[cwd] = true
    save()
    schedule()
  }

  // ---- renaming: the name shows as the card's first line; empty clears it
  function startName(key: string) {
    const e = cards.get(key)
    if (!e) return
    editing = key
    e.nameInput.value = layout.titles[key] ?? ''
    schedule()
    requestAnimationFrame(() => requestAnimationFrame(() => { e.nameInput.focus(); e.nameInput.select() }))
  }
  function commitName(key: string, keep: boolean) {
    if (editing !== key) return // blur fires again once the input is hidden
    editing = null
    const v = cards.get(key)?.nameInput.value.trim() ?? ''
    if (keep) {
      if (v) layout.titles[key] = v
      else delete layout.titles[key]
      save()
    }
    schedule()
  }

  // ---- elements
  function makeCard(key: string): CardEls {
    const card = el('div', 'card enter no-anim')
    const model = el('span', 'model'), dot = el('span', 'dot'), branch = el('span', 'branch'), tps = el('span', 'tps'), feed = el('div', 'feed'), subs = el('div', 'subs')
    const head = el('div', 'head'), sub = el('div', 'sub')
    head.append(model, dot)
    sub.append(branch, tps)
    const name = el('div', 'name')
    const nameInput = el('input', 'name-input')
    nameInput.maxLength = 60
    nameInput.placeholder = 'Name this chat'
    nameInput.spellcheck = false
    nameInput.hidden = true
    nameInput.onpointerdown = (e) => e.stopPropagation() // typing/selecting must not drag the card or open the chat
    nameInput.onkeydown = (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') commitName(key, true)
      else if (e.key === 'Escape') commitName(key, false)
    }
    nameInput.onblur = () => commitName(key, true)
    const rename = el('button', 'edit', '✎')
    rename.title = 'Rename'
    rename.onpointerdown = (e) => e.stopPropagation()
    rename.onclick = () => startName(key)
    card.oncontextmenu = (e) => { e.preventDefault(); startName(key) }
    const kill = el('button', 'kill', '✕')
    kill.title = 'Kill this chat'
    kill.onpointerdown = (e) => e.stopPropagation()
    kill.onclick = () => { const c = chats.find((x) => x.sessionId === key); if (c) h.kill(c.id) }
    const alert = el('span', 'alert', '!') // shown by CSS only while the card is waiting for the user
    alert.title = 'Waiting for your input'
    const idx = el('span', 'idx') // "⌘3": which key jumps here; only visible while ⌘ is held
    const ctx = el('span', 'ctx'), cost = el('span', 'cost'), bar = el('i')
    const use = el('div', 'use')
    use.append(ctx, cost)
    const meter = el('div', 'bar')
    meter.append(bar)
    const ask = el('div', 'ask') // Yes / No for a permission question; shown only while there is one
    ask.hidden = true
    for (const [label, yes] of [['Yes', true], ['No', false]] as const) {
      const b = el('button', yes ? 'ask-yes' : 'ask-no', label)
      b.title = yes ? 'Allow this once' : 'Refuse (Esc)'
      b.onpointerdown = (e) => e.stopPropagation()
      b.onclick = (e) => { e.stopPropagation(); const c = chats.find((x) => x.sessionId === key); if (c?.prompt) h.answer(c.id, c.prompt, yes) }
      ask.append(b)
    }
    card.append(name, nameInput, head, sub, use, meter, el('hr'), feed, ask, subs, alert, idx, rename, kill)
    card.onpointerdown = (e) => {
      const c = chats.find((x) => x.sessionId === key)
      if (c) startDrag(e, { kind: 'card', key, orig: { ...layout.cards[key] }, onClick: (shift) => activate(c, shift) })
    }
    world.append(card)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.classList.add('no-anim')
    svg.append(line)
    return { card, idx, kill, name, nameInput, use, ctx, cost, bar, model, branch, tps, feed, ask, feedSig: '\0', subs, minis: new Map(), line }
  }

  function makeMini(): MiniEls {
    const m = el('div', 'mini enter no-anim')
    const head = el('div', 'mini-head'), title = el('span', 'mini-title'), feed = el('div', 'mini-feed')
    head.append(title, el('span', 'dot'))
    const alert = el('span', 'alert', '!')
    alert.title = 'Waiting for your input'
    m.append(head, feed, alert)
    return { el: m, title, feed, feedSig: '\0' }
  }

  function updateSubs(e: CardEls, subs: SubInfo[]) {
    const ids = new Set(subs.map((s) => s.id))
    for (const [id, m] of e.minis) if (!ids.has(id)) { m.el.remove(); e.minis.delete(id) }
    let added = false
    for (const s of subs) {
      let m = e.minis.get(s.id)
      if (!m) {
        e.minis.set(s.id, (m = makeMini()))
        e.subs.append(m.el)
        settle(m.el)
        added = true
      }
      m.el.className = `mini s-${s.status}`
      m.title.textContent = s.title
      const sig = s.feed.join('\0')
      if (sig !== m.feedSig) { m.feedSig = sig; m.feed.replaceChildren(...feedNodes(s.feed.slice(-2), 'Starting…')) }
    }
    if (added) e.subs.append(...subs.map((s) => e.minis.get(s.id)!.el)) // keep spawn order
    e.subs.style.setProperty('--cols', String(subs.length > 1 ? 2 : 1))
  }

  function render() {
    raf = 0
    const groups = new Map<string, ChatInfo[]>()
    for (const c of chats) groups.set(c.cwd, [...(groups.get(c.cwd) ?? []), c])
    if (ensureLayout(groups)) save()

    for (const [cwd] of groups) {
      let hub = hubs.get(cwd)
      const fresh = !hub
      if (!hub) {
        hub = el('div', 'hub no-anim')
        hub.append(el('span', 'caret'), el('span', 'hub-name', base(cwd)), el('span', 'count'))
        const add = el('span', 'hub-add', '+')
        add.title = 'Start another chat in this folder'
        add.onpointerdown = (e) => e.stopPropagation() // not a drag or a fold
        add.onclick = (e) => { e.stopPropagation(); h.newIn(cwd) }
        hub.append(add)
        // a click (no drag) folds the folder's chats away / brings them back
        hub.onpointerdown = (e) => startDrag(e, { kind: 'hub', key: cwd, orig: { ...hubOf(cwd) }, onClick: () => toggleCollapse(cwd) })
        world.append(hub)
        hubs.set(cwd, hub)
      }
      hub.style.transform = `translate(${hubOf(cwd).x}px, ${hubOf(cwd).y}px) translate(-50%, -50%)`
      const mine = groups.get(cwd) ?? []
      const hidden = mine.filter((c) => !isVisible(c)).length
      const folded = !!layout.collapsed[cwd]
      hub.children[0].textContent = folded ? '▸' : '▾'
      hub.children[2].textContent = hidden ? `+${hidden}` : ''
      hub.title = `${cwd}\n${folded ? 'Click to show its chats' : 'Click to fold its chats away'}`
      hub.classList.toggle('dim', query !== '' && !mine.some((c) => isVisible(c) && isMatch(c)))
      if (fresh) settle(hub)
    }
    for (const [cwd, hub] of hubs) if (!groups.has(cwd)) { hub.remove(); hubs.delete(cwd) }

    const live = new Set(chats.map((c) => c.sessionId))
    for (const [key, e] of cards) if (!live.has(key)) { e.card.remove(); e.line.remove(); cards.delete(key) }
    for (const c of chats) {
      let e = cards.get(c.sessionId)
      const fresh = !e
      if (!e) cards.set(c.sessionId, (e = makeCard(c.sessionId)))
      const p = cardAt(c), hub = hubOf(c.cwd), size = sz(c)
      const title = layout.titles[c.sessionId]
      const isEditing = editing === c.sessionId
      e.name.textContent = title ?? ''
      e.name.hidden = !title || isEditing
      e.nameInput.hidden = !isEditing
      e.card.classList.toggle('has-subs', c.subagents.length > 0)
      for (const cls of [...e.card.classList]) if (cls.startsWith('s-')) e.card.classList.remove(cls)
      e.card.classList.add(`s-${c.status}`)
      const vis = isVisible(c), dim = query !== '' && !isMatch(c)
      e.card.classList.toggle('gone', !vis)
      e.card.classList.toggle('dim', vis && dim)
      e.card.classList.toggle('sel', selected === c.sessionId && vis)
      const n = order().indexOf(c.sessionId)
      e.idx.textContent = n >= 0 && n < 9 ? `⌘${n + 1}` : ''
      e.card.style.width = `${size.w}px`
      e.card.style.height = `${size.h}px`
      // centre-anchored (-50%) so a card that grows expands around its link point
      e.card.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
      e.card.title = c.cwd
      e.kill.title = c.status === 'ended' ? 'Remove this card' : 'Kill this chat'
      e.card.classList.toggle('named', !!title || isEditing)
      // context fill (percent when the model's window is known, else tokens) and estimated spend
      const pct = c.contextTokens !== null && c.contextWindow ? Math.round((c.contextTokens / c.contextWindow) * 100) : null
      e.ctx.textContent = c.contextTokens === null ? 'ctx —' : pct !== null ? `ctx ${pct}%` : `ctx ${formatTokens(c.contextTokens)}`
      e.cost.textContent = c.costUSD === null ? '—' : `~${formatUsd(c.costUSD)}`
      e.bar.style.width = `${Math.min(100, pct ?? 0)}%`
      e.bar.className = pct !== null && pct >= 95 ? 'hot' : pct !== null && pct >= 80 ? 'warm' : ''
      e.use.title = c.contextTokens === null ? 'No reply yet'
        : `Context: ${c.contextTokens.toLocaleString()}${c.contextWindow ? ` of ${c.contextWindow.toLocaleString()}` : ''} tokens` +
          (c.costUSD === null ? '\nCost: not shown (no verified price for this model)' : '\nCost: estimated from token usage')
      e.model.textContent = c.model ? c.model.replace(/^claude-/, '') : '—'
      e.branch.textContent = `⎇ ${c.branch ?? '—'}`
      if (c.status === 'limit') { // in place of tokens/s: how long until the limit lifts
        e.tps.textContent = c.limitResetAt ? `↻ ${formatCountdown(c.limitResetAt - Date.now())}` : 'limit'
        e.tps.title = c.limitResetAt ? `Limit lifts ${new Date(c.limitResetAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Usage limit reached'
      } else {
        e.tps.textContent = c.status === 'working' && c.tps != null ? `${Math.round(c.tps)} t/s` : '— t/s'
        e.tps.title = ''
      }
      const d = linkPath(hub, p)
      e.line.setAttribute('d', d)
      e.line.style.setProperty('d', `path("${d}")`) // CSS `d` is what lets the line glide along with its card
      e.line.setAttribute('class', `s-${c.status}${fresh ? ' no-anim' : ''}${vis ? '' : ' gone'}${vis && dim ? ' dim' : ''}`)
      const lines = c.status === 'ended' && c.resumable ? [...c.feed, '↻ Click to resume'] : c.feed
      const sig = lines.join('\0')
      if (sig !== e.feedSig) { // only rebuild the text when it changed, so selection and scroll survive
        e.feedSig = sig
        e.feed.replaceChildren(...feedNodes(lines, 'No output yet'))
      }
      e.ask.hidden = !c.prompt
      updateSubs(e, c.subagents)
      if (fresh) settle(e.card, e.line)
    }
    empty.hidden = chats.length > 0
    if (selected && !chats.some((c) => c.sessionId === selected)) selected = null
    if (!userMoved) fit()
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render) }
  setInterval(() => { if (chats.some((c) => c.status === 'limit')) schedule() }, 15_000) // keep the countdown moving

  // ---- dragging (window listeners, so a drag survives the pointer leaving the element)
  function startDrag(e: PointerEvent, d: Omit<Drag, 'start' | 'moved' | 'shift'>) {
    if (e.button !== 0) return
    drag = { ...d, start: { x: e.clientX, y: e.clientY }, moved: false, shift: e.shiftKey }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }
  function onMove(e: PointerEvent) {
    if (!drag) return
    const dx = e.clientX - drag.start.x, dy = e.clientY - drag.start.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) root.classList.add('dragging') // follow the pointer exactly: no easing while dragging
    drag.moved = true
    userMoved = true
    if (drag.kind === 'pan') { view.x = drag.orig.x + dx; view.y = drag.orig.y + dy; return applyView() }
    const p = { x: drag.orig.x + dx / view.k, y: drag.orig.y + dy / view.k }
    if (drag.kind === 'card') layout.cards[drag.key] = p
    else layout.clusters[drag.key] = p
    schedule()
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    root.classList.remove('dragging')
    const d = drag
    drag = null
    if (!d) return
    if (d.moved) save() // card/hub drags save the layout; a pan saves the view
    else d.onClick?.(d.shift)
  }

  return {
    setChats(c: ChatInfo[]) { chats = c; schedule() },
    setLayout(l: Layout) {
      layout = { ...emptyLayout(), ...l, titles: l.titles ?? {} }
      const v = l.view
      if (v && [v.x, v.y, v.k].every(Number.isFinite) && v.k > 0.05) { // come back to where the board was left
        view = { ...v }
        userMoved = true
        fitted = true
        applyView()
      }
      schedule()
    },
    fitAll() { userMoved = false; fit(); save() },
    titleOf(key: string) { return layout.titles[key] },
    // ---- keyboard
    order,
    selectedId() { return selected },
    clearSelection() { if (selected) { selected = null; schedule() } },
    /** Arrow key: the nearest visible card that way. With nothing selected, start on a chat that needs you (else the first). */
    moveSelection(dir: Dir) {
      const vis = shown()
      if (!vis.length) return
      const from = selected ? centreOf(selected) : null
      if (!from) return select((vis.find((c) => c.status === 'waiting') ?? vis[0]).sessionId)
      const next = nextInDirection(from, vis.filter((c) => c.sessionId !== selected && layout.cards[c.sessionId]).map((c) => ({ id: c.sessionId, p: cardAt(c) })), dir)
      if (next) select(next)
    },
    cycleSelection(delta: 1 | -1) { select(cycle(order(), selected, delta)) },
    /** Enter on the selected card, or ⌘1-9 (index 0-8): open it, or resume it if it is a gray restored card. Returns false if there is none. */
    activateSelected(beside = false) { const c = chats.find((x) => x.sessionId === selected); if (c) activate(c, beside); return !!c },
    activateAt(i: number) { const c = chats.find((x) => x.sessionId === order()[i]); if (c) activate(c); return !!c },
    showKeys(on: boolean) { root.classList.toggle('show-keys', on) },
    // ---- filter
    setQuery(q: string) { query = q; schedule() },
    setHideEnded(on: boolean) { layout.hideEnded = on; save(); schedule() },
    hideEnded() { return layout.hideEnded },
    /** How many visible cards match the filter, out of all visible cards. */
    counts() { const v = shown(); return { matches: v.filter(isMatch).length, total: v.length } },
    /** Jump to the next (or previous) matching card: select it and bring it to the middle of the view. */
    nextMatch(delta: 1 | -1 = 1) {
      const m = shown().filter(isMatch).map((c) => c.sessionId)
      if (!m.length) return
      const i = selected ? m.indexOf(selected) : -1
      selected = m[i < 0 ? (delta === 1 ? 0 : m.length - 1) : (i + delta + m.length) % m.length]
      const c = chats.find((x) => x.sessionId === selected)
      if (c && layout.cards[selected]) { userMoved = true; centreOn(cardAt(c)); save() }
      schedule()
    },
    // Lay every card and folder out again from scratch: tidy rings, no overlaps (sub-agent cards included).
    arrange() {
      for (const c of chats) { delete layout.cards[c.sessionId]; delete layout.clusters[c.cwd] }
      userMoved = false
      schedule()
      save()
    },
    setOptions(o: { cardW: number; cardH: number; curved: boolean; grid: boolean; smooth: boolean }) {
      CARD_W = o.cardW; CARD_H = o.cardH
      SPAN = CARD_W + 10; MIN_RING = SPAN + 20
      curved = o.curved; smooth = o.smooth
      root.classList.toggle('grid', o.grid)
      applyView()
      schedule()
    },
    // Bring a card to the middle of the view (used when coming back from its chat).
    reveal(key: string) {
      requestAnimationFrame(() => {
        const c = chats.find((x) => x.sessionId === key)
        if (!c || !layout.cards[key]) return
        if (userMoved) { centreOn(cardAt(c), false); save() } // the board was hidden; place it instantly, nothing to glide from
        else fit()
      })
    },
  }
}
