import test from 'node:test'
import assert from 'node:assert/strict'
import { hubSpot, overlaps, ringOffset, type Placed, type Size } from './placement.mts'

const HUB: Size = { w: 200, h: 48 }
const opts = (total: number) => ({ minRing: 250, span: 230, total, hub: HUB })

// Place `sizes` one after another exactly the way the board does.
function place(sizes: Size[]): Placed[] {
  const placed: Placed[] = []
  for (const s of sizes) placed.push({ p: ringOffset(s, placed, opts(sizes.length)), s })
  return placed
}

test('first card goes straight up from the hub', () => {
  const [a] = place([{ w: 220, h: 168 }])
  assert.ok(Math.abs(a.p.x) < 1e-9 && a.p.y < 0)
})

test('cards never overlap each other or the hub, for uniform sizes', () => {
  for (const n of [2, 3, 5, 8, 12]) {
    const cards = place(Array.from({ length: n }, () => ({ w: 220, h: 168 })))
    for (let i = 0; i < n; i++) {
      assert.ok(!overlaps(cards[i], { p: { x: 0, y: 0 }, s: HUB }, 0), `n=${n}: card ${i} hits the hub`)
      for (let j = i + 1; j < n; j++) assert.ok(!overlaps(cards[i], cards[j], 0), `n=${n}: cards ${i}/${j} overlap`)
    }
  }
})

test('cards of very different sizes (a chat grown by sub-agents) still do not overlap', () => {
  const sizes: Size[] = [{ w: 336, h: 420 }, { w: 220, h: 168 }, { w: 336, h: 300 }, { w: 220, h: 168 }, { w: 220, h: 190 }, { w: 336, h: 420 }]
  const cards = place(sizes)
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(cards[i], cards[j], 0), `${i}/${j} overlap`)
})

test('a new card goes into free space around existing ones, even if they were dragged', () => {
  const dragged: Placed = { p: { x: 0, y: -260 }, s: { w: 220, h: 168 } } // sitting on the first ring slot
  const p = ringOffset({ w: 220, h: 168 }, [dragged], opts(2))
  assert.ok(!overlaps({ p, s: { w: 220, h: 168 } }, dragged, 0))
})

test('hubSpot: first cluster at the origin, later ones clear the earlier ones', () => {
  assert.deepEqual(hubSpot(300, []), { x: 0, y: 0 })
  const a = hubSpot(300, [])
  const b = hubSpot(300, [{ p: a, r: 300 }])
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 300 + 300 + 60)
  const c = hubSpot(200, [{ p: a, r: 300 }, { p: b, r: 300 }])
  for (const q of [a, b]) assert.ok(Math.hypot(c.x - q.x, c.y - q.y) >= 200 + 300 + 60)
})
