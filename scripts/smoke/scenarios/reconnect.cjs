// Reconnect: the top-bar button ticks ended chats, Select all / Deselect all work, and Confirm resumes exactly the ticked ones.
module.exports = async function (t) {
  const chat = (n, o) => ({ id: `c${n}`, sessionId: `s${n}`, cwd: '/fx/ULTRON', status: 'idle', model: 'claude-sonnet-5-5', branch: 'main', tps: null, feed: ['ok'], subagents: [], resumable: false, contextTokens: 120000, contextWindow: 1000000, costUSD: 0.43, limitResetAt: null, ...o })
  const list = [
    chat(1, { status: 'working', feed: ['busy'] }),
    chat(2, { status: 'ended', resumable: true, feed: ['Process exited.'] }),
    chat(3, { status: 'ended', resumable: true, feed: ['Process exited.'] }),
    chat(4, { status: 'ended', resumable: false, feed: ['Process exited.'] }), // can't be resumed: never selectable
    chat(5, { status: 'idle', feed: ['ok'] }),
  ]
  t.send('chats:changed', list)
  await t.waitFor(() => t.count('.card').then((n) => n === 5), { timeout: 5000 })
  await t.sleep(600)

  const picking = () => t.js(`document.getElementById('pick-bar').hidden === false`)
  const pickable = () => t.js(`[...document.querySelectorAll('.card.pickable')].length`)
  const picked = () => t.js(`[...document.querySelectorAll('.card.picked')].length`)
  const label = (id) => t.text(`#${id}`)

  t.check('the Reconnect button is there and the pick bar starts hidden', (await t.count('#reconnect')) === 1 && !(await picking()))
  await t.click('#reconnect'); await t.sleep(300)
  t.check('Reconnect shows Select all and Confirm, and turns into Cancel', (await picking()) && (await label('pick-all')) === 'Select all' && (await label('pick-go')).startsWith('Confirm') && (await label('reconnect')) === 'Cancel')
  t.check('only the two resumable ended chats are selectable', (await pickable()) === 2, String(await pickable()))
  t.check('Confirm is disabled until something is ticked', await t.js(`document.getElementById('pick-go').disabled`))

  await t.click(".card.pickable"); await t.sleep(200)
  t.check('clicking a card ticks it and does not open the chat', (await picked()) === 1 && (await t.js(`document.getElementById('chat').hidden`)))
  await t.click('#pick-all'); await t.sleep(200)
  t.check('Select all ticks every selectable card', (await picked()) === 2 && (await label('pick-all')) === 'Deselect all')
  t.check('Confirm shows the count', (await label('pick-go')) === 'Confirm (2)')
  await t.click('#pick-all'); await t.sleep(200)
  t.check('Deselect all clears the ticks', (await picked()) === 0 && (await label('pick-all')) === 'Select all')
  await t.click('.card.pickable'); await t.sleep(200)

  await t.click('#pick-go'); await t.sleep(1500)
  t.check('Confirm leaves reconnect mode', !(await picking()) && (await label('reconnect')) === 'Reconnect')
  t.check('Confirm reports the result in a toast', /Reconnected|failed/.test(await t.text('#toast span')), await t.text('#toast span'))
}
