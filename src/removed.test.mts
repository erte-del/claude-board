import test from 'node:test'
import assert from 'node:assert/strict'
import { pushRemoved, sanitizeRemoved, takeRestorable, type Removed } from './removed.mts'

const r = (n: number): Removed => ({ sessionId: `s${n}`, cwd: '/p', name: `n${n}`, at: n })

test('the log keeps the newest 500, one entry per chat', () => {
  let log: Removed[] = []
  for (let i = 0; i < 503; i++) log = pushRemoved(log, r(i))
  assert.equal(log.length, 500)
  assert.deepEqual([log[0].sessionId, log[499].sessionId], ['s3', 's502'])
  log = pushRemoved(log, { ...r(10), at: 999 }) // removed again: moves to the end, no duplicate
  assert.equal(log.length, 500)
  assert.equal(log[499].at, 999)
})

test('undo takes the newest restorable entry and skips ones that cannot come back', () => {
  const log = [r(1), r(2), r(3)]
  const got = takeRestorable(log, (e) => e.sessionId !== 's3')
  assert.equal(got.entry?.sessionId, 's2')
  assert.deepEqual(got.log.map((e) => e.sessionId), ['s1']) // s3 was unrestorable and is gone, s2 was taken
  assert.equal(takeRestorable([r(1)], () => false).entry, null)
  assert.equal(takeRestorable([], () => true).entry, null)
})

test('a damaged file gives an empty or cleaned log', () => {
  assert.deepEqual(sanitizeRemoved('nope'), [])
  assert.deepEqual(sanitizeRemoved([{ sessionId: 'a', cwd: '/x', name: 5 }, { sessionId: '' }, null, { cwd: '/y' }]), [{ sessionId: 'a', cwd: '/x', name: '', at: 0 }])
})
