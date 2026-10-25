// The board, driven with synthetic chats (no processes): rendering, filtering, layout, keyboard, settings.
module.exports = async function (t) {
  const FUTURE = Date.now() + (2 * 3600 + 14 * 60 + 20) * 1000
  const chat = (n, o) => ({ id: `c${n}`, sessionId: `s${n}`, cwd: '/fx/ULTRON', status: 'idle', model: 'claude-sonnet-5-5', branch: 'main', tps: null, feed: ['ok'], subagents: [], resumable: false, contextTokens: 120000, contextWindow: 1000000, costUSD: 0.43, limitResetAt: null, ...o })
  const fixtures = (variant) => {
    const list = [
      chat(1, { status: 'working', tps: 42, costUSD: 10.557, contextTokens: 468000, feed: ['checking the tests for the restart endpoint.', '▸ Bash npm test'], subagents: [{ id: 'a1', title: 'Explore auth', status: 'working', feed: ['▸ Grep verifyToken'] }, { id: 'a2', title: 'Run tests', status: 'working', feed: ['▸ Bash npm test'] }, { id: 'a3', title: 'Review diff', status: 'ended', feed: ['Looks good.'] }] }),
      chat(2, { status: 'waiting', model: 'claude-opus-5-5', branch: 'feat/top-bar', costUSD: null, contextTokens: 850000, feed: ['Do you want to proceed?', '❯ 1. Yes'] }),
      chat(3, { feed: ['Done. The restart button now shows backend status.'] }),
      chat(4, { status: 'ended', resumable: true, branch: 'fix/x', feed: ['Process exited.'], contextTokens: 30000, costUSD: null }),
      chat(5, { cwd: '/fx/office', status: 'working', model: 'claude-haiku-5-5', branch: 'dev', tps: 88, costUSD: null, contextWindow: null, contextTokens: 200000, subagents: [{ id: 'b1', title: 'Search TODOs', status: 'waiting', feed: ['Do you want to proceed?'] }] }),
      chat(6, { cwd: '/fx/office', feed: ['All set.'], contextTokens: null, costUSD: null }),
    ]
    if (variant === 'limit') for (const c of list) if (c.status !== 'ended') { c.status = 'limit'; c.limitResetAt = FUTURE }
    return list
  }
  const cards = () => t.js(`[...document.querySelectorAll('.card')].map(c=>[...c.classList].filter(x=>/^(s-|gone|dim|sel|has-subs)/.test(x)).join(' '))`)
  const settle = (ms = 700) => t.sleep(ms)
  const load = async (variant) => { t.send('chats:changed', fixtures(variant)); await t.waitFor(() => t.count('.card').then((n) => n === 6), { timeout: 5000 }); await settle() }

  await load()
  // ---- rendering
  t.check('six cards in two folders', (await t.count('.card')) === 6 && (await t.count('.hub')) === 2)
  const cls = await cards()
  const n = (re) => cls.filter((c) => re.test(c)).length
  t.check('status colours: 2 working, 1 waiting, 2 idle, 1 ended', n(/s-working/) === 2 && n(/s-waiting/) === 1 && n(/s-idle/) === 2 && n(/s-ended/) === 1, JSON.stringify(cls))
  t.check('exactly one card and one sub-agent mini show the "!" alert', (await t.js(`[...document.querySelectorAll('.card .alert, .mini .alert')].filter(e=>getComputedStyle(e).display!=='none').length`)) === 2)
  t.check('sub-agents appear as mini cards (3 + 1) and the chat that has them grows', (await t.count('.mini')) === 4 && (await t.js(`(()=>{const h=[...document.querySelectorAll('.card')].map(c=>c.getBoundingClientRect().height); return h[0]>h[5]*1.5})()`)))
  t.check('context % and cost show on the card (ctx 47%, ~$10.6)', /ctx 47%/.test(await t.text('.card .use', 0)) && /~\$10\.6/.test(await t.text('.card .use', 0)), await t.text('.card .use', 0))
  t.check('a model with no verified price shows "—" for cost', /—$/.test((await t.text('.card .use', 1)).trim()), await t.text('.card .use', 1))
  t.check('an unknown context window shows raw tokens instead of a percent', /ctx 200k/.test(await t.text('.card .use', 4)), await t.text('.card .use', 4))
  t.check('a gray restored card invites you to resume it', (await t.text('.card .feed', 3)).includes('Click to resume'))

  // ---- popovers take keyboard focus (regression: the fade-in used to leave focus on the page)
  const focused = () => t.js(`document.activeElement && (document.activeElement.id || document.activeElement.tagName)`)
  await t.key('KeyN', { meta: true, key: 'n' }); await settle(400)
  t.check('⌘N puts the cursor in the folder box', (await focused()) === 'cmd', await focused())
  await t.js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await settle(300)
  await t.key('KeyO', { meta: true, key: 'o' }); await settle(900)
  t.check('⌘O puts the cursor in the chat search box', (await focused()) === 'search', await focused())
  await t.js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await settle(300)
  await t.key('KeyN', { meta: true, key: 'n' }); await settle(300)
  await t.js(`(()=>{const i=document.getElementById('cmd'); i.value='cd /definitely/not/here'; document.getElementById('newchat').requestSubmit()})()`); await settle(700)
  t.check('a folder that does not exist is reported in the bar', (await t.text('#cmd-error')).includes('No such folder'), await t.text('#cmd-error'))
  await t.js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await settle(300)

  // ---- filter
  await t.key('KeyF', { meta: true, key: 'f' }); await settle(200)
  t.check('⌘F focuses the filter box', (await focused()) === 'filter')
  await t.js(`(()=>{const f=document.getElementById('filter'); f.value='restart'; f.dispatchEvent(new Event('input',{bubbles:true}))})()`); await settle()
  t.check('filtering dims the chats that do not match and counts the matches', (await t.text('#filter-count')) === '2 of 6' && (await cards()).filter((c) => c.includes('dim')).length === 4, await t.text('#filter-count'))
  await t.js(`document.getElementById('filter').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await settle(900)
  t.check('Enter jumps to (selects) the first match', (await cards())[0].includes('sel'))
  await t.js(`document.getElementById('filter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await settle()
  t.check('Esc clears the filter', (await t.js(`document.getElementById('filter').value`)) === '' && !(await cards()).some((c) => c.includes('dim')))

  // ---- status chips
  const dimmed = async () => (await cards()).filter((c) => c.includes('dim')).length
  const chip = (s) => t.click(`#chips .chip[data-status="${s}"]`)
  t.check('no chip is on at the start, and no card is dimmed', (await t.js(`document.querySelectorAll('#chips .chip.on').length`)) === 0 && (await dimmed()) === 0)
  await chip('working'); await settle()
  t.check('the Working chip dims everything that is not working and counts 2 of 6', (await dimmed()) === 4 && (await t.text('#filter-count')) === '2 of 6' && (await t.js(`document.querySelector('#chips .chip[data-status="working"]').getAttribute('aria-pressed')`)) === 'true', `${await dimmed()} ${await t.text('#filter-count')}`)
  await chip('waiting'); await settle()
  t.check('chips combine: Working + Waiting shows 3 of 6', (await dimmed()) === 3 && (await t.text('#filter-count')) === '3 of 6', `${await dimmed()} ${await t.text('#filter-count')}`)
  await t.js(`(()=>{const f=document.getElementById('filter'); f.value='restart'; f.dispatchEvent(new Event('input',{bubbles:true}))})()`); await settle()
  t.check('and they narrow the text filter (only chat 1 is both working and about "restart")', (await t.text('#filter-count')) === '1 of 6' && (await dimmed()) === 5, `${await dimmed()} ${await t.text('#filter-count')}`)
  await t.js(`document.getElementById('filter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await chip('working'); await chip('waiting'); await settle()
  t.check('turning the chips off brings every card back', (await dimmed()) === 0 && (await t.text('#filter-count')) === '')

  // ---- hide ended, fold a folder
  await t.click('#hide-ended'); await settle()
  t.check('"Hide ended" hides the gray card', (await cards())[3].includes('gone') && (await cards()).filter((c) => c.includes('gone')).length === 1)
  await t.click('#hide-ended'); await settle()
  await t.js(`(()=>{const h=[...document.querySelectorAll('.hub')].find(h=>h.textContent.includes('ULTRON')); h.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:1,clientY:1})); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`); await settle(900)
  t.check('clicking a folder folds its chats away and shows how many are hidden', (await cards()).filter((c) => c.includes('gone')).length === 4 && (await t.text('.hub', 0)).includes('+4'), await t.text('.hub', 0))
  await t.sleep(600)
  t.check('folded folders are saved', (t.readJson('board-layout.json') || {}).collapsed?.['/fx/ULTRON'] === true)
  await t.js(`(()=>{const h=[...document.querySelectorAll('.hub')].find(h=>h.textContent.includes('ULTRON')); h.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:1,clientY:1})); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})()`); await settle(900)

  // ---- rename
  const h0 = await t.js(`document.querySelectorAll('.card')[1].getBoundingClientRect().height`)
  await t.js(`document.querySelectorAll('.card')[1].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`); await settle(500)
  t.check('right-click starts renaming with the cursor in the name box', await t.js(`document.activeElement === document.querySelectorAll('.card')[1].querySelector('.name-input')`))
  await t.js(`(()=>{const i=document.querySelectorAll('.card')[1].querySelector('.name-input'); i.value='  Payments refactor  '; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`); await settle(700)
  t.check('Enter saves the trimmed name as the card\'s first line', (await t.text('.card .name', 1)) === 'Payments refactor')
  t.check('and the card makes room for it', Math.abs((await t.js(`document.querySelectorAll('.card')[1].getBoundingClientRect().height`)) - h0) > 5)
  await t.sleep(500)
  t.check('names are saved', (t.readJson('board-layout.json') || {}).titles?.s2 === 'Payments refactor')

  // ---- arrange: pile every card onto the first, then arrange -> no overlaps
  const overlaps = () => t.js(`(()=>{const rs=[...document.querySelectorAll('.card')].map(c=>c.getBoundingClientRect()); const hs=[...document.querySelectorAll('.hub')].map(h=>h.getBoundingClientRect()); let n=0; for(let i=0;i<rs.length;i++){for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j]; if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)n++} for(const b of hs){const a=rs[i]; if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)n++}} return n})()`)
  await t.js(`(async()=>{const cs=[...document.querySelectorAll('.card')]; const f=cs[0].getBoundingClientRect(); for(const c of cs.slice(1)){const r=c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2})); window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:f.x+f.width/2+5,clientY:f.y+f.height/2+5})); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); await new Promise(r=>setTimeout(r,60))}})()`); await settle(900)
  const piled = await overlaps()
  await t.key('KeyA', { meta: true, shift: true, key: 'A' }); await settle(1600)
  t.check('auto-arrange untangles a pile of cards (⌘⇧A)', piled > 5 && (await overlaps()) === 0, `${piled} overlaps before, ${await overlaps()} after`)

  // ---- keyboard navigation
  await t.js(`document.activeElement && document.activeElement.blur()`)
  const sel = async () => (await cards()).findIndex((c) => c.includes('sel'))
  await t.key('ArrowDown', { key: 'ArrowDown' }); await settle(500)
  t.check('the first arrow key selects a chat that is waiting for you', (await sel()) === 1, await sel())
  await t.key('Tab', { key: 'Tab' }); await settle(300)
  t.check('Tab moves to the next chat', (await sel()) === 2, await sel())
  await t.key('Tab', { key: 'Tab', shift: true }); await settle(300)
  t.check('Shift+Tab goes back', (await sel()) === 1)
  await t.js(`(()=>{const f=document.getElementById('filter'); f.focus(); f.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))})()`); await settle(300)
  t.check('arrow keys are ignored while typing in a box', (await sel()) === 1)
  await t.js(`document.activeElement.blur()`)
  await t.key('Meta', { key: 'Meta', meta: true }); await settle(250)
  t.check('holding ⌘ shows the jump numbers on the cards', (await t.js(`[...document.querySelectorAll('.card .idx')].filter(e=>getComputedStyle(e).display==='block').map(e=>e.textContent).join(' ')`)) === '⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6')
  await t.js(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'Meta',bubbles:true}))`); await settle(200)
  await t.key('Escape', { key: 'Escape' }); await settle(300)
  t.check('Esc clears the selection', (await sel()) === -1)
  await t.key('Digit3', { meta: true, key: '3' }); await settle(900)
  t.check('⌘3 opens the third chat', await t.js(`!document.getElementById('chat').hidden`))
  await t.back()

  // ---- the view (pan / zoom) is remembered
  await t.js(`document.getElementById('board').dispatchEvent(new WheelEvent('wheel',{deltaX:-120,deltaY:-80,bubbles:true,cancelable:true}))`); await settle(1000)
  const view = (t.readJson('board-layout.json') || {}).view
  t.check('panning is saved as the board\'s view', !!view && Number.isFinite(view.x) && Number.isFinite(view.k), JSON.stringify(view))

  // ---- limit: every live chat red, with a countdown instead of tokens/s
  await load('limit')
  t.check('a usage limit turns every live chat red and shows the countdown', (await cards()).filter((c) => c.includes('s-limit')).length === 5 && /^↻ 2h 1[34]m$/.test((await t.text('.card .tps', 0)).trim()), await t.text('.card .tps', 0))
  await load()

  // ---- settings: theme, colour picker, reset, persistence
  await t.key('Comma', { meta: true, key: ',' }); await settle(500)
  t.check('⌘, opens the Customize panel', await t.js(`document.getElementById('settings').classList.contains('open')`))
  // ---- per-chat mute of the "finished" notification
  const bell = (i) => t.js(`(()=>{const b=document.querySelectorAll('.card')[${i}].querySelector('.mute'); return [b.textContent, getComputedStyle(b).display]})()`)
  t.check('an unmuted card shows no bell until hovered', JSON.stringify(await bell(0)) === '["🔔","none"]', JSON.stringify(await bell(0)))
  await t.js(`document.querySelectorAll('.card')[0].querySelector('.mute').click()`); await settle(500)
  t.check('clicking the bell mutes the chat, and a muted card keeps showing 🔕', JSON.stringify(await bell(0)) === '["🔕","block"]', JSON.stringify(await bell(0)))
  t.check('the mute is saved in the layout', (t.readJson('board-layout.json') || {}).muted?.s1 === true)
  await t.js(`document.querySelectorAll('.card')[0].querySelector('.mute').click()`); await settle(500)
  t.check('clicking again unmutes and removes it from the layout', JSON.stringify(await bell(0)) === '["🔔","none"]' && !(t.readJson('board-layout.json') || {}).muted?.s1)

  // ---- notification settings: finished notifications and the sound are off by default; quiet hours is a window
  await t.key('Comma', { meta: true, key: ',' }); await settle(400)
  const sw = (label) => t.js(`(()=>{const r=[...document.querySelectorAll('#settings .row')].find(r=>r.textContent.startsWith(${JSON.stringify(label)})); return r.querySelector('input').checked})()`)
  t.check('"also notify when a chat finishes", the sound and quiet hours all start off', !(await sw('Also notify')) && !(await sw('Sound with')) && !(await sw('Quiet hours')))
  await t.js(`[...document.querySelectorAll('#settings .row')].find(r=>r.textContent.startsWith('Also notify')).querySelector('input').click()`); await settle(500)
  t.check('turning finished notifications on is saved', (t.readJson('settings.json') || {}).finishNotify === true)
  await t.js(`document.querySelector('#settings .reset').click()`); await settle(500)
  t.check('Reset to defaults turns it off again', (t.readJson('settings.json') || {}).finishNotify === false)
  await t.key('Comma', { meta: true, key: ',' }); await settle(400)

  await t.js(`[...document.querySelectorAll('#settings .segmented button')].find(b=>b.textContent==='Light').click()`); await settle(300)
  t.check('choosing the Light theme applies it', (await t.js(`document.documentElement.dataset.theme`)) === 'light')
  await t.js(`[...document.querySelectorAll('#settings .row')].find(r=>r.textContent.startsWith('Working')).querySelector('.swatch').click()`); await settle(400)
  t.check('a status colour opens the in-app colour picker (not the macOS one)', await t.js(`document.querySelector('.cp').classList.contains('open')`))
  await t.js(`(()=>{const h=document.querySelector('.cp-hex'); h.value='#ff00aa'; h.dispatchEvent(new Event('input',{bubbles:true}))})()`); await settle(300)
  t.check('typing a hex colour changes the status colour live', (await t.js(`getComputedStyle(document.documentElement).getPropertyValue('--c-working').trim()`)) === '#ff00aa')
  await t.js(`document.querySelector('#board').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); await settle(400)
  await t.sleep(500)
  const saved = t.readJson('settings.json') || {}
  t.check('settings are saved', saved.theme === 'light' && saved.colors?.working === '#ff00aa', JSON.stringify(saved).slice(0, 120))
  await t.key('Comma', { meta: true, key: ',' }); await settle(400)
  await t.js(`document.querySelector('#settings .reset').click()`); await settle(500)
  t.check('"Reset to defaults" restores the dark theme and the default colours', (await t.js(`document.documentElement.dataset.theme`)) === 'dark' && (await t.js(`getComputedStyle(document.documentElement).getPropertyValue('--c-working').trim()`)) === '#3fb950')
}
