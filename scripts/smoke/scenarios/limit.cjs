// A usage limit: every chat turns red with a countdown, and lifts by itself when its time passes. Slow (waits for the clock).
module.exports = async function (t) {
  const A = t.fixtures.projA
  const a = await t.newChat(A), b = await t.newChat(A)
  const info = async (id) => (await t.chats()).find((c) => c.id === id)
  await t.waitFor(async () => (await info(a)).status === 'idle' && (await info(b)).status === 'idle', { timeout: 10000 })
  await t.say(a, 'limit 8') // lifts at the next whole minute that is at least 8s away
  t.check('every chat turns red, including the one that was never used', !!(await t.waitFor(async () => (await info(a)).status === 'limit' && (await info(b)).status === 'limit', { timeout: 8000 })))
  const resetAt = (await info(b)).limitResetAt
  t.check('the reset time is read from the notice (the next whole minute)', !!resetAt && resetAt % 60000 === 0 && resetAt > Date.now(), resetAt)
  t.check('the Dock shows "!" while the limit holds', !!(await t.waitFor(() => t.badge() === '!', { timeout: 3000 })), t.badge())
  t.check('red cards show a countdown in place of tokens/s', /^↻ (<1m|\d+m)$/.test((await t.text('.card .tps', 1)).trim()), await t.text('.card .tps', 1))
  const lifted = await t.waitFor(async () => (await info(a)).status !== 'limit' && (await info(b)).status !== 'limit', { timeout: 75000, every: 500 })
  t.check('the limit lifts by itself when the time passes (no reply needed)', !!lifted)
  t.check('and the Dock badge clears', !!(await t.waitFor(() => t.badge() === '', { timeout: 3000 })), t.badge())
}
