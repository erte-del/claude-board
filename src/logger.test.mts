import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLogger } from './logger.mts'

test('appends timestamped lines and rolls over to .old past the size limit', () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'cb-log-')), 'x.log')
  const log = createLogger(f, 100)
  log('first')
  assert.match(readFileSync(f, 'utf8'), /^\d{4}-\d\d-\d\dT.* first\n$/)
  log('x'.repeat(200)); log('after')
  assert.ok(existsSync(f + '.old'))
  assert.match(readFileSync(f, 'utf8'), /after\n$/)
})

test('an unwritable path does not throw', () => {
  createLogger('/nonexistent-dir/x.log')('hi')
})
