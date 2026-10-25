import test from 'node:test'
import assert from 'node:assert/strict'
import { contextOf, formatTokens, formatUsd, messageCost } from './pricing.mts'

test('messageCost: known model priced per token class, unknown model null', () => {
  const u = { in: 1_000_000, out: 1_000_000, read: 1_000_000, write1h: 1_000_000, write5m: 1_000_000 }
  assert.equal(messageCost('claude-sonnet-5-5', u), 2 + 10 + 0.1 + 4 + 2.5)
  assert.equal(messageCost('claude-opus-5-5', u), null)
  assert.equal(messageCost(null, u), null)
})

test('contextOf counts everything the request had to read', () => {
  assert.equal(contextOf({ in: 2, out: 999, read: 466_611, write1h: 1_866, write5m: 0 }), 468_479)
})

test('formatting', () => {
  assert.equal(formatTokens(950), '950')
  assert.equal(formatTokens(468_479), '468k')
  assert.equal(formatTokens(1_250_000), '1.3M')
  assert.equal(formatUsd(0.001), '<$0.01')
  assert.equal(formatUsd(0.291), '$0.29')
  assert.equal(formatUsd(12.34), '$12.3')
  assert.equal(formatUsd(123.4), '$123')
})
