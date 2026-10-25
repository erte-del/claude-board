import test from 'node:test'
import assert from 'node:assert/strict'
import { commonBinDirs, findExecutable, parseEnv0 } from './shellenv.mts'

const M = '__MARK__'

test('parseEnv0 ignores shell start-up noise before the marker and reads every variable', () => {
  const out = `Last login: Sat\nsome zshrc banner\n${M}PATH=/a:/b\0HOME=/Users/me\0EMPTY=\0`
  assert.deepEqual(parseEnv0(out, M), { PATH: '/a:/b', HOME: '/Users/me', EMPTY: '' })
})

test('values may contain = and newlines', () => {
  const out = `${M}LS_COLORS=di=1;34:ln=36\0MULTI=line1\nline2\0`
  assert.deepEqual(parseEnv0(out, M), { LS_COLORS: 'di=1;34:ln=36', MULTI: 'line1\nline2' })
})

test('no marker (the shell died before printing) gives null; a repeated marker uses the last one', () => {
  assert.equal(parseEnv0('nothing useful', M), null)
  assert.equal(parseEnv0('', M), null)
  assert.deepEqual(parseEnv0(`${M}A=1\0noise ${M}B=2\0`, M), { B: '2' })
})

test('findExecutable walks PATH in order, then the extra folders, and skips non-executables', () => {
  const exec = new Set(['/usr/local/bin/claude', '/home/me/.local/bin/claude', '/opt/x/claude'])
  const isExec = (p: string) => exec.has(p)
  assert.equal(findExecutable('claude', '/bin:/usr/local/bin:/opt/x', ['/home/me/.local/bin'], isExec), '/usr/local/bin/claude') // PATH wins, in order
  assert.equal(findExecutable('claude', '/bin:/usr/bin', ['/home/me/.local/bin'], isExec), '/home/me/.local/bin/claude') // fallback folder
  assert.equal(findExecutable('claude', '/bin', ['/nowhere'], isExec), null)
  assert.equal(findExecutable('claude', '::/bin:', [], isExec), null) // empty PATH entries are ignored
})

test('the usual install folders include the one this was reported with (~/.local/bin)', () => {
  assert.ok(commonBinDirs('/Users/me').includes('/Users/me/.local/bin'))
})
