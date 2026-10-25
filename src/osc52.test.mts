import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOsc52 } from './osc52.mts'

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('a copy request gives its text, whatever the target letters, and keeps unicode', () => {
  assert.equal(parseOsc52(`c;${b64('hello')}`), 'hello')
  assert.equal(parseOsc52(`;${b64('no target')}`), 'no target')
  assert.equal(parseOsc52(`pc;${b64('ünï ✓ 日本')}`), 'ünï ✓ 日本')
})

test('a request to READ the clipboard, empty or malformed data, and oversize data give null', () => {
  assert.equal(parseOsc52('c;?'), null)
  assert.equal(parseOsc52('c;'), null)
  assert.equal(parseOsc52('c'), null)
  assert.equal(parseOsc52('c;not base64!!'), null)
  assert.equal(parseOsc52(`c;${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64')}`), null) // not UTF-8
  assert.equal(parseOsc52(`c;${b64('x'.repeat(2000))}`, 1000), null)
  assert.equal(parseOsc52(`c;${b64('x'.repeat(1000))}`, 1000), 'x'.repeat(1000))
})
