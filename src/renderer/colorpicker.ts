import { hexToRgb, hsvToHex, rgbToHsv, type HSV } from '../color.mts'

// Replaces the native <input type=color> popup, which ignores the app's theme.
const PRESETS = ['#3fb950', '#22d3ee', '#4c9aff', '#a78bfa', '#f472b6', '#f85149', '#f0883e', '#fbbf24', '#ffffff', '#9ca3af', '#666666', '#000000']
const W = 232

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

const root = el('div', 'cp')
const sv = el('div', 'cp-sv'), svKnob = el('div', 'cp-knob')
const hue = el('div', 'cp-hue'), hueKnob = el('div', 'cp-knob')
const preview = el('span', 'cp-preview'), hexInput = el('input', 'cp-hex')
const presets = el('div', 'cp-presets')
sv.append(svKnob)
hue.append(hueKnob)
const hexRow = el('div', 'cp-hexrow')
hexRow.append(preview, hexInput)
root.append(sv, hue, hexRow, presets)
hexInput.spellcheck = false
hexInput.maxLength = 7
document.body.append(root)

let hsv: HSV = { h: 0, s: 0, v: 0 }
let anchor: HTMLElement | null = null
let emit: (hex: string) => void = () => {}

function paint(fromHexField = false) {
  const hex = hsvToHex(hsv)
  sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`
  svKnob.style.left = `${hsv.s * 100}%`
  svKnob.style.top = `${(1 - hsv.v) * 100}%`
  svKnob.style.background = hex
  hueKnob.style.left = `${(hsv.h / 360) * 100}%`
  hueKnob.style.background = `hsl(${hsv.h}, 100%, 50%)`
  preview.style.background = hex
  if (!fromHexField) hexInput.value = hex
  for (const b of presets.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.hex === hex)
}
const change = (fromHexField = false) => { paint(fromHexField); emit(hsvToHex(hsv)) }

// Drag on a track: pointer capture keeps the drag alive outside the element.
function drag(track: HTMLElement, onMove: (x: number, y: number) => void) {
  const at = (e: PointerEvent) => {
    const r = track.getBoundingClientRect()
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }
  track.onpointerdown = (e) => {
    try { track.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    at(e)
    track.onpointermove = at
  }
  track.onpointerup = () => { track.onpointermove = null }
}
drag(sv, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; change() })
drag(hue, (x) => { hsv = { ...hsv, h: x * 360 }; change() })

hexInput.oninput = () => {
  const rgb = hexToRgb(hexInput.value)
  if (!rgb) return
  const next = rgbToHsv(...rgb)
  hsv = { h: next.s && next.v ? next.h : hsv.h, s: next.s, v: next.v } // keep the hue when the colour has none (grey/black)
  change(true)
}
hexInput.onblur = () => paint()
hexInput.onkeydown = (e) => { if (e.key === 'Enter') hexInput.blur() }

for (const hex of PRESETS) {
  const b = el('button', 'cp-preset')
  b.type = 'button'
  b.dataset.hex = hex
  b.style.background = hex
  b.title = hex
  b.onclick = () => {
    const rgb = hexToRgb(hex)!
    const next = rgbToHsv(...rgb)
    hsv = { h: next.s && next.v ? next.h : hsv.h, s: next.s, v: next.v }
    change()
  }
  presets.append(b)
}

export function closePicker() {
  root.classList.remove('open')
  anchor = null
  document.removeEventListener('pointerdown', outside, true)
}
function outside(e: PointerEvent) {
  const t = e.target as Node
  if (!root.contains(t) && !anchor?.contains(t)) closePicker()
}

export const pickerOpen = () => root.classList.contains('open')

/** Opens to the left of the drawer that holds `at`. Calls onInput live as the colour changes. */
export function openPicker(at: HTMLElement, hex: string, onInput: (hex: string) => void) {
  if (anchor === at) return closePicker()
  const rgb = hexToRgb(hex) ?? [0, 0, 0]
  const c = rgbToHsv(...rgb)
  hsv = c
  emit = onInput
  anchor = at
  paint()
  const r = at.getBoundingClientRect()
  const edge = at.closest('.drawer')?.getBoundingClientRect().left ?? r.left // sit beside the drawer, not on top of it
  root.style.left = `${Math.max(8, edge - W - 10)}px`
  root.style.top = `${Math.max(8, Math.min(r.top - 20, innerHeight - 290))}px`
  root.classList.add('open')
  document.addEventListener('pointerdown', outside, true)
}
