// Launch 2 of 2: what did the first launch leave behind?
const fs = require('fs')
const path = require('path')

module.exports = async function (t) {
  const p1 = JSON.parse(fs.readFileSync(path.join(t.data, 'phase1.json'), 'utf8'))
  const cards = () => t.chats()
  const bySession = async (s) => (await cards()).find((c) => c.sessionId === s)

  // ---- what comes back
  const list = await cards()
  t.check('the chats that had a conversation come back as gray cards; the unused one does not', list.length === 2 && list.every((c) => c.status === 'ended' && c.resumable), JSON.stringify(list.map((c) => [c.sessionId.slice(0, 8), c.status])))
  t.check('a restored card shows where the chat left off', (await bySession(p1.sessionA)).feed.some((f) => f.includes('echo: persist-me')))
  t.check('the name you gave it is still there', (await t.js(`[...document.querySelectorAll('.card .name')].map(e=>e.textContent)`)).includes('Keep me'))
  t.check('the theme is remembered', (await t.js(`document.documentElement.dataset.theme`)) === 'midnight')
  const b = t.win.getBounds()
  t.check('the window reopens where and how big it was', Math.abs(b.x - p1.bounds.x) <= 2 && Math.abs(b.y - p1.bounds.y) <= 2 && Math.abs(b.width - p1.bounds.width) <= 2 && Math.abs(b.height - p1.bounds.height) <= 2, JSON.stringify([b, p1.bounds]))
  const world = await t.js(`document.querySelector('.world').style.transform`)
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world)
  t.check('the board comes back panned and zoomed as it was left', !!m && Math.abs(+m[1] - p1.view.x) < 1 && Math.abs(+m[2] - p1.view.y) < 1 && Math.abs(+m[3] - p1.view.k) < 0.01, `${world} vs ${JSON.stringify(p1.view)}`)
  t.check('the usage limit from last time is not believed (nothing is red)', !(await cards()).some((c) => c.status === 'limit'))

  // ---- resuming: the same session, with its history, appended to the same transcript
  const idx = (await cards()).findIndex((c) => c.sessionId === p1.sessionA)
  await t.click('.card', { index: idx }); await t.sleep(300)
  const live = await t.waitFor(async () => { const c = await bySession(p1.sessionA); return c && c.status !== 'ended' ? c : null }, { timeout: 10000 })
  t.check('clicking a gray card resumes that same session', !!live)
  t.check('the resumed chat opens in the chat view', !!(await t.waitFor(() => t.js(`!document.getElementById('chat').hidden && document.querySelectorAll('.pane').length === 1`), { timeout: 5000 })))
  await t.sleep(1500)
  await t.key('KeyF', { meta: true, key: 'f' }); await t.sleep(250)
  await t.js(`(()=>{const i=document.getElementById('find-input'); i.value='resumed'; i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await t.sleep(450)
  t.check('the process was started as a resume', /^\d+\/\d+$/.test(await t.text('#find-count')), await t.text('#find-count'))
  await t.js(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  t.check('the old limit does not make the resumed chat red', (await bySession(p1.sessionA)).status !== 'limit')
  await t.say(live.id, 'again')
  await t.waitFor(async () => (await bySession(p1.sessionA)).feed.some((f) => f.includes('echo: again')))
  const file = (() => { for (const d of fs.readdirSync(path.join(t.home, '.claude', 'projects'))) { const f = path.join(t.home, '.claude', 'projects', d, `${p1.sessionA}.jsonl`); if (fs.existsSync(f)) return f } })()
  const text = file ? fs.readFileSync(file, 'utf8') : ''
  t.check('new messages are appended to the same transcript, after the old ones', text.indexOf('persist-me') >= 0 && text.indexOf('persist-me') < text.indexOf('"content":"again"'))
  await t.back()

  // ---- a chat added from history resumes too
  const h = await bySession('hist-1')
  await t.click('.card', { index: (await cards()).findIndex((c) => c.sessionId === 'hist-1') }); await t.sleep(300)
  t.check('an added history chat can be resumed', !!(await t.waitFor(async () => (await bySession('hist-1')).status !== 'ended', { timeout: 10000 })))
  await t.back()

  // ---- removing a card forgets it for good
  const regBefore = JSON.parse(fs.readFileSync(path.join(t.data, 'chats.json'), 'utf8')).map((r) => r.sessionId)
  const toRemove = await bySession('hist-1')
  await t.js(`api.killChat(${JSON.stringify(toRemove.id)})`); await t.sleep(1500)
  await t.js(`api.killChat(${JSON.stringify(toRemove.id)})`); await t.sleep(800) // second time: it has ended, so this removes the card
  const regAfter = JSON.parse(fs.readFileSync(path.join(t.data, 'chats.json'), 'utf8')).map((r) => r.sessionId)
  t.check('removing a card takes the chat out of the saved list', regBefore.includes('hist-1') && !regAfter.includes('hist-1') && regAfter.includes(p1.sessionA), JSON.stringify([regBefore, regAfter]))
  t.check('and out of the board', !(await bySession('hist-1')))
}
