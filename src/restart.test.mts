import test from 'node:test'
import assert from 'node:assert/strict'
import { planRestart } from './restart.mts'

test('three restarts in ten minutes are allowed, the fourth is not', () => {
  let times: number[] = []
  const ok: boolean[] = []
  for (let i = 0; i < 4; i++) { const r = planRestart(times, 1000 + i * 1000); ok.push(r.ok); times = r.times }
  assert.deepEqual(ok, [true, true, true, false])
  assert.equal(times.length, 3) // a refused restart is not recorded
})

test('old restarts age out of the window', () => {
  const r = planRestart([0, 1000, 2000], 10 * 60_000 + 1500)
  assert.deepEqual(r, { ok: true, times: [2000, 10 * 60_000 + 1500] })
})
