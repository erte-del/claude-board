export type Rect = { x: number; y: number; width: number; height: number }
export type Bounds = { x?: number; y?: number; width: number; height: number; maximized: boolean }

const MIN_W = 640, MIN_H = 420
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Window bounds to open with. Saved data is untrusted (hand-edited, or from a monitor that is no longer connected): a window
 * whose saved position is not visibly on any current display loses its position (the OS centres it) but keeps its size.
 */
export function restoreBounds(saved: unknown, displays: Rect[], def: { width: number; height: number }): Bounds {
  const s = saved as Partial<Bounds> | null
  if (!s || !num(s.width) || !num(s.height)) return { ...def, maximized: false }
  const width = Math.max(MIN_W, Math.round(s.width))
  const height = Math.max(MIN_H, Math.round(s.height))
  const maximized = s.maximized === true
  if (num(s.x) && num(s.y)) {
    const visible = displays.some((d) => Math.min(s.x! + width, d.x + d.width) - Math.max(s.x!, d.x) >= 120 && Math.min(s.y! + height, d.y + d.height) - Math.max(s.y!, d.y) >= 80)
    if (visible) return { x: Math.round(s.x), y: Math.round(s.y), width, height, maximized }
  }
  return { width, height, maximized }
}
