import test from 'node:test'
import assert from 'node:assert/strict'
import { contextOf, formatTokens, formatUsd, messageCost } from './pricing.mts'

test('messageCost: known model priced per token class, unknown model null', () => {
  const u = { in: 1_000_000, out: 1_000_000, read: 1_000_000, write1h: 1_000_000, write5m: 1_000_000 }
  assert.equal(messageCost('claude-sonnet-5-5', u), 2 + 10 + 0.1 + 4 + 2.5)
  assert.equal(messageCost(null, u), null)
})

test('Haiku 5.5 reproduces Claude Code\'s own cost totals (lastModelUsage) for three real sessions', () => {
  const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
  close(messageCost('claude-haiku-5-5', { in: 1171, out: 13, read: 0, write1h: 0, write5m: 0 }), 0.0001236)
  close(messageCost('claude-haiku-5-5', { in: 1203, out: 27, read: 0, write1h: 0, write5m: 0 }), 0.0001338)
  close(messageCost('claude-haiku-5-5', { in: 1192, out: 175, read: 28584, write1h: 48946, write5m: 0 }), 0.01028174)
})

test('Opus 5.5 reproduces Claude Code\'s own cost totals (lastModelUsage) for five real projects', () => {
  const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
  const opus = (i: number, o: number, r: number, w: number) => messageCost('claude-opus-5-5', { in: i, out: o, read: r, write1h: w, write5m: 0 })
  close(opus(104, 1274, 241313, 30103), 0.3149826)
  close(opus(2626, 285, 442519, 58139), 0.5698198)
  close(opus(22, 31891, 819266, 112612), 1.7026572)
  close(opus(240, 76205, 24808253, 224175), 8.2801106)
  close(opus(122, 6484, 1221559, 70134), 0.9355518)
  assert.equal(messageCost('claude-opus-5-5', { in: 1, out: 1, read: 0, write1h: 0, write5m: 1 }), null)
})

test('a price with an unverified class gives no cost when that class is used', () => {
  assert.equal(messageCost('claude-haiku-5-5', { in: 10, out: 10, read: 0, write1h: 0, write5m: 1 }), null) // 5-minute writes: never seen, never priced
  assert.equal(messageCost('claude-fable-5-1', { in: 1, out: 1, read: 0, write1h: 0, write5m: 0 }), null)
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
