import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shortTitle, SubagentWatcher, Tailer, TranscriptState } from './tailer.mts'

const user = (ts: string, content: unknown = 'hi') => ({ type: 'user', timestamp: ts, message: { content } })
const asst = (ts: string, content: unknown[], extra: object = {}) =>
  ({ type: 'assistant', timestamp: ts, gitBranch: 'main', message: { model: 'claude-opus-5', content, usage: { output_tokens: 100 }, ...extra } })

test('model, branch, feed and tokens/sec from a turn', () => {
  const s = new TranscriptState()
  s.apply(user('2026-01-01T00:00:00.000Z'))
  s.apply(asst('2026-01-01T00:00:04.000Z', [{ type: 'thinking' }, { type: 'text', text: 'Looking now' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }]))
  assert.equal(s.model, 'claude-opus-5')
  assert.equal(s.branch, 'main')
  assert.deepEqual(s.feed, ['Looking now', '▸ Bash ls -la'])
  assert.equal(s.tps, 25) // 100 tokens over 4s
})

test('pending tool_use is cleared by its tool_result', () => {
  const s = new TranscriptState()
  s.apply(asst('2026-01-01T00:00:01.000Z', [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }]))
  assert.equal(s.pending.size, 1)
  s.apply(user('2026-01-01T00:00:02.000Z', [{ type: 'tool_result', tool_use_id: 't1' }]))
  assert.equal(s.pending.size, 0)
})

test('rate-limit entry sets limit; the next normal reply clears it', () => {
  const s = new TranscriptState()
  s.apply({ type: 'assistant', error: 'rate_limit', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 2:40am" }] } })
  assert.match(s.limit!, /session limit/)
  assert.equal(s.model, null) // synthetic model is ignored
  s.apply(asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'back' }]))
  assert.equal(s.limit, null)
})

test('a rate-limit notice records when it lifts, anchored to when it was written; a normal reply clears both', () => {
  const s = new TranscriptState()
  s.apply({ type: 'assistant', error: 'rate_limit', timestamp: '2026-10-24T20:30:00.000Z', message: { content: [{ type: 'text', text: "You've hit your session limit · resets 2:40am (Asia/Dubai)" }] } })
  assert.equal(s.limitResetAt, Date.UTC(2026, 9, 24, 22, 40)) // 02:40 Dubai = 22:40Z
  s.apply({ type: 'assistant', error: 'rate_limit', timestamp: '2026-10-24T20:30:00.000Z', message: { content: [{ type: 'text', text: 'limit reached, try later' }] } })
  assert.equal(s.limitResetAt, null) // a notice with no time
  assert.ok(s.limit)
  s.apply(asst('2026-10-24T23:00:00.000Z', [{ type: 'text', text: 'back' }]))
  assert.equal(s.limit, null)
  assert.equal(s.limitResetAt, null)
})

test('other API errors go to the feed but are not a limit', () => {
  const s = new TranscriptState()
  s.apply({ type: 'assistant', error: 'server_error', message: { content: [{ type: 'text', text: 'API Error: 500' }] } })
  assert.equal(s.limit, null)
  assert.deepEqual(s.feed, ['API Error: 500'])
})

test('main state ignores sidechain entries, sidechain state ignores main ones; feed is capped', () => {
  const s = new TranscriptState()
  s.apply({ ...asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'sub' }]), isSidechain: true })
  assert.equal(s.feed.length, 0)
  const sub = new TranscriptState(true)
  sub.apply({ ...asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'sub' }]), isSidechain: true })
  sub.apply(asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'main' }]))
  assert.deepEqual(sub.feed, ['sub'])
  for (let i = 0; i < 30; i++) s.apply(asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: `m${i}` }]))
  assert.equal(s.feed.length, 12)
  assert.equal(s.feed.at(-1), 'm29')
})

