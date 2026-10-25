import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeLayout } from './layoutio.mts'

test('a real layout survives unchanged', () => {
  const l = { clusters: { '/p': { x: 1, y: 2 } }, cards: { s1: { x: 3, y: 4 } }, titles: { s1: 'Name' }, collapsed: { '/p': true }, hideEnded: true, notes: { s1: 'note' }, pinned: { s1: true }, muted: { s1: true }, view: { x: 5, y: 6, k: 1.5 } }
  assert.deepEqual(sanitizeLayout(l), l)
})

test('things that are not layouts are refused', () => {
  for (const bad of [null, 'x', 5, [], {}, { hello: 1 }]) assert.equal(sanitizeLayout(bad), null)
})

test('bad entries are dropped, good ones kept, and nothing unknown comes through', () => {
  const got = sanitizeLayout({
    clusters: { '/ok': { x: 1, y: 1 }, '/bad': { x: 'a', y: 1 }, '/inf': { x: Infinity, y: 0 } },
    cards: [], titles: { a: 'ok', b: '', c: 5, d: 'x'.repeat(61) }, collapsed: { '/p': 'yes', '/q': true },
    pinned: { a: false, b: true }, view: { x: 0, y: 0, k: 0 }, evil: { __proto__: 1 }, hideEnded: 'true',
  })!
  assert.deepEqual(got.clusters, { '/ok': { x: 1, y: 1 } })
  assert.deepEqual(got.cards, {})
  assert.deepEqual(got.titles, { a: 'ok' })
  assert.deepEqual(got.collapsed, { '/q': true })
  assert.deepEqual(got.pinned, { b: true })
  assert.equal(got.view, undefined)
  assert.equal(got.hideEnded, false)
  assert.equal('evil' in got, false)
})
