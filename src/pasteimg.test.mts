import test from 'node:test'
import assert from 'node:assert/strict'
import { staleImages } from './pasteimg.mts'

const id = '123e4567-e89b-12d3-a456-426614174000'
test('only our own pasted images older than a day are swept', () => {
  const now = 10 * 24 * 3600_000
  const files = [
    { name: `paste-${id}.png`, mtimeMs: now - 25 * 3600_000 }, // old: swept
    { name: `paste-${id.replace('0000', '1111')}.png`, mtimeMs: now - 3600_000 }, // fresh: kept
    { name: `paste-${id}.jpg`, mtimeMs: now - 48 * 3600_000 }, // old jpeg: swept
    { name: 'notes.txt', mtimeMs: 0 }, // not ours, however old
    { name: `paste-${id}.png.bak`, mtimeMs: 0 },
    { name: 'paste-../../x.png', mtimeMs: 0 },
  ]
  assert.deepEqual(staleImages(files, now), [`paste-${id}.png`, `paste-${id}.jpg`])
})
