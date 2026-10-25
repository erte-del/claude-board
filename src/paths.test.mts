import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openingArgs, resolveDir } from './paths.mts'

const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'home-'))) // macOS's temp dir is itself a symlink
mkdirSync(path.join(home, 'proj'))
mkdirSync(path.join(home, 'my dir'))
writeFileSync(path.join(home, 'file.txt'), 'x')
const ok = (p: string) => ({ ok: true, path: p })

test('cd / ~ / relative / absolute forms all resolve', () => {
  assert.deepEqual(resolveDir('cd ~/proj', home), ok(path.join(home, 'proj')))
  assert.deepEqual(resolveDir('~/proj', home), ok(path.join(home, 'proj')))
  assert.deepEqual(resolveDir('cd proj', home), ok(path.join(home, 'proj')))
  assert.deepEqual(resolveDir(`cd ${path.join(home, 'proj')}`, home), ok(path.join(home, 'proj')))
  assert.deepEqual(resolveDir('cd', home), ok(home))
  assert.deepEqual(resolveDir('  cd   ~  ', home), ok(home))
})

test('quotes and escaped spaces', () => {
  assert.deepEqual(resolveDir('cd "my dir"', home), ok(path.join(home, 'my dir')))
  assert.deepEqual(resolveDir("cd 'my dir'", home), ok(path.join(home, 'my dir')))
  assert.deepEqual(resolveDir('cd my\\ dir', home), ok(path.join(home, 'my dir')))
})

test('missing folders and plain files are errors', () => {
  const r = resolveDir('cd nope', home)
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /No such folder/)
  assert.equal(resolveDir('cd file.txt', home).ok, false)
})

test('a symlinked folder resolves to its real path (that is where the chat\'s transcript will be filed)', () => {
  symlinkSync(path.join(home, 'proj'), path.join(home, 'link'))
  assert.deepEqual(resolveDir('cd link', home), ok(path.join(home, 'proj')))
  assert.deepEqual(resolveDir(path.join(home, 'link'), home), ok(path.join(home, 'proj')))
})

test('openingArgs puts a first message after `--` and ignores blanks and non-strings', () => {
  assert.deepEqual(openingArgs('fix the bug'), ['--', 'fix the bug'])
  assert.deepEqual(openingArgs('  --help $(rm -rf ~) "x"  '), ['--', '--help $(rm -rf ~) "x"']) // kept verbatim: no shell, no flags
  assert.deepEqual([openingArgs(''), openingArgs('   '), openingArgs(undefined), openingArgs(42)], [[], [], [], []])
  assert.equal(openingArgs('x'.repeat(20000))[1].length, 10000)
})
