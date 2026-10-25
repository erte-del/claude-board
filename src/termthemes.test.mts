import test from 'node:test'
import assert from 'node:assert/strict'
import { TERM_THEMES, termTheme } from './termthemes.mts'

const HEX = /^#[0-9a-f]{6}$/i
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

test('every preset has a unique id and a complete, well-formed palette', () => {
  assert.equal(new Set(TERM_THEMES.map((t) => t.id)).size, TERM_THEMES.length)
  assert.equal(TERM_THEMES[0].id, 'default')
  for (const { id, theme } of TERM_THEMES) {
    assert.match(theme.background, HEX, id)
    if (id === 'default') continue
    for (const k of ['foreground', 'cursor', 'selectionBackground', ...ANSI, ...ANSI.map((n) => `bright${n[0].toUpperCase()}${n.slice(1)}`)]) assert.match(theme[k] ?? '', HEX, `${id}.${k}`)
  }
})

test('an unknown or missing id falls back to the default', () => {
  assert.equal(termTheme('nope'), TERM_THEMES[0].theme)
  assert.equal(termTheme(undefined), TERM_THEMES[0].theme)
  assert.equal(termTheme('dracula').background, '#282a36')
})
