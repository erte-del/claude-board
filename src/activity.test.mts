import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWorking, newActivity, record } from './activity.mts'

const stream = (a: ReturnType<typeof newActivity>, from: number, to: number, every = 100) => { for (let t = from; t <= to; t += every) record(a, t, 0) }

test('a lone status-line burst never reads as working', () => {
  const a = newActivity()
  for (const t0 of [10_400, 20_900, 30_900]) {
    for (let t = t0; t < t0 + 400; t += 100) { record(a, t, 0); assert.equal(isWorking(a, t), false) } // a few chunks in under 0.5s
    for (let t = t0 + 400; t < t0 + 3000; t += 100) assert.equal(isWorking(a, t), false)
  }
})
test('a continuous stream reads as working after the sustain time and stops 2s after the last chunk', () => {
  const a = newActivity()
  stream(a, 1000, 1600)
  assert.equal(isWorking(a, 1600), false)
  stream(a, 1700, 5000)
  assert.equal(isWorking(a, 5000), true)
  assert.equal(isWorking(a, 6999), true)
  assert.equal(isWorking(a, 7000), false)
})
test('a lull under the hold time mid-turn does not drop out of working', () => {
  const a = newActivity()
  stream(a, 0, 3000)
  record(a, 4200, 0) // 1.2s of silence, then output again
  assert.equal(isWorking(a, 3500), true)
  assert.equal(isWorking(a, 4200), true)
})
test('a repaint after a finished turn starts a fresh burst', () => {
  const a = newActivity()
  stream(a, 0, 3000)
  record(a, 13_000, 0)
  assert.equal(isWorking(a, 13_000), false)
  assert.equal(isWorking(a, 13_100), false)
})
test('a fresh chat is idle', () => assert.equal(isWorking(newActivity(), 5000), false))
test('output within 300ms of our own input is an echo and never counts', () => {
  const a = newActivity()
  for (let t = 1000; t <= 1300; t += 50) record(a, t, 1000)
  assert.equal(a.last, 0)
  stream(a, 1400, 3000)
  assert.equal(isWorking(a, 3000), true)
})
