// The first-launch tour: shown once on a fresh data folder, dismissible at any step, reopenable from Customize.
module.exports = async function (t) {
  const open = () => t.js(`!!document.getElementById('tour')`)
  const title = () => t.js(`document.querySelector('#tour h2')?.textContent ?? null`)
  const seen = () => (t.readJson('tour.json') || {}).seen === true
  const click = (label) => t.js(`[...document.querySelectorAll('#tour button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)

  t.check('on a fresh install the tour opens by itself', !!(await t.waitFor(open, { timeout: 5000 })))
  t.check('and starts at step 1', /one board/.test(await title()), await title())
  await click('Next'); await t.sleep(200)
  t.check('Next moves on', /Start or add/.test(await title()), await title())
  await click('Back'); await t.sleep(200)
  t.check('Back returns', /one board/.test(await title()))
  await t.key('ArrowRight', { key: 'ArrowRight' }); await t.sleep(200)
  t.check('→ also moves on', /Start or add/.test(await title()))
  await t.key('Escape', { key: 'Escape' }); await t.sleep(400)
  t.check('Esc dismisses it', !(await open()))
  t.check('and it is remembered as seen', !!(await t.waitFor(seen, { timeout: 3000 })))

  // a second launch would not show it again: the answer comes from tour.json
  t.check('the app says it has been seen', (await t.js('api.tourSeen()')) === true)

  // reopen from Customize and walk through to the end
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(400)
  await t.js(`[...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Show the tour').click()`); await t.sleep(400)
  t.check('"Show the tour" in Customize reopens it (and closes the drawer)', (await open()) && !(await t.js(`document.getElementById('settings').classList.contains('open')`)))
  for (let i = 0; i < 3; i++) { await click('Next'); await t.sleep(150) }
  t.check('the last step says Done', /Make it yours/.test(await title()) && !!(await t.js(`[...document.querySelectorAll('#tour button')].some(b=>b.textContent==='Done')`)))
  await click('Done'); await t.sleep(300)
  t.check('Done closes it', !(await open()))
  // Skip works from the first step
  await t.key('Comma', { meta: true, key: ',' }); await t.sleep(400)
  await t.js(`[...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Show the tour').click()`); await t.sleep(300)
  await click('Skip'); await t.sleep(300)
  t.check('Skip closes it from step 1', !(await open()))
}
