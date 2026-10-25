import { TERM_THEMES, termTheme } from '../termthemes.mts'
import { closePicker, openPicker } from './colorpicker'
import { DEFAULT_TERM_FONT, defaultSettings, type KeepAwake, type Settings, type StateKey, type Theme } from '../types'

type NumKey = 'stallMinutes' | 'quietStart' | 'quietEnd' | 'cardW' | 'cardH' | 'radius' | 'cardFont' | 'lineWidth' | 'termFont'
type BoolKey = 'curved' | 'grid' | 'motion' | 'notifications' | 'finishNotify' | 'waitingSound' | 'quietHours' | 'autoResume' | 'quietLaunch'

const STATES: [StateKey, string][] = [['working', 'Working'], ['idle', 'Idle'], ['waiting', 'Waiting for you'], ['limit', 'Limit hit'], ['ended', 'Ended']]
const SHORTCUTS: [string, string][] = [['⌘N', 'New chat'], ['⌘O', 'Add existing chat'], ['⌘⇧A', 'Auto-arrange'], ['⌘F', 'Filter chats (in a chat: find in the terminal)'], ['⌘\\', 'Split: show another chat beside this one'], ['⇧-click', 'Open a chat beside the last one you viewed'], ['← ↑ ↓ →', 'Select a chat'], ['Enter', 'Open the selected chat'], ['Tab', 'Next chat'], ['⌘1–9', 'Jump to chat 1–9 (hold ⌘ to see them)'], ['⌘,', 'Customize'], ['⌘⇧B', 'Back to board'], ['⌘0', 'Fit board to window'], ['Esc', 'Close bar / panel']]
let fontChoices: string[] = [DEFAULT_TERM_FONT] // filled in once the installed fonts have been checked
const THEMES: [Theme, string][] = [['dark', 'Dark'], ['light', 'Light'], ['midnight', 'Midnight']]

export function mergeSettings(loaded: Partial<Settings> | null): Settings {
  return { ...defaultSettings, ...loaded, colors: { ...defaultSettings.colors, ...loaded?.colors } }
}

