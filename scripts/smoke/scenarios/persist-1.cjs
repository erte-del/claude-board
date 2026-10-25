// Launch 1 of 2: build up state, then quit with chats still running. persist-2 checks what comes back.
const fs = require('fs')
const path = require('path')

module.exports = async function (t) {
  const A = t.fixtures.projA, B = fs.realpathSync(t.fixtures.projB)
  const info = async (id) => (await t.chats()).find((c) => c.id === id)

  // an old chat this app never started: a transcript on disk, like Claude Code leaves behind
  const dir = path.join(t.home, '.claude', 'projects', B.replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const at = (s) => new Date(Date.now() - s * 1000).toISOString()
  fs.writeFileSync(path.join(dir, 'hist-1.jsonl'), [
    { type: 'user', cwd: B, gitBranch: 'main', sessionId: 'hist-1', timestamp: at(900), message: { role: 'user', content: 'Old chat about invoices' } },
    { type: 'assistant', cwd: B, gitBranch: 'main', sessionId: 'hist-1', timestamp: at(890), message: { id: 'h1', model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: 'Invoices are in the billing folder.' }], usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 20000, cache_creation_input_tokens: 500, cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 } } } },
    { type: 'ai-title', sessionId: 'hist-1', aiTitle: 'Invoices chat' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')

  // two chats; only the first gets a message (a chat that never had one has no transcript, so it cannot come back)
  const a = await t.newChat(A), unused = await t.newChat(A)
  await t.waitFor(async () => (await info(a)).status === 'idle', { timeout: 10000 })
  await t.say(a, 'persist-me')
  t.check('the first chat gets a reply', !!(await t.waitFor(async () => (await info(a)).feed.some((f) => f.includes('echo: persist-me')))))
  const sessionA = (await info(a)).sessionId

  // a name, an added history chat
  await t.js(`document.querySelectorAll('.card')[0].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await t.sleep(300)
  await t.js(`[...document.querySelectorAll('.ctxmenu button')].find(b=>b.textContent==='Rename').click()`)
  await t.waitFor(() => t.js(`!document.querySelectorAll('.card')[0].querySelector('.name-input').hidden`), { timeout: 4000 })
  await t.js(`(()=>{const i=document.querySelectorAll('.card')[0].querySelector('.name-input'); i.value='Keep me'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`)
  t.check('the chat is renamed', !!(await t.waitFor(async () => (await t.text('.card .name', 0)) === 'Keep me', { timeout: 4000 })))
  await t.key('KeyO', { meta: true, key: 'o' })
  t.check('⌘O lists the old chat from Claude Code\'s history', !!(await t.waitFor(() => t.js(`[...document.querySelectorAll('.result b')].some(b=>b.textContent==='Invoices chat')`), { timeout: 6000 })))
  await t.js(`(()=>{const s=document.getElementById('search'); s.value='invoices'; s.dispatchEvent(new Event('input',{bubbles:true}))})()`); await t.sleep(400)
  await t.js(`document.getElementById('search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  t.check('adding it puts a gray, resumable card on the board', !!(await t.waitFor(async () => (await t.chats()).some((c) => c.sessionId === 'hist-1' && c.status === 'ended' && c.resumable), { timeout: 5000 })))
  await t.key('KeyO', { meta: true, key: 'o' }); await t.sleep(1200) // reopening fetches a fresh list
  t.check('and it no longer appears in the picker', !(await t.js(`[...document.querySelectorAll('.result b')].some(b=>b.textContent==='Invoices chat')`)))
  await t.js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await t.sleep(300)

  // settings, board view, window
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(400)
  await t.js(`[...document.querySelectorAll('#settings .segmented button')].find(b=>b.textContent==='Midnight').click()`); await t.sleep(300)
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(300)
  await t.js(`document.getElementById('board').dispatchEvent(new WheelEvent('wheel',{deltaX:-90,deltaY:-60,bubbles:true,cancelable:true}))`); await t.sleep(300)
  t.win.setBounds({ x: 60, y: 70, width: 1000, height: 700 }); await t.sleep(1200)
  const view = t.readJson('board-layout.json')?.view
  t.check('the pan is saved', !!view)

  // end on a usage limit, with everything still running (this is stale state the next launch must not believe)
  await t.say(a, 'limit 25')
  t.check('a limit is in effect when the app quits', !!(await t.waitFor(async () => (await info(unused)).status === 'limit', { timeout: 8000 })))
  await t.sleep(700)

  fs.writeFileSync(path.join(t.data, 'phase1.json'), JSON.stringify({ sessionA, view, bounds: t.win.getBounds() }))
  t.leaveChatsRunning = true // quit the way a user does: chats still running; the quit handler must stop them all
}
