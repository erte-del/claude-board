import test from 'node:test'
import assert from 'node:assert/strict'
import { appendReplay, modePrefix } from './replaybuf.mts'

test('under the cap nothing is dropped', () => {
  assert.equal(appendReplay('ab', 'cd', 10), 'abcd')
})
test('a trimmed buffer starts after a line break, not inside an escape sequence', () => {
  assert.equal(appendReplay('xx\x1b[2mdim\nnext', ' line', 14), 'next line')
})
test('no line break in the kept tail: keep it as is', () => {
  assert.equal(appendReplay('', 'abcdef', 3), 'def')
})
test('modes replay as DECSET/DECRST, without synchronized output', () => {
  assert.equal(modePrefix(new Map([[1049, true], [2026, true], [1006, true], [25, false]])), '\x1b[?1049h\x1b[?1006h\x1b[?25l')
})
