// Electron entry for one smoke scenario: starts the real app (dist/main.js) in an isolated HOME / data folder, then hands the
// scenario a small toolkit `t` to drive and inspect it. Results go to stdout as `@@ok name` / `@@fail name :: detail` lines.
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const scenarioName = process.env.SMOKE_SCENARIO
app.setPath('userData', process.env.SMOKE_DATA)
let quitAnswer = 0 // what the "chats are still running, quit?" dialog says: 0 = Quit, 1 = Cancel
dialog.showMessageBoxSync = () => quitAnswer

const spy = { writes: [], cols: {} } // what the renderer sent to ptys, and each pty's reported width
ipcMain.on('pty:write', (_e, id, data) => spy.writes.push({ id, data }))
ipcMain.on('pty:resize', (_e, id, cols) => { spy.cols[id] = cols })

const out = (line) => process.stdout.write(line + '\n')
let passed = 0, failed = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

require('../../dist/main.js')

const t = {
  home: process.env.HOME,
  data: process.env.SMOKE_DATA,
  spy,
  sleep,
  get win() { return BrowserWindow.getAllWindows()[0] },
  get wc() { return BrowserWindow.getAllWindows()[0].webContents },
  setQuitAnswer: (n) => { quitAnswer = n },
  leaveChatsRunning: false, // a scenario that tests quitting with live chats sets this, so shutdown doesn't kill them first
  badge: () => app.dock.getBadge(),

  check(name, ok, detail = '') {
    if (ok) { passed++; out(`@@ok ${name}`) } else { failed++; out(`@@fail ${name}${detail ? ' :: ' + String(detail).replace(/\n/g, ' ⏎ ').slice(0, 300) : ''}`) }
    return ok
  },
  /** Evaluate in the renderer. */
  js: (code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code),
  /** Poll until `fn` returns something truthy (or time runs out: returns that last falsy value). */
  async waitFor(fn, { timeout = 15000, every = 200 } = {}) {
    const end = Date.now() + timeout
    let v
    while (Date.now() < end) { try { v = await fn() } catch { v = null } if (v) return v; await sleep(every) }
    return v
  },
  send: (channel, ...args) => BrowserWindow.getAllWindows()[0].webContents.send(channel, ...args),
  chats: () => t.js('api.listChats()'),
  async newChat(cwd) { const r = await t.js(`api.newChat(${JSON.stringify(cwd)})`); if (!r.ok) throw new Error('newChat failed: ' + r.error); return r.id },
  async say(id, text) {
    await t.js(`api.ptyWrite(${JSON.stringify(id)}, ${JSON.stringify(text)})`)
    await sleep(250)
    await t.js(`api.ptyWrite(${JSON.stringify(id)}, '\\r')`)
  },
  key: (code, props = {}) => t.js(`(()=>{const e=new KeyboardEvent('keydown',{code:${JSON.stringify(code)},key:${JSON.stringify(props.key ?? code)},bubbles:true,cancelable:true,metaKey:${!!props.meta},shiftKey:${!!props.shift}}); window.dispatchEvent(e); return e.defaultPrevented})()`),
  /** A real-looking click: pointerdown, pointerup, click. `shift` for shift-click. */
  click: (selector, { index = 0, shift = false } = {}) => t.js(`(()=>{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if(!e) return false; const o={button:0,bubbles:true,clientX:1,clientY:1,shiftKey:${shift}}; e.dispatchEvent(new PointerEvent('pointerdown',o)); window.dispatchEvent(new PointerEvent('pointerup',o)); e.click(); return true})()`),
  count: (selector) => t.js(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
  text: (selector, index = 0) => t.js(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.textContent ?? null`),
  /** Open the card at `index` the way a user would. */
  async openCard(index = 0) { await t.click('.card', { index }); await t.waitFor(() => t.js(`!document.getElementById('chat').hidden`)) },
  async back() { await t.js(`document.getElementById('back').click()`); await sleep(400) },
  /**
   * End the run. A scenario that is not about quitting kills its chats and exits hard: Electron's own graceful shutdown sometimes
   * lingers on macOS waiting for its helper processes (nothing to do with this app), and that must not stall the suite. A scenario
   * that sets `leaveChatsRunning` is testing the real quit path (chats still running), so it quits the way a user does.
   */
  async shutdown() {
    const within = (p, ms) => Promise.race([p, sleep(ms)])
    setTimeout(() => app.exit(failed ? 1 : 0), 15000) // last resort
    if (t.leaveChatsRunning) {
      quitAnswer = 0
      app.quit()
      return
    }
    try { await within(t.js(`(async()=>{for(const c of await api.listChats()) await api.killChat(c.id)})()`), 3000) } catch { /* window may be gone */ }
    await sleep(1200) // let the killed chats exit
    app.exit(failed ? 1 : 0)
  },
  fixtures: { projA: path.join(process.env.HOME, 'proj-a'), projB: path.join(process.env.HOME, 'proj-b') },
  readJson: (name) => { try { return JSON.parse(fs.readFileSync(path.join(process.env.SMOKE_DATA, name), 'utf8')) } catch { return null } },
}

app.whenReady().then(async () => {
  try {
    await t.waitFor(() => BrowserWindow.getAllWindows()[0], { timeout: 15000 })
    await new Promise((r) => (t.wc.isLoading() ? t.wc.once('did-finish-load', r) : r()))
    await sleep(2000) // fonts, settings, saved chats
    app.focus({ steal: true }) // a focused window also keeps real macOS notifications from popping up during the run
    await require(path.join(__dirname, 'scenarios', scenarioName + '.cjs'))(t)
  } catch (e) {
    t.check(`${scenarioName}: ran to completion`, false, e && e.stack ? e.stack : e)
  }
  out(`@@done ${passed} ${failed}`)
  await t.shutdown()
})
