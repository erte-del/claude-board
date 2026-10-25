import test from 'node:test'
import assert from 'node:assert/strict'
import { shellEscapePath } from './shellpath.mts'

test('plain paths are left alone', () => {
  assert.equal(shellEscapePath('/Users/me/proj/file-1.txt'), '/Users/me/proj/file-1.txt')
  assert.equal(shellEscapePath('~/a_b/c@d+e=f,g:h%i'), '~/a_b/c@d+e=f,g:h%i')
})

test('spaces and shell metacharacters are backslash-escaped', () => {
  assert.equal(shellEscapePath('/tmp/My Screenshot (1).png'), '/tmp/My\\ Screenshot\\ \\(1\\).png')
  assert.equal(shellEscapePath("/tmp/it's & $HOME;`x`|y>z<w*?#!"), "/tmp/it\\'s\\ \\&\\ \\$HOME\\;\\`x\\`\\|y\\>z\\<w\\*\\?\\#\\!")
  assert.equal(shellEscapePath('/tmp/a"b\\c'), '/tmp/a\\"b\\\\c')
})

test('non-ASCII names (accents, CJK, emoji) are kept readable', () => {
  assert.equal(shellEscapePath('/tmp/café/日本語.txt'), '/tmp/café/日本語.txt')
  assert.equal(shellEscapePath('/tmp/shot 📸.png'), '/tmp/shot\\ 📸.png')
})

test('control characters in a name fall back to single quotes', () => {
  assert.equal(shellEscapePath('/tmp/a\nb'), "'/tmp/a\nb'")
  assert.equal(shellEscapePath("/tmp/a\tb'c"), "'/tmp/a\tb'\\''c'")
})
