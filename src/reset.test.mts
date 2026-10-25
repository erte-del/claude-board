import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCountdown, parseReset, zonedToUtc } from './reset.mts'

const utc = (...a: [number, number, number, number, number]) => Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4])
const LOCAL = 'UTC'

test('"resets 2:40am (Asia/Dubai)" is the next 02:40 Dubai time after the message', () => {
  // message written 00:30 Dubai on Oct 25 (= 20:30Z on the 24th) -> 02:40 Dubai the same night = 22:40Z
  assert.equal(parseReset("You've hit your session limit · resets 2:40am (Asia/Dubai)", utc(2026, 10, 24, 20, 30), LOCAL), utc(2026, 10, 24, 22, 40))
})

test('a time that has already passed today means tomorrow (the answer is anchored to when the message was written)', () => {
  // message written 03:00 Dubai Oct 25 (23:00Z on the 24th), after today's 02:40 -> Oct 26 02:40 Dubai = Oct 25 22:40Z
  assert.equal(parseReset('resets 2:40am (Asia/Dubai)', utc(2026, 10, 24, 23, 0), LOCAL), utc(2026, 10, 25, 22, 40))
})

test('hour-only times and pm', () => {
  assert.equal(parseReset('resets 7pm (Asia/Dubai)', utc(2026, 10, 24, 10, 0), LOCAL), utc(2026, 10, 24, 15, 0)) // 19:00 Dubai
  assert.equal(parseReset('resets 12am (UTC)', utc(2026, 10, 24, 10, 0), LOCAL), utc(2026, 10, 25, 0, 0))
  assert.equal(parseReset('resets 12pm (UTC)', utc(2026, 10, 24, 10, 0), LOCAL), utc(2026, 10, 24, 12, 0))
})

test('weekly form with a date: "resets Oct 27 at 1am (Asia/Dubai)"', () => {
  assert.equal(parseReset('You\'ve used 76% of your weekly limit · resets Oct 27 at 1am (Asia/Dubai)', utc(2026, 10, 24, 12, 0), LOCAL), utc(2026, 10, 26, 21, 0))
})

test('a date early next year, written in December, lands in the next year', () => {
  assert.equal(parseReset('resets Jan 2 at 3am (UTC)', utc(2026, 12, 30, 12, 0), LOCAL), utc(2027, 1, 2, 3, 0))
})

test('daylight saving: 9am New York on the day the clocks change is EDT (UTC-4), not EST', () => {
  assert.equal(parseReset('resets 9am (America/New_York)', utc(2026, 3, 8, 6, 0), LOCAL), utc(2026, 3, 8, 13, 0))
  assert.equal(zonedToUtc(2026, 1, 15, 9, 0, 'America/New_York'), utc(2026, 1, 15, 14, 0)) // winter: UTC-5
})

test('no zone, or an unknown zone, falls back to the local zone', () => {
  assert.equal(parseReset('resets 3pm', utc(2026, 10, 24, 10, 0), 'Asia/Dubai'), utc(2026, 10, 24, 11, 0))
  assert.equal(parseReset('resets 3pm (Not/AZone)', utc(2026, 10, 24, 10, 0), 'Asia/Dubai'), utc(2026, 10, 24, 11, 0))
})

test('text without a reset time, or with an impossible one, gives null', () => {
  for (const t of ['', 'rate limited', 'resets soon', 'resets 13pm (UTC)', 'resets 0am (UTC)', 'resets 2:75am (UTC)', 'resets Foo 3 at 2am (UTC)'])
    assert.equal(parseReset(t, Date.now(), LOCAL), null, t)
})

test('countdown formatting', () => {
  assert.equal(formatCountdown(30_000), '<1m')
  assert.equal(formatCountdown(14 * 60_000), '14m')
  assert.equal(formatCountdown((2 * 60 + 5) * 60_000), '2h 05m')
  assert.equal(formatCountdown(50 * 3_600_000), '2d 2h')
})