test('Tailer: missing file, partial last line, malformed line', () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'tail-')), 's.jsonl')
  const t = new Tailer(f)
  assert.equal(t.poll(), false) // file does not exist yet
  const line = JSON.stringify(asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'one' }]))
  writeFileSync(f, line + '\nnot json\n' + line.slice(0, 20)) // third line is mid-write
  assert.equal(t.poll(), true)
  assert.deepEqual(t.state.feed, ['one'])
  appendFileSync(f, line.slice(20) + '\n')
  assert.equal(t.poll(), true)
  assert.deepEqual(t.state.feed, ['one', 'one'])
  assert.equal(t.poll(), false)
})

test('catchUp: reads history but drops stale limit and pending-tool state; exists flag', () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'cu-')), 's.jsonl')
  const t = new Tailer(f)
  assert.equal(t.exists, false)
  writeFileSync(f, [
    JSON.stringify(asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'earlier' }, { type: 'tool_use', id: 'p', name: 'Bash', input: {} }])),
    JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: 'session limit' }] } }),
  ].join('\n') + '\n')
  t.catchUp()
  assert.equal(t.exists, true)
  assert.ok(t.state.feed.includes('earlier')) // history is kept for display
  assert.equal(t.state.limit, null)
  assert.equal(t.state.pending.size, 0)
  appendFileSync(f, JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: 'limit again' }] } }) + '\n')
  t.poll()
  assert.equal(t.state.limit, 'limit again') // but new live entries still count
})

test('SubagentWatcher.catchUp: sub-agents from a past process never show as running', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'subc-')), 'subagents')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'agent-old.jsonl'), JSON.stringify({ ...asst('2026-01-01T00:00:01.000Z', [{ type: 'text', text: 'x' }]), isSidechain: true }) + '\n')
  writeFileSync(path.join(dir, 'agent-old.meta.json'), JSON.stringify({ description: 'dead one', finished: false }))
  const w = new SubagentWatcher(dir)
  w.catchUp()
  assert.equal(w.running().length, 0)
})

test('SubagentWatcher: running while unfinished, lingers briefly when finished, ignores unrelated files', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'sub-')), 'subagents')
  const w = new SubagentWatcher(dir)
  w.poll() // no directory yet
  assert.equal(w.running().length, 0)
  mkdirSync(dir)
  const line = JSON.stringify({ ...asst('2026-01-01T00:00:01.000Z', [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'sleep 6' } }]), isSidechain: true })
  writeFileSync(path.join(dir, 'agent-abc.jsonl'), line + '\n')
  writeFileSync(path.join(dir, 'agent-abc.meta.json'), JSON.stringify({ description: 'Run sleep', finished: false }))
  writeFileSync(path.join(dir, 'notes.txt'), 'x')
  w.poll()
  const [a] = w.running()
  assert.equal(w.running().length, 1)
  assert.equal(a.title, 'Run sleep')
  assert.deepEqual(a.tailer.state.feed, ['▸ Bash sleep 6'])
  writeFileSync(path.join(dir, 'agent-abc.meta.json'), JSON.stringify({ description: 'Run sleep', finished: true }))
  w.poll()
  assert.equal(w.running().length, 1) // just finished: still shown
  assert.equal(w.running(Date.now() + 10_000).length, 0) // gone after the linger window
})

test('usage: one entry per message id (blocks repeat the totals), context = latest request, cost from verified prices', () => {
  const s = new TranscriptState()
  const usage = (o: object) => ({ output_tokens: 0, input_tokens: 0, cache_read_input_tokens: 0, ...o })
  const a = (id: string, content: unknown[], u: object) => ({ type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id, model: 'claude-sonnet-5-5', content, usage: u } })
  const u1 = usage({ input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5_000, cache_creation: { ephemeral_1h_input_tokens: 5_000, ephemeral_5m_input_tokens: 0 }, output_tokens: 1_000 })
  s.apply(a('m1', [{ type: 'thinking' }], u1))
  s.apply(a('m1', [{ type: 'text', text: 'x' }], u1)) // same message, second block: must not double count
  assert.equal(s.contextTokens(), 95_010)
  // 10*2 + 1000*10 + 90000*0.1 + 5000*4(1h) = 20 + 10000 + 9000 + 20000 = 39020 -> $0.03902
  assert.ok(Math.abs(s.costUSD()! - 0.03902) < 1e-9)
  s.apply(a('m2', [{ type: 'text', text: 'y' }], usage({ cache_read_input_tokens: 100_000, output_tokens: 500, cache_creation_input_tokens: 2_000, cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 0 } })))
  assert.equal(s.contextTokens(), 102_000) // latest request, not a sum
  // m2: 500*10 + 100000*0.1 + 2000*2.5(5m) = 5000 + 10000 + 5000 = 20000 -> +$0.02
  assert.ok(Math.abs(s.costUSD()! - 0.05902) < 1e-9)
  assert.equal(s.lastModel(), 'claude-sonnet-5-5')
})