/** Everything visual is a CSS variable, so applying settings is just setting variables. */
export function applySettings(s: Settings) {
  const r = document.documentElement
  r.dataset.theme = s.theme
  for (const [k] of STATES) r.style.setProperty(`--c-${k}`, s.colors[k])
  r.style.setProperty('--radius', `${s.radius}px`)
  r.style.setProperty('--card-font', `${s.cardFont}px`)
  r.style.setProperty('--line-w', `${s.lineWidth}px`)
  r.classList.toggle('no-motion', !s.motion)
  r.style.setProperty('--term-bg', termTheme(s.termTheme).background) // the pane around the terminal follows the preset
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export function createSettings(panel: HTMLElement, initial: Settings, onChange: (s: Settings) => void) {
  let s = initial
  const emit = () => { applySettings(s); onChange(s) }

  const section = (title: string, ...rows: HTMLElement[]) => {
    const sec = el('section')
    sec.append(el('h3', '', title), ...rows)
    return sec
  }
  const row = (label: string, control: HTMLElement) => {
    const r = el('label', 'row')
    r.append(el('span', 'row-label', label), control)
    return r
  }
  const slider = (label: string, key: NumKey, min: number, max: number, step: number, unit = 'px') => {
    const input = el('input')
    input.type = 'range'
    input.min = String(min); input.max = String(max); input.step = String(step)
    input.value = String(s[key])
    const out = el('span', 'row-value', `${s[key]}${unit}`)
    input.oninput = () => { s = { ...s, [key]: Number(input.value) }; out.textContent = `${input.value}${unit}`; emit() }
    const box = el('span', 'row-control')
    box.append(input, out)
    return row(label, box)
  }
  const toggle = (label: string, key: BoolKey) => {
    const input = el('input')
    input.type = 'checkbox'
    input.checked = s[key]
    input.className = 'switch'
    input.onchange = () => { s = { ...s, [key]: input.checked }; emit() }
    return row(label, input)
  }
  const segmented = <T extends string>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
    const box = el('span', 'segmented')
    const buttons = options.map(([v, text]) => {
      const b = el('button', '', text)
      b.type = 'button'
      b.onclick = () => { set(v); buttons.forEach((x, i) => x.classList.toggle('on', options[i][0] === v)); emit() }
      b.classList.toggle('on', get() === v)
      return b
    })
    box.append(...buttons)
    return row(label, box)
  }
  const fontSelect = () => {
    const sel = el('select')
    const options = fontChoices.includes(s.termFontFamily) ? fontChoices : [...fontChoices, s.termFontFamily] // keep a saved choice that isn't available right now
    for (const o of options) { const op = el('option', '', o); op.value = o; sel.append(op) }
    sel.value = s.termFontFamily
    sel.onchange = () => { s = { ...s, termFontFamily: sel.value }; emit() }
    return row('Terminal font', sel)
  }
  const themeSelect = () => {
    const sel = el('select')
    for (const t of TERM_THEMES) { const op = el('option', '', t.label); op.value = t.id; sel.append(op) }
    sel.value = TERM_THEMES.some((t) => t.id === s.termTheme) ? s.termTheme : 'default'
    sel.onchange = () => { s = { ...s, termTheme: sel.value }; emit() }
    return row('Terminal colours', sel)
  }
  const color = (label: string, key: StateKey) => {
    const sw = el('button', 'swatch')
    sw.type = 'button'
    sw.style.background = s.colors[key]
    sw.onclick = () => openPicker(sw, s.colors[key], (hex) => {
      s = { ...s, colors: { ...s.colors, [key]: hex } }
      sw.style.background = hex
      emit()
    })
    return row(label, sw)
  }

  function build() {
    const head = el('header')
    const close = el('button', 'icon', '✕')
    close.title = 'Close'
    close.onclick = () => api.close()
    head.append(el('h2', '', 'Customize'), close)
    const reset = el('button', 'reset', 'Reset to defaults')
    reset.onclick = () => { closePicker(); s = structuredClone(defaultSettings); build(); emit() }
    panel.replaceChildren(
      head,
      section('Theme',
        segmented('Theme', THEMES, () => s.theme, (v) => { s = { ...s, theme: v } }),
        toggle('Background dots', 'grid')),
      section('Cards',
        slider('Width', 'cardW', 180, 340, 5),
        slider('Height', 'cardH', 120, 260, 5),
        slider('Corner radius', 'radius', 0, 24, 1),
        slider('Text size', 'cardFont', 10, 14, 1)),
      section('Links',
        segmented('Style', [['straight', 'Straight'], ['curved', 'Curved']] as [string, string][], () => (s.curved ? 'curved' : 'straight'), (v) => { s = { ...s, curved: v === 'curved' } }),
        slider('Thickness', 'lineWidth', 1, 6, 0.5)),
      section('Status colours', ...STATES.map(([k, label]) => color(label, k))),
      section('Other',
        toggle('Notify me when a chat needs me', 'notifications'),
        toggle('Sound with that notification', 'waitingSound'),
        toggle('Also notify when a chat finishes', 'finishNotify'),
        toggle('Quiet hours (no notifications)', 'quietHours'),
        slider('Quiet from', 'quietStart', 0, 23, 1, ':00'),
        slider('Quiet until', 'quietEnd', 0, 23, 1, ':00'),
        toggle('Chats open apps in the background (new chats)', 'quietLaunch'),
        segmented<KeepAwake>('Keep Mac awake', [['off', 'Off'], ['auto', 'When working'], ['always', 'Always']], () => s.keepAwake, (v) => { s = { ...s, keepAwake: v } }),
        slider('Flag a chat as stalled after (0 = never)', 'stallMinutes', 0, 60, 5, ' min'),
        toggle('Restart crashed chats automatically', 'autoResume'),
        toggle('Smooth motion', 'motion'),
        fontSelect(),
        themeSelect(),
        slider('Terminal text', 'termFont', 10, 18, 1)),
      section('Shortcuts', ...SHORTCUTS.map(([keys, what]) => {
        const r = el('div', 'row')
        r.append(el('span', 'row-label', what), el('kbd', '', keys))
        return r
      })),
      reset,
    )
  }
  build()

  const api = {
    toggle: () => panel.classList.toggle('open'),
    close: () => { closePicker(); panel.classList.remove('open') },
    isOpen: () => panel.classList.contains('open'),
    set: (next: Settings) => { s = next; build() }, // after loading from disk
    setFonts: (list: string[]) => { fontChoices = [DEFAULT_TERM_FONT, ...list]; build() },
  }
  return api
}
