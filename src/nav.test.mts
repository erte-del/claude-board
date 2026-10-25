import test from 'node:test'
import assert from 'node:assert/strict'
import { cycle, nextInDirection } from './nav.mts'

const cards = [
  { id: 'c', p: { x: 0, y: 0 } },
  { id: 'right', p: { x: 300, y: 10 } },
  { id: 'farRight', p: { x: 700, y: 0 } },
  { id: 'left', p: { x: -300, y: -20 } },
  { id: 'up', p: { x: 20, y: -250 } },
  { id: 'down', p: { x: -10, y: 260 } },
]
const others = cards.filter((c) => c.id !== 'c')

test('each arrow goes to the nearest card that way', () => {
  assert.equal(nextInDirection({ x: 0, y: 0 }, others, 'right'), 'right')
  assert.equal(nextInDirection({ x: 0, y: 0 }, others, 'left'), 'left')
  assert.equal(nextInDirection({ x: 0, y: 0 }, others, 'up'), 'up')
  assert.equal(nextInDirection({ x: 0, y: 0 }, others, 'down'), 'down')
})

test('lined-up cards beat nearer ones that are far off to the side', () => {
  const list = [{ id: 'offAxis', p: { x: 200, y: 400 } }, { id: 'aligned', p: { x: 500, y: 0 } }]
  assert.equal(nextInDirection({ x: 0, y: 0 }, list, 'right'), 'aligned')
})

test('nothing in that direction gives null', () => {
  assert.equal(nextInDirection({ x: 0, y: 0 }, [{ id: 'a', p: { x: -50, y: 0 } }], 'right'), null)
  assert.equal(nextInDirection({ x: 0, y: 0 }, [], 'up'), null)
})

test('cycle wraps and handles no current / unknown current', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(cycle(ids, 'a', 1), 'b')
  assert.equal(cycle(ids, 'c', 1), 'a')
  assert.equal(cycle(ids, 'a', -1), 'c')
  assert.equal(cycle(ids, null, 1), 'a')
  assert.equal(cycle(ids, null, -1), 'c')
  assert.equal(cycle(ids, 'gone', 1), 'a')
  assert.equal(cycle([], null, 1), null)
})
