// Two chats side by side, with real ptys.
module.exports = async function (t) {
  const A = t.fixtures.projA
  const a = await t.newChat(A), b = await t.newChat(A)
  const info = async (id) => (await t.chats()).find((c) => c.id === id)
  await t.waitFor(async () => (await info(a)).status === 'idle' && (await info(b)).status === 'idle', { timeout: 10000 })
  await t.say(a, 'alphaword'); await t.say(b, 'betaword')
  await t.waitFor(async () => (await info(a)).feed.some((f) => f.includes('alphaword')) && (await info(b)).feed.some((f) => f.includes('betaword')))

  const view = () => t.js(`(()=>{const p=[...document.querySelectorAll('.pane')]; return {panes:p.length, split:document.getElementById('wrap').classList.contains('split'), widths:p.map(x=>Math.round(x.getBoundingClientRect().width)), active:p.findIndex(x=>x.classList.contains('active')), bar:document.getElementById('chat-name').textContent, heads:p.map(x=>getComputedStyle(x.querySelector('.pane-head')).display)}})()`)
  const find = async (q) => {
    await t.key('KeyF', { meta: true, key: 'f' }); await t.sleep(250)
    await t.js(`(()=>{const i=document.getElementById('find-input'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await t.sleep(450)
    const r = await t.text('#find-count')
    await t.js(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await t.sleep(150)
    return r
  }

  await t.openCard(0); await t.sleep(1500)
  let v = await view()
  t.check('one chat opens as a single full-width pane without a pane header', v.panes === 1 && !v.split && v.heads[0] === 'none' && v.widths[0] > 1000, JSON.stringify(v))
  const fullCols = t.spy.cols[a]

  await t.click('#split'); await t.sleep(400)
  t.check('the Split menu offers the other chat (and not the one on screen)', (await t.count('#split-menu .menu-item')) === 1)
  await t.click('#split-menu .menu-item'); await t.sleep(2500)
  v = await view()
  t.check('choosing it shows two panes side by side, each with a header', v.panes === 2 && v.split && v.heads.every((h) => h !== 'none') && Math.abs(v.widths[0] - v.widths[1]) < 4, JSON.stringify(v))
  t.check('each terminal is resized to its half (about half the columns)', t.spy.cols[a] < fullCols * 0.6 && t.spy.cols[b] < fullCols * 0.6, JSON.stringify([fullCols, t.spy.cols[a], t.spy.cols[b]]))

  await t.click('.pane', { index: 0 }); await t.sleep(250)
  const inA = [await find('alphaword'), await find('betaword')]
  await t.click('.pane', { index: 1 }); await t.sleep(250)
  const inB = [await find('betaword'), await find('alphaword')]
  t.check('both panes are live and independent (each finds only its own chat\'s output)', /^\d+\/\d+$/.test(inA[0]) && inA[1] === 'No results' && /^\d+\/\d+$/.test(inB[0]) && inB[1] === 'No results', JSON.stringify([inA, inB]))

  await t.click('.pane', { index: 0 }); await t.sleep(250)
  const f0 = await view(); await t.click('.pane', { index: 1 }); await t.sleep(250); const f1 = await view()
  t.check('clicking a pane focuses it', f0.active === 0 && f1.active === 1, JSON.stringify([f0.active, f1.active]))

  // typing goes to the focused pane's chat only
  t.spy.writes.length = 0
  await t.js(`document.querySelectorAll('.pane')[0].querySelector('.xterm-helper-textarea').focus()`)
  await t.click('.pane', { index: 0 }); await t.sleep(250)
  await t.js(`(()=>{const ta=document.querySelectorAll('.pane')[0].querySelector('.xterm-helper-textarea'); ta.focus(); ta.value='z'; ta.dispatchEvent(new InputEvent('input',{data:'z',inputType:'insertText',bubbles:true}))})()`); await t.sleep(300)
  t.check('keystrokes go to the focused pane\'s chat', t.spy.writes.length > 0 && t.spy.writes.every((w) => w.id === a), JSON.stringify(t.spy.writes))

  // closing a pane
  await t.click('.pane-close', { index: 0 }); await t.sleep(1200)
  v = await view()
  t.check('closing a pane leaves the other full-width, and its chat keeps running', v.panes === 1 && !v.split && v.widths[0] > 1000 && (await info(a)).status !== 'ended', JSON.stringify(v))
  await t.back(); await t.sleep(500)
  t.check('going back to the board closes every pane', (await t.count('.pane')) === 0 && (await t.js(`document.getElementById('chat').hidden`)))

  // shift-click opens the clicked chat beside the one last viewed (that was b)
  await t.click('.card', { index: 0, shift: true }); await t.sleep(3500)
  v = await view()
  t.check('shift-clicking a card opens it beside the chat you were last viewing', v.panes === 2 && v.split, JSON.stringify(v))
  await t.key('Digit1', { meta: true, key: '1' }); await t.sleep(700); const c1 = await view()
  await t.key('Digit2', { meta: true, key: '2' }); await t.sleep(700); const c2 = await view()
  t.check('⌘1 / ⌘2 focus the pane already showing that chat instead of opening a third', c1.panes === 2 && c2.panes === 2 && c1.active !== c2.active, JSON.stringify([c1, c2]))
  await t.back()
}