test('cost is withheld (null) for a model without a verified price, but context still works', () => {
  const s = new TranscriptState()
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 1000 } } })
  assert.equal(s.costUSD(), null)
  assert.equal(s.contextTokens(), 1005)
  assert.equal(new TranscriptState().costUSD(), null) // nothing yet
})

test('usage without a cache_creation split counts all writes as 1h (what Claude Code uses)', () => {
  const s = new TranscriptState()
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm', model: 'claude-sonnet-5-5', content: [], usage: { cache_creation_input_tokens: 1_000_000 } } })
  assert.equal(s.costUSD(), 4)
})

test('SubagentWatcher.costUSD sums every sub-agent, finished ones included', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'subcost-')), 'subagents')
  mkdirSync(dir)
  for (const [id, out] of [['a', 1_000_000], ['b', 500_000]] as const)
    writeFileSync(path.join(dir, `agent-${id}.jsonl`), JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: '2026-01-01T00:00:01.000Z', message: { id: `m${id}`, model: 'claude-sonnet-5-5', content: [], usage: { output_tokens: out } } }) + '\n')
  const w = new SubagentWatcher(dir)
  w.poll()
  assert.equal(w.costUSD(), 15) // 1.5M output tokens at $10/MTok
})

test('lastReply is the newest assistant text in full, not clipped like the feed', () => {
  const s = new TranscriptState()
  const long = 'word '.repeat(100).trim()
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id: 'm1', content: [{ type: 'text', text: 'first' }] } })
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm2', content: [{ type: 'text', text: long }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }] } })
  assert.equal(s.lastReply, long)
  assert.ok(s.feed[1].length < long.length)
})

test('interrupted: the user stopping a turn is the newest thing until anything else happens', () => {
  const s = new TranscriptState()
  const user = (text: string) => ({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: [{ type: 'text', text }] } })
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id: 'm1', content: [{ type: 'text', text: 'working on it' }] } })
  assert.equal(s.interrupted, false)
  s.apply(user('[Request interrupted by user]'))
  assert.equal(s.interrupted, true)
  s.apply(user('carry on'))
  assert.equal(s.interrupted, false)
  s.apply(user('[Request interrupted by user for tool use]')) // a refused tool counts too
  assert.equal(s.interrupted, true)
  s.apply({ type: 'assistant', timestamp: '2026-01-01T00:00:05Z', message: { id: 'm2', content: [{ type: 'text', text: 'ok' }] } })
  assert.equal(s.interrupted, false)
  s.apply({ ...user('[Request interrupted by user]'), message: { role: 'user', content: '[Request interrupted by user]' } }) // plain-string content too
  assert.equal(s.interrupted, true)
})

test('the chat title comes from Claude Code; /rename beats the generated one and is not overwritten by it', () => {
  const s = new TranscriptState()
  assert.equal(s.title, null)
  s.apply({ type: 'ai-title', aiTitle: 'Fix login redirect loop' })
  assert.equal(s.title, 'Fix login redirect loop')
  s.apply({ type: 'custom-title', customTitle: 'Auth work' })
  s.apply({ type: 'ai-title', aiTitle: 'Something newer' })
  assert.equal(s.title, 'Auth work')
})

test('shortTitle caps at four words and treats blank as no title', () => {
  assert.equal(shortTitle('Claude Board idle chats flashing working'), 'Claude Board idle chats')
  assert.equal(shortTitle('  Two words '), 'Two words')
  assert.equal(shortTitle('   '), null)
  assert.equal(shortTitle(null), null)
})
