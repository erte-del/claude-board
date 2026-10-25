export type Pt = { x: number; y: number }
export type Dir = 'left' | 'right' | 'up' | 'down'

/**
 * The card to move to when an arrow key is pressed: the nearest one in that direction, favouring cards that are lined up
 * with the current one over ones far off to the side. null when nothing lies that way.
 */
export function nextInDirection(from: Pt, cands: { id: string; p: Pt }[], dir: Dir): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const c of cands) {
    const dx = c.p.x - from.x, dy = c.p.y - from.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue // not in that direction (or the same spot)
    const score = along + 2 * across
    if (score < bestScore) { bestScore = score; best = c.id }
  }
  return best
}

/** Next/previous id in a list, wrapping around; the first (or last) when nothing is current. */
export function cycle(ids: string[], current: string | null, delta: 1 | -1): string | null {
  if (!ids.length) return null
  const i = current === null ? -1 : ids.indexOf(current)
  if (i < 0) return delta === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(i + delta + ids.length) % ids.length]
}

/** Pinned chats first (in their current order), then the rest; this is the order ⌘1–9, Tab and the arrow keys use. */
export const pinnedFirst = (ids: string[], pinned: Record<string, boolean> | undefined) => [...ids.filter((i) => pinned?.[i]), ...ids.filter((i) => !pinned?.[i])]
