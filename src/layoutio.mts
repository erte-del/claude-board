import type { Layout, Pt } from './types'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7

/** Keep only the entries of a map whose value passes `ok`; a bad entry is dropped, not trusted. */
function pick<T>(raw: unknown, ok: (v: unknown) => v is T, max = 5000): Record<string, T> {
  const out: Record<string, T> = {}
  if (!isObj(raw)) return out
  for (const [k, v] of Object.entries(raw).slice(0, max)) if (k && k.length < 1000 && ok(v)) out[k] = v
  return out
}
const pt = (v: unknown): v is Pt => isObj(v) && num(v.x) && num(v.y)
const text = (n: number) => (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= n
const yes = (v: unknown): v is true => v === true

/** A layout read from a file the user picked: only known fields of the right shape survive. Null if it isn't a layout at all. */
export function sanitizeLayout(raw: unknown): Layout | null {
  if (!isObj(raw) || !['clusters', 'cards', 'titles'].some((k) => isObj(raw[k]))) return null
  const l: Layout = {
    clusters: pick(raw.clusters, pt),
    cards: pick(raw.cards, pt),
    titles: pick(raw.titles, text(60)),
    collapsed: pick(raw.collapsed, yes),
    hideEnded: raw.hideEnded === true,
    notes: pick(raw.notes, text(120)),
    pinned: pick(raw.pinned, yes),
    muted: pick(raw.muted, yes),
  }
  const v = raw.view
  if (isObj(v) && num(v.x) && num(v.y) && num(v.k) && v.k > 0.05 && v.k < 50) l.view = { x: v.x, y: v.y, k: v.k }
  return l
}
