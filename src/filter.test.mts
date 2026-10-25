import test from 'node:test'
import assert from 'node:assert/strict'
import { matches, statusMatches } from './filter.mts'

test('empty or blank query matches everything', () => {
  assert.ok(matches('', ['x']))
  assert.ok(matches('   ', []))
})

test('case-insensitive substring across all the card text', () => {
  const parts = ['Payments refactor', 'agent-office', '/Users/me/repos/agent-office', 'sonnet-5-5', 'feat/top-bar', 'Patching the handler', null, undefined]
  assert.ok(matches('PAYMENTS', parts))
  assert.ok(matches('top-bar', parts))
  assert.ok(matches('handler', parts))
  assert.ok(!matches('nonexistent', parts))
})

test('every word must be present, in any order and any field', () => {
  const parts = ['Payments refactor', 'agent-office']
  assert.ok(matches('office payments', parts))
  assert.ok(!matches('office invoices', parts))
})

test('status chips: none selected means all, otherwise any of the selected', () => {
  assert.ok(statusMatches(new Set(), 'working'))
  assert.ok(statusMatches(new Set(['working', 'waiting']), 'waiting'))
  assert.ok(!statusMatches(new Set(['working', 'waiting']), 'idle'))
  assert.ok(statusMatches(new Set(['ended']), 'ended'))
})
