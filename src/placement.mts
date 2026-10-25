// Where things go on the board. Pure geometry (no DOM) so it can be tested.
export type Pt = { x: number; y: number }
export type Size = { w: number; h: number }
export type Placed = { p: Pt; s: Size } // centre + size

/** Do two centred rectangles overlap, keeping `gap` px between them? */
export const overlaps = (a: Placed, b: Placed, gap: number) =>
  Math.abs(a.p.x - b.p.x) < (a.s.w + b.s.w) / 2 + gap && Math.abs(a.p.y - b.p.y) < (a.s.h + b.s.h) / 2 + gap

/**
 * Offset (from the hub, which sits at the origin) for a new card on the ring around it: the emptiest angle at the smallest
 * radius where it clears the hub and every card already there. Works with cards of different sizes.
 */
export function ringOffset(size: Size, others: Placed[], o: { minRing: number; span: number; total: number; hub: Size; gap?: number }): Pt {
  const gap = o.gap ?? 16
  const hub: Placed = { p: { x: 0, y: 0 }, s: o.hub }
  let R = Math.max(o.minRing, o.total > 1 ? (o.span * 1.2) / (2 * Math.sin(Math.PI / o.total)) : 0)
  for (let attempt = 0; attempt < 60; attempt++, R += 40) {
    let best: Pt | null = null
    let bestD = -1
    for (let a = 0; a < 360; a += 15) {
      const p = { x: R * Math.cos(((a - 90) * Math.PI) / 180), y: R * Math.sin(((a - 90) * Math.PI) / 180) } // a=0 is straight up
      const me: Placed = { p, s: size }
      if (overlaps(me, hub, 24) || others.some((q) => overlaps(me, q, gap))) continue
      const d = Math.min(Infinity, ...others.map((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y)))
      if (d > bestD) { bestD = d; best = p }
    }
    if (best) return best
  }
  return { x: 0, y: -R }
}

/** Where a new folder cluster of radius `radius` goes: spiral out from the origin to the first spot clear of the others. */
export function hubSpot(radius: number, others: { p: Pt; r: number }[], gap = 60): Pt {
  for (let r = 0; ; r += 100) {
    const steps = r ? Math.ceil((2 * Math.PI * r) / 100) : 1
    for (let i = 0; i < steps; i++) {
      const p = { x: r * Math.cos((i / steps) * 2 * Math.PI), y: r * Math.sin((i / steps) * 2 * Math.PI) }
      if (others.every((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) >= radius + q.r + gap)) return p
    }
  }
}
