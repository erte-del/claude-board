import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeText, contextLevel, planContext, firstLine, inQuietHours, planFinished, wantAwake, planLimitReset, planNotifications, type AttnChat } from './attention.mts'

const chat = (o: Partial<AttnChat> & { id: string }): AttnChat => ({ cwd: '/p/proj', status: 'idle', detail: '', ...o })
const away = { enabled: true, watching: () => false }

test('notifies once when a chat becomes waiting, not on every tick', () => {
  const a = chat({ id: 'a', status: 'waiting', prev: 'working', detail: 'Do you want to proceed?' })
  const plans = planNotifications([a], away)
  assert.equal(plans.length, 1)
  assert.deepEqual(plans[0], { title: 'proj needs you', body: 'Do you want to proceed?', chatId: 'a', kind: 'waiting' })
  assert.equal(planNotifications([{ ...a, prev: 'waiting' }], away).length, 0)
})

test('a card the user renamed is announced by that name', () => {
  const plans = planNotifications([chat({ id: 'a', status: 'waiting', prev: 'idle', name: 'Payments refactor' })], away)
  assert.equal(plans[0].title, 'Payments refactor needs you')
})

test('a brand-new chat that starts out waiting (trust dialog) still notifies', () => {
  assert.equal(planNotifications([chat({ id: 'a', status: 'waiting', prev: undefined, detail: 'Trust this folder?' })], away).length, 1)
})

test('skips chats you are looking at, and everything when disabled', () => {
  const a = chat({ id: 'a', status: 'waiting', prev: 'idle' })
  assert.equal(planNotifications([a], { enabled: true, watching: (id) => id === 'a' }).length, 0)
  assert.equal(planNotifications([a], { enabled: false, watching: () => false }).length, 0)
})

test('a limit that turns three chats red gives one notification', () => {
  const l = (id: string) => chat({ id, status: 'limit', prev: 'working', detail: "You've hit your session limit · resets 2:40am" })
  const plans = planNotifications([l('a'), l('b'), l('c')], away)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].title, 'Usage limit reached')
  assert.match(plans[0].body, /resets 2:40am/)
  assert.equal(planNotifications([l('a'), l('b')].map((c) => ({ ...c, prev: 'limit' as const })), away).length, 0)
})

test('long dialog text is clipped; empty detail gets a default', () => {
  const long = planNotifications([chat({ id: 'a', status: 'waiting', prev: 'idle', detail: 'x'.repeat(500) })], away)[0].body
  assert.ok(long.length <= 140 && long.endsWith('…'))
  assert.equal(planNotifications([chat({ id: 'a', status: 'waiting', prev: 'idle', detail: '' })], away)[0].body, 'Waiting for your input')
})

test('a limit that lifts while you are away gives one "reset" notification', () => {
  assert.deepEqual(planLimitReset(true, false, false, true), { title: 'Usage limit reset', body: 'Your chats can continue.' })
  assert.equal(planLimitReset(true, true, false, true), null) // still limited
  assert.equal(planLimitReset(false, false, false, true), null) // was never limited
  assert.equal(planLimitReset(true, false, true, true), null) // you are looking at the board
  assert.equal(planLimitReset(true, false, false, false), null) // notifications off
  assert.equal(planLimitReset(true, false, false, true, false), null) // the chats ended (quitting): that is not the limit lifting
})

test('dock badge: limit beats waiting count beats nothing', () => {
  assert.equal(badgeText([{ status: 'idle' }, { status: 'working' }]), '')
  assert.equal(badgeText([{ status: 'waiting' }, { status: 'idle' }, { status: 'waiting' }]), '2')
  assert.equal(badgeText([{ status: 'waiting' }, { status: 'limit' }]), '!')
  assert.equal(badgeText([]), '')
})

test('keep awake: off never, always always, auto only while a chat is working', () => {
  const w = [{ status: 'working' as const }], idle = [{ status: 'idle' as const }, { status: 'waiting' as const }, { status: 'limit' as const }]
  assert.deepEqual([wantAwake('off', w), wantAwake(undefined, w), wantAwake('bogus', w)], [false, false, false])
  assert.deepEqual([wantAwake('always', []), wantAwake('always', idle)], [true, true])
  assert.deepEqual([wantAwake('auto', w), wantAwake('auto', idle), wantAwake('auto', [])], [true, false, false])
})

const fin = (o: Partial<Parameters<typeof planFinished>[0][0]> = {}) => ({ id: 'a', cwd: '/p/proj', status: 'idle' as const, prev: 'working' as const, reply: 'Fixed the bug.\nMore detail.', seen: null, ...o })

