import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRegistry } from './registry.mts'

test('keeps valid entries in order, drops junk and duplicates', () => {
  const raw = [
    { sessionId: 'a', cwd: '/x' },
    null,
    'str',
    { sessionId: 'b' },
    { sessionId: '', cwd: '/y' },
    { sessionId: 'a', cwd: '/other' },
    { sessionId: 'c', cwd: '/z', extra: 1 },
  ]
  assert.deepEqual(sanitizeRegistry(raw), [{ sessionId: 'a', cwd: '/x' }, { sessionId: 'c', cwd: '/z' }])
})

test('non-arrays (missing or corrupt file) give an empty registry', () => {
  for (const bad of [null, undefined, {}, 'x', 5]) assert.deepEqual(sanitizeRegistry(bad), [])
})
