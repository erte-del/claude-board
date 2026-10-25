import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreBounds } from './windowstate.mts'

const screen = { x: 0, y: 25, width: 1440, height: 875 }
const def = { width: 1200, height: 800 }

test('a normal saved window is restored as it was', () => {
  assert.deepEqual(restoreBounds({ x: 100, y: 80, width: 1000, height: 700, maximized: false }, [screen], def), { x: 100, y: 80, width: 1000, height: 700, maximized: false })
  assert.equal(restoreBounds({ x: 0, y: 25, width: 900, height: 600, maximized: true }, [screen], def).maximized, true)
})

test('missing or garbage data gives the default size', () => {
  for (const bad of [null, undefined, {}, 'x', { width: 'a', height: 1 }, { width: NaN, height: 600 }])
    assert.deepEqual(restoreBounds(bad, [screen], def), { ...def, maximized: false })
})

test('a window saved on a monitor that is gone keeps its size but loses its position', () => {
  const r = restoreBounds({ x: 3000, y: 100, width: 1000, height: 700 }, [screen], def)
  assert.equal(r.x, undefined)
  assert.equal(r.y, undefined)
  assert.deepEqual([r.width, r.height], [1000, 700])
})

test('a window that is only barely on screen counts as lost; one half on screen is kept', () => {
  assert.equal(restoreBounds({ x: 1400, y: 100, width: 1000, height: 700 }, [screen], def).x, undefined) // 40px visible
  assert.equal(restoreBounds({ x: 700, y: 100, width: 1000, height: 700 }, [screen], def).x, 700)
})

test('a position on a second display is valid when that display is connected', () => {
  const second = { x: 1440, y: 0, width: 1920, height: 1080 }
  assert.equal(restoreBounds({ x: 1600, y: 50, width: 1000, height: 700 }, [screen, second], def).x, 1600)
  assert.equal(restoreBounds({ x: 1600, y: 50, width: 1000, height: 700 }, [screen], def).x, undefined)
})

test('absurdly small sizes are raised to a usable minimum', () => {
  const r = restoreBounds({ x: 10, y: 40, width: 50, height: 50 }, [screen], def)
  assert.ok(r.width >= 640 && r.height >= 420)
})