test('finished: working -> idle with a new reply announces its first line', () => {
  assert.deepEqual(planFinished([fin()], away), [{ title: 'proj finished', body: 'Fixed the bug.', chatId: 'a', kind: 'finished' }])
  assert.equal(planFinished([fin({ name: 'Payments' })], away)[0].title, 'Payments finished')
})

test('finished: not when off, muted, watched, already announced, or not a real finish', () => {
  assert.equal(planFinished([fin()], { enabled: false, watching: () => false }).length, 0)
  assert.equal(planFinished([fin({ muted: true })], away).length, 0)
  assert.equal(planFinished([fin()], { enabled: true, watching: () => true }).length, 0)
  assert.equal(planFinished([fin({ seen: 'Fixed the bug.\nMore detail.' })], away).length, 0) // same reply as before (resumed chat, or a tools-only turn)
  assert.equal(planFinished([fin({ reply: null })], away).length, 0)
  assert.equal(planFinished([fin({ prev: 'idle' })], away).length, 0) // it was not working
  assert.equal(planFinished([fin({ status: 'waiting' })], away).length, 0)
})

test('firstLine skips markdown markers and blank lines, and clips', () => {
  assert.equal(firstLine('\n\n## Done\nrest'), 'Done')
  assert.equal(firstLine('- `npm test` passes'), 'npm test passes')
  assert.ok(firstLine('x'.repeat(300)).length <= 140)
})

test('quiet hours: a window, one that wraps midnight, and none', () => {
  assert.deepEqual([9, 12, 13].map((h) => inQuietHours(h, 9, 13)), [true, true, false])
  assert.deepEqual([21, 22, 23, 0, 7, 8, 12].map((h) => inQuietHours(h, 22, 8)), [false, true, true, true, true, false, false])
  assert.equal(inQuietHours(10, 8, 8), false)
})

test('the waiting notification says what kind of thing the chat wants', () => {
  const t = (kind: AttnChat['kind']) => planNotifications([chat({ id: 'a', status: 'waiting', prev: 'working', kind })], away)[0].title
  assert.equal(t('permission'), 'proj needs a Yes/No')
  assert.equal(t('question'), 'proj asked you a question')
  assert.equal(t('trust'), 'proj asks whether you trust this folder')
  assert.equal(t(null), 'proj needs you')
})

test('contextLevel steps up at 80 and 95, and only steps down once clearly below', () => {
  assert.deepEqual([0, 79, 80, 94, 95, 100].map((p) => contextLevel(p, 0)), [0, 0, 1, 1, 2, 2])
  assert.equal(contextLevel(78, 1), 1) // hovering just under 80: still level 1
  assert.equal(contextLevel(74, 1), 0)
  assert.equal(contextLevel(92, 2), 2)
  assert.equal(contextLevel(89, 2), 1)
  assert.equal(contextLevel(null, 2), 2) // unknown keeps what we knew
})

test('context warnings: once at 80, once at 95, again only after a real drop', () => {
  const run = (pct: number | null, level: 0 | 1 | 2 | null, watching = false) => planContext([{ id: 'a', cwd: '/p/proj', pct, level }], { enabled: true, watching: () => watching })
  const a = run(81, 0)
  assert.equal(a.plans.length, 1)
  assert.equal(a.plans[0].title, 'proj: context 80% full')
  assert.equal(a.levels.get('a'), 1)
  assert.equal(run(83, 1).plans.length, 0) // still above 80: no repeat
  const b = run(96, 1)
  assert.equal(b.plans[0].title, 'proj: context 95% full')
  assert.equal(run(97, 2).plans.length, 0)
  assert.equal(run(50, 2).plans.length, 0) // after /compact: re-armed silently
  assert.equal(run(85, run(50, 2).levels.get('a')!).plans.length, 1) // and warns again on the next climb
})

test('context warnings: not at first sight, not when off or watched, but the level is still recorded', () => {
  const first = planContext([{ id: 'a', cwd: '/p/proj', pct: 90, level: null }], { enabled: true, watching: () => false })
  assert.equal(first.plans.length, 0) // a restored chat that is already full
  assert.equal(first.levels.get('a'), 1)
  const off = planContext([{ id: 'a', cwd: '/p/proj', pct: 90, level: 0 }], { enabled: false, watching: () => false })
  assert.equal(off.plans.length, 0)
  assert.equal(off.levels.get('a'), 1)
  assert.equal(planContext([{ id: 'a', cwd: '/p/proj', pct: 90, level: 0 }], { enabled: true, watching: () => true }).plans.length, 0)
  assert.equal(planContext([{ id: 'a', cwd: '/p/proj', pct: null, level: null }], { enabled: true, watching: () => false }).levels.get('a'), 0)
})
