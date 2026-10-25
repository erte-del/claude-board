import test from 'node:test'
import assert from 'node:assert/strict'
import { installedEditors } from './editors.mts'

test('finds editors in /Applications, ~/Applications and the system Utilities folder', () => {
  const have = new Set(['/Applications/Cursor.app', '/System/Applications/Utilities/Terminal.app'])
  assert.deepEqual(installedEditors((p) => have.has(p), '/Users/me').map((e) => e.id), ['cursor', 'terminal'])
  assert.deepEqual(installedEditors((p) => p === '/Users/me/Applications/Visual Studio Code.app', '/Users/me').map((e) => e.id), ['code'])
  assert.deepEqual(installedEditors(() => false, '/Users/me'), [])
})
