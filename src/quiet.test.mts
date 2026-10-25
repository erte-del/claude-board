import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quietEnv, SHIM_SCRIPT } from './quiet.mts'

test('quietEnv puts the shim first on PATH and sets BROWSER', () => {
  const e = quietEnv({ PATH: '/usr/bin:/bin', HOME: '/h' }, '/d/quiet-bin')
  assert.equal(e.PATH, '/d/quiet-bin:/usr/bin:/bin')
  assert.equal(e.BROWSER, '/d/quiet-bin/open')
  assert.equal(e.HOME, '/h')
})
test('quietEnv works without a PATH', () => assert.equal(quietEnv({}, '/d').PATH, '/d'))
test('the shim opens in the background', () => assert.match(SHIM_SCRIPT, /open -g "\$@"/))
