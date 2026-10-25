import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeCwd, parseTranscript } from './scanner.mts'

const j = (...es: object[]) => es.map((e) => JSON.stringify(e)).join('\n')
const user = (content: unknown, extra = {}) => ({ type: 'user', cwd: '/a/b', message: { role: 'user', content }, ...extra })

test('title: first real prompt, skipping meta and injected command echoes', () => {
  const t = j(
    user('<local-command-caveat>ignore</local-command-caveat>'),
    user('hidden', { isMeta: true }),
    user([{ type: 'tool_result', content: 'x' }]),
    user([{ type: 'text', text: 'fix   the\nlogin bug' }]),
  )
  assert.equal(parseTranscript(t, 'x').title, 'fix the login bug')
})

test('title: custom-title beats ai-title beats first prompt (last entry wins)', () => {
  const base = [user('hello'), { type: 'ai-title', aiTitle: 'AI one' }]
  assert.equal(parseTranscript(j(...base), 'x').title, 'AI one')
  assert.equal(parseTranscript(j(...base, { type: 'custom-title', customTitle: 'Mine' }, { type: 'custom-title', customTitle: 'Mine 2' }), 'x').title, 'Mine 2')
})

test('title: truncated to 60 chars', () => {
  const t = parseTranscript(j(user('a'.repeat(200))), 'x').title
  assert.equal(t.length, 60)
  assert.ok(t.endsWith('…'))
})

test('cwd: picks the one matching the project folder, not the first or the lossy decode', () => {
  const t = j(user('hi', { cwd: '/Users/me' }), user('hi', { cwd: '/Users/me/ULTRON_cBrain' }), user('hi', { cwd: '/Users/me/ULTRON_cBrain/backend' }))
  assert.equal(encodeCwd('/Users/me/ULTRON_cBrain'), '-Users-me-ULTRON-cBrain')
  assert.equal(parseTranscript(t, '-Users-me-ULTRON-cBrain').cwd, '/Users/me/ULTRON_cBrain')
})

test('cwd: falls back to relocatedCwd, then first cwd; null when absent', () => {
  assert.equal(parseTranscript(j(user('hi'), { type: 'relocated', relocatedCwd: '/r' }), 'nomatch').cwd, '/r')
  assert.equal(parseTranscript(j(user('hi')), 'nomatch').cwd, '/a/b')
  assert.equal(parseTranscript(j({ type: 'mode' }), 'x').cwd, null)
})

test('malformed lines are tolerated', () => {
  const t = ['not json', '{"type":"user","cwd":"/a/b","message":{"content":"ok"}', j(user('real prompt')), '[1,2]', 'null', '', '{"truncated":'].join('\n')
  const r = parseTranscript(t, 'x')
  assert.equal(r.title, 'real prompt')
  assert.equal(r.cwd, '/a/b')
})

test('message count: prompts + distinct assistant messages (one entry per content block)', () => {
  const a = (id: string) => ({ type: 'assistant', message: { id, content: [] } })
  assert.equal(parseTranscript(j(user('q1'), a('m1'), a('m1'), user('q2'), a('m2')), 'x').messageCount, 4)
})
