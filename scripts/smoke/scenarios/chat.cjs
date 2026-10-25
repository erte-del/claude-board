// Real pty + real transcripts, against the stand-in claude.
const fs = require('fs')
const path = require('path')

module.exports = async function (t) {
  const A = t.fixtures.projA
  const info = async (id) => (await t.chats()).find((c) => c.id === id)

  // ---- finding claude, via the shell-environment capture (the Dock-launch bug)
  const status = await t.js('api.claudeStatus()')
  t.check('claude is found through the captured shell environment', status.ok && status.path.includes('scripts/smoke/bin'), JSON.stringify(status))
  t.check('no "claude not found" banner', await t.js(`document.getElementById('banner').hidden`))

  // ---- a new chat: starts, goes idle, shows its model / branch / context / cost from the transcript
  const id = await t.newChat(A)
  t.check('a new chat appears on the board as a card', !!(await t.waitFor(() => t.count('.card').then((n) => n === 1))))
  t.check('it settles to idle after start-up output stops', !!(await t.waitFor(async () => (await info(id)).status === 'idle', { timeout: 8000 })))
  t.check('the model is read off the start-up banner before any reply exists', (await info(id)).model === 'claude-sonnet-5-5', (await info(id)).model)
  await t.say(id, 'hello')
  const replied = await t.waitFor(async () => (await info(id)).feed.some((f) => f.includes('echo: hello')))
  t.check('the reply shows up in the card feed', !!replied)
  const c = await info(id)
  t.check('model comes from the transcript', c.model === 'claude-sonnet-5-5', c.model)
  t.check('branch comes from the transcript', c.branch === 'main', c.branch)
  t.check('context = the latest request (21,500 tokens of a 1M window)', c.contextTokens === 21500 && c.contextWindow === 1_000_000, JSON.stringify([c.contextTokens, c.contextWindow]))
  t.check('cost is estimated from usage at verified prices ($0.0065 per reply)', Math.abs(c.costUSD - 0.0065) < 1e-9, c.costUSD)
  t.check('the card shows ctx % and cost', (await t.text('.card .use')).includes('ctx 2%') && (await t.text('.card .use')).includes('~$0.01'), await t.text('.card .use'))

  // ---- working -> idle
  await t.say(id, 'sleep 3')
  t.check('status is "working" while the chat produces output', !!(await t.waitFor(async () => (await info(id)).status === 'working', { timeout: 4000, every: 150 })))
  t.check('and returns to idle afterwards', !!(await t.waitFor(async () => (await info(id)).status === 'idle', { timeout: 12000 })))

  // ---- a blocking question: waiting + dialog text + dock badge + alert badge; answering clears it
  await t.say(id, 'ask')
  const waiting = await t.waitFor(async () => (await info(id)).status === 'waiting', { timeout: 8000 })
  t.check('a dialog on screen makes the card "waiting"', !!waiting)
  { const f = (await info(id)).feed; t.check('the card shows the question', f.some((x) => x.includes('Do you want to proceed?')), JSON.stringify(f)) }
  t.check('the Dock badge counts it', !!(await t.waitFor(() => t.badge() === '1', { timeout: 3000 })), t.badge())
  t.check('the card has its orange alert badge', await t.js(`getComputedStyle(document.querySelector('.card .alert')).display !== 'none'`))
  await t.js(`api.ptyWrite(${JSON.stringify(id)}, '\\r')`)
  t.check('answering returns it to idle and clears the badge', !!(await t.waitFor(async () => (await info(id)).status === 'idle' && t.badge() === '', { timeout: 8000 })), t.badge())

  // ---- Yes / No buttons on the card answer a permission question
  const btn = (sel) => t.js(`(()=>{const b=document.querySelector('.card .ask ${sel}'); return b && getComputedStyle(b).display !== 'none' && !b.closest('[hidden]') ? b.textContent : null})()`)
  t.check('no answer buttons while nothing is being asked', (await btn('.ask-yes')) === null)
  await t.say(id, 'ask')
  await t.waitFor(async () => (await info(id)).prompt === 'Do you want to proceed?', { timeout: 8000 })
  { const c = await info(id); t.check('the card knows the question and shows what is being asked, not the option list', c.prompt === 'Do you want to proceed?' && c.feed.some((x) => x.includes('touch stub-file')) && !c.feed.some((x) => /^[❯>]?\s*\d\./.test(x)), JSON.stringify([c.prompt, c.feed])) }
  t.check('Yes and No buttons appear on the waiting card', (await btn('.ask-yes')) === 'Yes' && (await btn('.ask-no')) === 'No')
  { const w = await t.js(`api.answerPrompt(${JSON.stringify(id)}, 'Do you want to delete everything?', 'yes')`); t.check('an answer for a different question is refused', w.ok === false, JSON.stringify(w)) }
  t.check('and the dialog is still waiting', (await info(id)).status === 'waiting')
  await t.click('.card .ask-yes')
  t.check('Yes presses the plain "Yes" option (1), not "don\'t ask again"', !!(await t.waitFor(async () => (await info(id)).feed.some((x) => x.includes('answered: yes')), { timeout: 8000 })), JSON.stringify((await info(id)).feed))
  t.check('the buttons go away once answered', !!(await t.waitFor(async () => (await btn('.ask-yes')) === null, { timeout: 5000 })))
  await t.say(id, 'ask')
  await t.waitFor(async () => (await info(id)).prompt !== null, { timeout: 8000 })
  await t.click('.card .ask-no')
  t.check('No refuses with Esc', !!(await t.waitFor(async () => (await info(id)).feed.some((x) => x.includes('answered: no')), { timeout: 8000 })), JSON.stringify((await info(id)).feed))
  await t.say(id, 'ask')
  await t.waitFor(async () => (await info(id)).prompt !== null, { timeout: 8000 })
  await t.js(`api.ptyWrite(${JSON.stringify(id)}, '\\r')`)
  await t.waitFor(async () => (await info(id)).prompt === null, { timeout: 8000 })
  { const w = await t.js(`api.answerPrompt(${JSON.stringify(id)}, 'Do you want to proceed?', 'yes')`); t.check('a question already answered in the terminal cannot be answered again', w.ok === false, JSON.stringify(w)) }

  // ---- a sub-agent: its mini card appears inside the card, then goes away after it finishes
  await t.say(id, 'agent')
  t.check('a running sub-agent gets a mini card inside its chat\'s card', !!(await t.waitFor(() => t.count('.card .mini').then((n) => n === 1), { timeout: 8000 })))
  t.check('the mini card carries the sub-agent\'s description', (await t.text('.card .mini .mini-title')) === 'Stub helper')
  t.check('the chat\'s cost includes the sub-agent\'s usage', (await info(id)).costUSD > 0.0065 * 3 + 0.0009, (await info(id)).costUSD)
  t.check('a finished sub-agent disappears again', !!(await t.waitFor(() => t.count('.card .mini').then((n) => n === 0), { timeout: 20000 })))

  // ---- the chat view: banner, find in scrollback
  await t.openCard(0)
  await t.sleep(800)
  const find = async (q) => {
    await t.key('KeyF', { meta: true, key: 'f' }); await t.sleep(250)
    await t.js(`(()=>{const i=document.getElementById('find-input'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await t.sleep(400)
    const r = await t.text('#find-count')
    await t.js(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await t.sleep(150)
    return r
  }
  t.check('the terminal shows the chat\'s own output (find "Stub Claude")', /^\d+\/\d+$/.test(await find('Stub Claude')))
  t.check('find reports no results for text that is not there', (await find('zzqqxx-nope')) === 'No results')
  await t.key('KeyF', { meta: true, key: 'f' }); await t.sleep(250)
  t.check('⌘F puts the cursor in the find box', await t.js(`document.activeElement === document.getElementById('find-input')`))
  await t.js(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)

  // ---- ⌘⇧B goes back and is NOT typed into the terminal
  const before = t.spy.writes.length
  await t.js(`document.querySelector('.xterm-helper-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'B',code:'KeyB',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
  await t.sleep(500)
  t.check('⌘⇧B returns to the board', await t.js(`document.getElementById('chat').hidden`))
  t.check('and nothing was sent to the terminal for it', t.spy.writes.length === before, JSON.stringify(t.spy.writes.slice(before)))

  // ---- dropping a file on a terminal types its escaped path as a bracketed paste; dropping on the board does nothing
  const dropFile = path.join(t.home, 'My Drop (1).txt')
  fs.writeFileSync(dropFile, 'x')
  const drop = async (x, y) => {
    const dbg = t.wc.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    for (const type of ['dragEnter', 'dragOver', 'drop']) { await dbg.sendCommand('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: [dropFile], dragOperationsMask: 1 } }); await t.sleep(120) }
  }
  const url = await t.js('location.href')
  await drop(500, 400); await t.sleep(400)
  t.check('a file dropped on the board does not navigate away', (await t.js('location.href')) === url)
  await t.openCard(0); await t.sleep(600)
  t.spy.writes.length = 0
  await drop(500, 400); await t.sleep(500)
  const typed = t.spy.writes.map((w) => w.data).join('')
  t.check('a file dropped on the terminal types its shell-escaped path as a bracketed paste', typed === `\x1b[200~${t.home}/My\\ Drop\\ \\(1\\).txt \x1b[201~`, JSON.stringify(typed))
  await t.back()

  // ---- changing the terminal font changes what is drawn
  // GPU text rendering has tiny anti-aliasing noise, so compare pixels, not hashes: the share of pixels that visibly differ
  let lastPng = null
  const grab = async () => { const img = await t.wc.capturePage({ x: 8, y: 46, width: 300, height: 18 }); lastPng = img.toPNG(); return img.toBitmap() }
  // Compare the *shape* of the text (ink vs background), not exact colours: macOS anti-aliases text differently depending on whether the
  // window happens to be focused, which moves edge pixels but not glyphs. A different typeface changes the shapes.
  const ink = (b) => { const m = []; for (let i = 0; i < b.length; i += 4) m.push((b[i] + b[i + 1] + b[i + 2]) / 3 > 110 ? 1 : 0); return m }
  const differing = (x, y) => { const a = ink(x), b = ink(y); let n = 0, total = 0; for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) total++; if (a[i] !== b[i]) n++ } return total ? n / total : 0 } // share of inked pixels that disagree
  // wait until the picture stops changing (the GPU renderer may still be drawing glyphs just after the view opens), then take it
  const settled = async () => {
    let prev = await grab()
    for (let i = 0; i < 12; i++) { await t.sleep(300); const cur = await grab(); if (differing(prev, cur) < 0.002) return cur; prev = cur }
    return prev
  }
  const pngs = []
  const shot = async () => { await t.openCard(0); const px = await settled(); pngs.push(lastPng); await t.back(); return px }
  const p1 = await shot(), p2 = await shot()
  if (differing(p1, p2) >= 0.005) { fs.writeFileSync(path.join(process.env.SMOKE_KEEP_DIR || t.data, 'font-a.png'), pngs[0]); fs.writeFileSync(path.join(process.env.SMOKE_KEEP_DIR || t.data, 'font-b.png'), pngs[1]) }
  console.log(`@@info same-font difference: ${differing(p1, p2).toFixed(4)}`)
  const noise = differing(p1, p2) // the same font twice: usually 0, up to ~0.2 when macOS thickens the text in a focused window
  t.check('the same font renders (nearly) the same shapes twice, so the comparison means something', noise < 0.4, noise)
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(500)
  const offered = await t.js(`[...document.querySelectorAll('#settings select')][0] ? [...[...document.querySelectorAll('#settings select')][0].options].map(o=>o.value) : []`)
  t.check('the font picker offers Terminal.app\'s font plus installed monospace fonts', offered[0] === 'Terminal (SF Mono)' && offered.includes('Courier New'), JSON.stringify(offered.slice(0, 6)))
  await t.js(`(()=>{const s=[...document.querySelectorAll('#settings select')][0]; s.value='Courier New'; s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(400)
  const p3 = await shot()
  console.log(`@@info other-font difference: ${differing(p1, p3).toFixed(4)}`)
  t.check('picking another font visibly changes the rendering (far more than rendering noise does)', differing(p1, p3) > noise + 0.25, `${differing(p1, p3)} vs noise ${noise}`)
  await t.sleep(600)
  t.check('and the choice is saved', (t.readJson('settings.json') || {}).termFontFamily === 'Courier New')

  // ---- a chat that crashes: ended, with what it printed and the exit code
  const crasher = await t.newChat(A)
  await t.waitFor(async () => (await info(crasher)).status === 'idle', { timeout: 8000 })
  await t.say(crasher, 'crash')
  const crashed = await t.waitFor(async () => (await info(crasher)).status === 'ended', { timeout: 8000 })
  t.check('a crashed chat ends', !!crashed)
  const note = (await info(crasher)).feed.join('\n')
  t.check('its card says why (what it printed + the exit code)', note.includes('stub crash') && note.includes('[process exited with code 1]'), note)
  const logText = (() => { try { return fs.readFileSync(path.join(t.data, 'claude-board.log'), 'utf8') } catch { return '' } })()
  t.check('the crash is in the log file, with the exit code and what claude printed', /exit pid=\d+ .*code=1/.test(logText) && logText.includes('stub crash'), logText.slice(-300))


  // ---- kill, then remove
  const doomed = await t.newChat(A)
  await t.waitFor(async () => (await info(doomed)).status !== undefined)
  await t.js(`api.killChat(${JSON.stringify(doomed)})`)
  t.check('killing a chat ends it with a "[chat killed]" note', !!(await t.waitFor(async () => ((await info(doomed)) || {}).status === 'ended' && (await info(doomed)).feed.join('').includes('[chat killed]'), { timeout: 8000 })))
  await t.js(`api.killChat(${JSON.stringify(doomed)})`)
  t.check('killing an ended chat removes its card', !!(await t.waitFor(async () => !(await info(doomed)), { timeout: 4000 })))

  // ---- quitting with chats running asks first; Cancel keeps everything alive
  t.setQuitAnswer(1)
  const asked = { n: 0 }
  require('electron').app.quit()
  await t.sleep(1000)
  t.check('"Cancel" on the quit dialog keeps the app and its chats alive', !!t.win && !t.win.isDestroyed() && (await t.chats()).some((x) => x.status !== 'ended'))
  t.setQuitAnswer(0)

  // ---- "+" on a folder box starts another chat in that folder
  const beforePlus = (await t.chats()).length
  await t.click('.hub-add')
  const grewPlus = await t.waitFor(async () => (await t.chats()).length === beforePlus + 1, { timeout: 8000 })
  const newestPlus = (await t.chats()).slice(-1)[0]
  t.check('"+" on the folder box starts another chat in that folder', !!grewPlus && newestPlus.cwd === fs.realpathSync(A), JSON.stringify(newestPlus))

  // ---- chats open apps in the background: the open shim leads PATH and is $BROWSER
  const quiet = await t.newChat(A)
  await t.waitFor(async () => (await info(quiet)).status === 'idle', { timeout: 10000 })
  await t.say(quiet, 'quiet')
  const q = await t.waitFor(async () => (await info(quiet)).feed.join('').match(/quiet: (\S+) first=(\S+)/), { timeout: 8000 })
  t.check('a chat gets the no-focus "open" shim as $BROWSER and first on PATH', !!q && q[1].endsWith('/quiet-bin/open') && q[2].endsWith('/quiet-bin'), q && q[0])
  t.check('the shim opens in the background', fs.readFileSync(q[1], 'utf8').includes('open -g "$@"') && (fs.statSync(q[1]).mode & 0o111) !== 0)
}
