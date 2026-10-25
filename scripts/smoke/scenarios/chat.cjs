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

  // ---- permission mode badge, read off the status line
  { const modeBadge = () => t.js(`(()=>{const m=document.querySelector('.card .mode'); return m && !m.hidden ? [m.textContent, m.classList.contains('risky')] : null})()`)
    t.check('the card shows the permission mode, and auto is flagged as risky', !!(await t.waitFor(async () => JSON.stringify(await modeBadge()) === '["auto",true]', { timeout: 4000 })), JSON.stringify(await modeBadge()))
    await t.say(id, 'mode manual')
    t.check('the main process reads the new mode off the status line', !!(await t.waitFor(async () => (await info(id)).permMode === 'manual', { timeout: 5000 })), (await info(id)).permMode)
    t.check('switching to manual mode updates the badge and drops the risky look', !!(await t.waitFor(async () => JSON.stringify(await modeBadge()) === '["manual",false]', { timeout: 5000 })), JSON.stringify(await modeBadge()))
    await t.say(id, 'mode auto'); await t.waitFor(async () => (await info(id)).permMode === 'auto', { timeout: 5000 }) }

  // ---- keep-awake: set through the real Customize control, observed on Electron's powerSaveBlocker
  { const { powerSaveBlocker } = require('electron')
    const blocking = () => { for (let i = 0; i < 100; i++) if (powerSaveBlocker.isStarted(i)) return true; return false }
    const pick = async (label) => { await t.js(`(()=>{const r=[...document.querySelectorAll('#settings .row')].find(r=>r.textContent.startsWith('Keep Mac awake')); [...r.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()})()`) }
    await t.key('Comma', { meta: true, key: ',' }); await t.sleep(400)
    t.check('keep awake is off by default: no blocker while idle', !blocking())
    await pick('When working'); await t.sleep(900)
    t.check('"When working" holds no blocker while the chat is idle', !blocking())
    await t.say(id, 'sleep 3')
    t.check('"When working" blocks sleep while a chat works', !!(await t.waitFor(blocking, { timeout: 4000, every: 150 })))
    t.check('and releases it when the chat goes idle', !!(await t.waitFor(() => !blocking(), { timeout: 12000 })))
    await pick('Always'); t.check('"Always" blocks sleep even when idle', !!(await t.waitFor(blocking, { timeout: 3000 })))
    await pick('Off'); t.check('"Off" releases it', !!(await t.waitFor(() => !blocking(), { timeout: 3000 })))
    await t.key('Escape', { key: 'Escape' }); await t.sleep(300) }

  // ---- a blocking question: waiting + dialog text + dock badge + alert badge; answering clears it
  await t.say(id, 'ask')
  const waiting = await t.waitFor(async () => (await info(id)).status === 'waiting', { timeout: 8000 })
  t.check('a dialog on screen makes the card "waiting"', !!waiting)
  { const f = (await info(id)).feed; t.check('the card shows the question', f.some((x) => x.includes('Do you want to proceed?')), JSON.stringify(f)) }
  t.check('the Dock badge counts it', !!(await t.waitFor(() => t.badge() === '1', { timeout: 3000 })), t.badge())
  t.check('the card has its orange alert badge', await t.js(`getComputedStyle(document.querySelector('.card .alert')).display !== 'none'`))
  await t.js(`api.ptyWrite(${JSON.stringify(id)}, '\\r')`)
  { const c = await info(id); const tag = await t.waitFor(async () => /needs Yes\/No/.test(await t.text('.card .tps', 0)) || null, { timeout: 3000 })
    t.check('a tool permission is labelled as such on the card, in the data and the alert tooltip', c.waitKind === 'permission' && !!tag && (await t.js(`document.querySelector('.card .alert').title`)).includes('Yes/No'), JSON.stringify([c.waitKind, await t.text('.card .tps', 0)])) }
  t.check('answering returns it to idle and clears the badge', !!(await t.waitFor(async () => (await info(id)).status === 'idle' && t.badge() === '', { timeout: 8000 })), t.badge())
  for (const [cmd, kind, tag, key] of [['question', 'question', 'question', '\x1b'], ['trust', 'trust', 'trust?', '\x1b']]) {
    await t.say(id, cmd)
    const ok = await t.waitFor(async () => (await info(id)).waitKind === kind, { timeout: 8000 })
    t.check(`a ${cmd} dialog is told apart from a permission: kind "${kind}"`, !!ok, JSON.stringify((await info(id)).waitKind))
    t.check(`and its card says "${tag}"`, !!(await t.waitFor(async () => (await t.text('.card .tps', 0)) === tag, { timeout: 3000 })), await t.text('.card .tps', 0))
    t.check(`a ${cmd} dialog gets no Yes/No buttons`, (await info(id)).prompt === null)
    await t.js(`api.ptyWrite(${JSON.stringify(id)}, ${JSON.stringify(key)})`)
    await t.waitFor(async () => (await info(id)).status === 'idle', { timeout: 8000 })
  }

  // ---- Yes / No buttons on the card answer a permission question
  const btn = (sel) => t.js(`(()=>{const b=document.querySelector('.card .ask ${sel}'); return b && getComputedStyle(b).display !== 'none' && !b.closest('[hidden]') ? b.textContent : null})()`)
  t.check('no answer buttons while nothing is being asked', !!(await t.waitFor(async () => (await btn('.ask-yes')) === null, { timeout: 3000 }))) // the card repaints a moment after the answer
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

  // ---- ⌘V with an image on the clipboard types the path of a saved copy; text still pastes as text
  { const { clipboard, ClipboardItem } = require('electron')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
    const paste = (kind) => t.js(`(()=>{const dt=new DataTransfer(); ${kind === 'image' ? `dt.items.add(new File([new Uint8Array([1])],'x.png',{type:'image/png'}))` : `dt.setData('text/plain','plain words')`}; const ta=document.querySelector('.pane .xterm-helper-textarea, .xterm-helper-textarea'); ta.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true})()`)
    t.spy.writes.length = 0
    await paste('image'); await t.sleep(800)
    const got = t.spy.writes.map((w) => w.data).join('')
    const m = /^\x1b\[200~(\/\S+\/claude-board-paste\/paste-[0-9a-f-]{36}\.png) \x1b\[201~$/.exec(got)
    t.check('pasting an image types the path of a saved copy as a bracketed paste', !!m, JSON.stringify(got))
    t.check('the saved file is the clipboard image (a PNG)', !!m && fs.readFileSync(m[1]).subarray(0, 8).equals(png.subarray(0, 8)))
    t.check('and only the owner can read it', !!m && (fs.statSync(m[1]).mode & 0o077) === 0)
    t.spy.writes.length = 0
    await paste('text'); await t.sleep(500)
    t.check('plain text still pastes as text', t.spy.writes.map((w) => w.data).join('') === '\x1b[200~plain words\x1b[201~', JSON.stringify(t.spy.writes.map((w) => w.data))) }
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
  const crasherSid = (await info(crasher)).sessionId
  await t.waitFor(async () => (await info(crasher)).status === 'idle', { timeout: 8000 })
  await t.say(crasher, 'crash')
  const crashed = await t.waitFor(async () => (await info(crasher)).status === 'ended', { timeout: 8000 })
  t.check('a crashed chat ends', !!crashed)
  const note = (await info(crasher)).feed.join('\n')
  t.check('its card says why (what it printed + the exit code)', note.includes('stub crash') && note.includes('[process exited with code 1]'), note)
  const logText = (() => { try { return fs.readFileSync(path.join(t.data, 'claude-board.log'), 'utf8') } catch { return '' } })()
  t.check('the crash is in the log file, with the exit code and what claude printed', /exit pid=\d+ .*code=1/.test(logText) && logText.includes('stub crash'), logText.slice(-300))

  // ---- restart a crashed chat: a button on the card resumes the same session
  const restartBtn = () => t.js(`(()=>{const b=document.querySelector('.card:not(.gone) .ask-restart:not([hidden])'); return !!b && !b.closest('[hidden]') && getComputedStyle(b).display !== 'none'})()`)
  t.check('a crashed chat is marked crashed and its card offers Restart', (await info(crasher)).crashed === true && !!(await t.waitFor(restartBtn, { timeout: 4000 })))
  const cardsBefore = await t.count('.card')
  await t.js(`document.querySelector('.card:not(.gone) .ask-restart:not([hidden])').click()`)
  t.check('Restart resumes the same session in the same card', !!(await t.waitFor(async () => { const c = (await t.chats()).find((x) => x.sessionId === crasherSid); return c && c.status !== 'ended' && !c.crashed }, { timeout: 8000 })) && (await t.count('.card')) === cardsBefore)
  t.check('and the Restart button goes away', !!(await t.waitFor(async () => !(await restartBtn()), { timeout: 4000 })))

  // ---- auto-restart (setting, off by default): resumes a crashed chat itself, but gives up after 3 tries in 10 minutes
  { const readLog = () => { try { return fs.readFileSync(path.join(t.data, 'claude-board.log'), 'utf8') } catch { return '' } }
    const logTail = () => readLog().split('\n').filter((l) => /restart|exit pid|start pid/.test(l)).slice(-8).map((l) => l.slice(11, 19) + l.slice(24).replace(/cwd=\S+/, '').slice(0, 60)).join(' | ')
    const saved = (await t.js('api.loadSettings()')) || {}
    await t.js(`api.saveSettings(${JSON.stringify({ ...saved, autoResume: true })})`)
    const flaky = await t.newChat(A)
    await t.waitFor(async () => (await info(flaky)).status === 'idle', { timeout: 8000 })
    const sid = (await info(flaky)).sessionId
    await t.say(flaky, 'crash')
    t.check('with auto-restart on, a crashed chat comes back by itself', !!(await t.waitFor(async () => { const c = (await t.chats()).find((x) => x.sessionId === sid); return c && c.id !== flaky && c.status === 'idle' }, { timeout: 12000 })) && !!(await t.waitFor(() => readLog().includes('auto-restart 1/3'), { timeout: 3000 })), logTail())
    const again = (await t.chats()).find((x) => x.sessionId === sid)
    await t.say(again.id, 'crashloop')
    t.check('a chat that keeps crashing is restarted 3 times, then left alone', !!(await t.waitFor(() => readLog().includes('giving up on ' + sid), { timeout: 20000 })), logTail())
    const last = (await t.waitFor(async () => { const c = (await t.chats()).find((x) => x.sessionId === sid); return c && c.status === 'ended' && c }, { timeout: 5000 }))
    t.check('and it ends with its Restart button instead of looping', !!last && last.crashed && (readLog().match(/auto-restart \d\/3/g) || []).length === 3, JSON.stringify(last && [last.status, last.crashed]))
    await t.js(`api.saveSettings(${JSON.stringify({ ...saved, autoResume: false })})`) }


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

  // ---- opening prompt: the second field of the new-chat bar, passed as an argument (after `--`), never through a shell
  { const odd = '--help $(touch /tmp/should-not-exist) "q"'
    const start = async (prompt) => {
      const before = (await t.chats()).length
      await t.key('KeyN', { meta: true, key: 'n' }); await t.sleep(400)
      await t.js(`(()=>{document.getElementById('cmd').value=${JSON.stringify(A)}; document.getElementById('opening').value=${JSON.stringify(prompt)}; document.getElementById('newchat').requestSubmit()})()`)
      await t.waitFor(async () => (await t.chats()).length === before + 1, { timeout: 8000 })
      return (await t.chats()).slice(-1)[0]
    }
    const withPrompt = await start('say hi to the board')
    t.check('an opening prompt is the first message of the new chat', !!(await t.waitFor(async () => (await info(withPrompt.id)).feed.some((f) => f.includes('echo: say hi to the board')), { timeout: 8000 })), JSON.stringify((await info(withPrompt.id)).feed))
    t.check('and the field is cleared for next time', (await t.js(`document.getElementById('opening').value`)) === '')
    const tricky = await start(odd)
    t.check('a prompt full of flags, quotes and $(…) arrives verbatim, unexecuted', !!(await t.waitFor(async () => (await info(tricky.id)).feed.some((f) => f.includes('echo: ' + odd)), { timeout: 8000 })) && !fs.existsSync('/tmp/should-not-exist'), JSON.stringify((await info(tricky.id)).feed))
    const plain = await start('')
    await t.sleep(1500)
    t.check('without a prompt the chat just waits at its prompt', !(await info(plain.id)).feed.some((f) => f.includes('echo:'))) }

  // ---- fork: a new chat from a copy of this one's history, under a new session id
  { const readLog = () => { try { return fs.readFileSync(path.join(t.data, 'claude-board.log'), 'utf8') } catch { return '' } }
    const src = await info(id)
    const before = (await t.chats()).map((c) => c.id)
    await t.js(`document.querySelectorAll('.card')[0].querySelector('.fork').click()`)
    const fork = await t.waitFor(async () => (await t.chats()).find((c) => !before.includes(c.id)), { timeout: 8000 })
    t.check('the fork button starts a new chat (a new card, a new session)', !!fork && fork.sessionId !== src.sessionId, JSON.stringify(fork && fork.sessionId))
    t.check('it was started with --resume <source> --fork-session and its own --session-id', readLog().includes(`--resume ${src.sessionId} --fork-session --session-id ${fork.sessionId}`), readLog().slice(-300))
    t.check('it shows the history it was forked from', !!(await t.waitFor(async () => (await t.chats()).find((c) => c.id === fork.id).feed.some((f) => f.includes('echo: hello')), { timeout: 8000 })))
    t.check('and settles to idle, not limit or waiting', !!(await t.waitFor(async () => (await t.chats()).find((c) => c.id === fork.id).status === 'idle', { timeout: 8000 })))
    await t.say(fork.id, 'only in the fork')
    const file = (sid) => path.join(t.home, '.claude', 'projects', fs.realpathSync(A).replace(/[^a-zA-Z0-9]/g, '-'), sid + '.jsonl')
    await t.waitFor(() => fs.existsSync(file(fork.sessionId)) && fs.readFileSync(file(fork.sessionId), 'utf8').includes('only in the fork'), { timeout: 8000 })
    t.check('new messages go to the fork\'s transcript only', fs.readFileSync(file(fork.sessionId), 'utf8').includes('only in the fork') && !fs.readFileSync(file(src.sessionId), 'utf8').includes('only in the fork'))
    t.check('the source chat is untouched and still running', (await info(id)).status !== 'ended')
    const empty = await t.newChat(A)
    await t.waitFor(async () => (await info(empty)).status === 'idle', { timeout: 8000 })
    const r = await t.js(`api.forkChat(${JSON.stringify((await info(empty)).sessionId)})`)
    t.check('a chat with no messages says there is nothing to fork', r.ok === false && /Nothing to fork/.test(r.error), JSON.stringify(r)) }

  // ---- undo remove: ✕ on an ended card removes it (with a toast), Undo / ⌘Z brings it back
  { const x = await t.newChat(A)
    await t.waitFor(async () => (await info(x)).status === 'idle', { timeout: 8000 })
    await t.say(x, 'remember me')
    const sid = (await info(x)).sessionId
    await t.waitFor(async () => (await info(x)).feed.some((f) => f.includes('echo: remember me')), { timeout: 8000 })
    const xBtn = () => t.js(`(()=>{const b=document.querySelector('.card[data-sid="${sid}"] .kill'); if(!b) return false; b.click(); return true})()`)
    const toastText = () => t.js(`(()=>{const e=document.getElementById('toast'); return e.classList.contains('open') ? e.textContent : null})()`)
    await xBtn()
    await t.waitFor(async () => (await info(x)).status === 'ended', { timeout: 8000 })
    t.check('✕ on a live chat only kills it (no removal toast, card stays)', (await toastText()) === null && (await t.count(`.card[data-sid="${sid}"]`)) === 1)
    await xBtn()
    t.check('✕ on the ended card removes it and offers Undo', !!(await t.waitFor(async () => /^Removed .*Undo$/.test((await toastText()) || '') && (await t.count(`.card[data-sid="${sid}"]`)) === 0, { timeout: 4000 })), await toastText())
    t.check('the removal is logged in removed.json', (t.readJson('removed.json') || []).some((e) => e.sessionId === sid))
    await t.js(`document.querySelector('#toast button').click()`)
    t.check('Undo brings the card back as a resumable gray card', !!(await t.waitFor(async () => { const c = (await t.chats()).find((y) => y.sessionId === sid); return c && c.status === 'ended' && c.resumable && (await t.count(`.card[data-sid="${sid}"]`)) === 1 }, { timeout: 6000 })))
    t.check('and it is off the removed list again', !(t.readJson('removed.json') || []).some((e) => e.sessionId === sid))
    await xBtn()
    await t.waitFor(async () => (await t.count(`.card[data-sid="${sid}"]`)) === 0, { timeout: 4000 })
    await t.key('KeyB', { meta: true, shift: true, key: 'B' }); await t.sleep(400) // ⌘Z undoes on the board
    await t.js('document.activeElement && document.activeElement.blur()')
    await t.key('KeyZ', { meta: true, key: 'z' })
    t.check('⌘Z does the same', !!(await t.waitFor(async () => (await t.count(`.card[data-sid="${sid}"]`)) === 1, { timeout: 6000 })))
    const none = await t.js('api.undoRemove()')
    t.check('with nothing left to undo it says so', none.ok === false, JSON.stringify(none)) }

  // ---- card menu on real chats: Finder, copy path, open in an app (the app is pointed at a recorder instead of /usr/bin/open)
  { const { clipboard } = require('electron')
    const mc = await t.newChat(A)
    await t.waitFor(async () => (await info(mc)).status === 'idle', { timeout: 8000 })
    const sid = (await info(mc)).sessionId, cwd = fs.realpathSync(A)
    const opened = () => { try { return fs.readFileSync(path.join(t.data, 'opened.log'), 'utf8').trim().split('\n') } catch { return [] } }
    const choose = async (label) => {
      await t.js(`document.querySelector('.card[data-sid="${sid}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await t.sleep(300)
      return t.js(`(()=>{const b=[...document.querySelectorAll('.ctxmenu button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!b) return false; b.click(); return true})()`)
    }
    t.check('"Show in Finder" opens the chat\'s folder', (await choose('Show in Finder')) && !!(await t.waitFor(() => opened().includes(cwd), { timeout: 4000 })), JSON.stringify(opened()))
    t.check('"Open in Terminal" opens it in that app', (await choose('Open in Terminal')) && !!(await t.waitFor(() => opened().includes(`-a Terminal ${cwd}`), { timeout: 4000 })), JSON.stringify(opened()))
    t.check('"Copy path" puts the folder on the clipboard and says so', (await choose('Copy path')) && !!(await t.waitFor(async () => (await clipboard.readText()) === cwd, { timeout: 4000 })) && /Path copied/.test(await t.text('#toast')))
    const bad = await t.js(`api.openFolder(${JSON.stringify(sid)}, '../../bin/sh')`)
    const unknown = await t.js(`api.openFolder('not-a-chat', 'finder')`)
    t.check('the page can only name a chat and a fixed action, never a path or a command', bad.ok === false && unknown.ok === false && !opened().some((l) => l.includes('sh')), JSON.stringify([bad, unknown]))
    t.check('"Kill chat" in the menu kills it', (await choose('Kill chat')) && !!(await t.waitFor(async () => (await info(mc)).status === 'ended', { timeout: 8000 }))) }
}
