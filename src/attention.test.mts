import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeText, planLimitReset, planNotifications, type AttnChat } from './attention.mts'

const chat = (o: Partial<AttnChat> & { id: string }): AttnChat => ({ cwd: '/p/proj', status: 'idle', detail: '', ...o })
const away = { enabled: true, watching: () => false }

test('notifies once when a chat becomes waiting, not on every tick', () => {
  const a = chat({ id: 'a', status: 'waiting', prev: 'working', detail: 'Do you want to proceed?' })
  const plans = planNotifications([a], away)
  assert.equal(plans.length, 1)
  assert.deepEqual(plans[0], { title: 'proj needs you', body: 'Do you want to proceed?', chatId: 'a' })
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
