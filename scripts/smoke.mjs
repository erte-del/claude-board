#!/usr/bin/env node
// UI smoke tests: drives the real built app (dist/) end to end, offline and free. A stand-in `claude` replaces the real one, and
// everything runs in a throwaway HOME, so nothing touches your own ~/.claude, settings or chats.
//   npm run smoke            all scenarios      npm run smoke -- --fast     skip the slow ones
//   npm run smoke -- chat    only matching names   npm run smoke -- --keep   keep the temp folder
import { spawn, execFileSync } from 'node:child_process'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const smoke = path.join(root, 'scripts/smoke')
const args = process.argv.slice(2)
const fast = args.includes('--fast'), keep = args.includes('--keep')
const only = args.filter((a) => !a.startsWith('--'))

// name, slow?, and whether it continues from the previous scenario's state (a restart)
const SCENARIOS = [
  { name: 'board' },
  { name: 'chat' },
  { name: 'split' },
  { name: 'tour' },
  { name: 'persist-1', strictQuit: true }, // this one tests the real quit path: the app must exit by itself
  { name: 'persist-2' },
  { name: "reconnect" },
  { name: "limit", slow: true },
]

// Two runs at once (another terminal, another chat) steal each other's window focus and see each other's stand-in claude processes,
// which fails checks at random. One lock file (holding the owner's pid) makes the second run wait its turn.
const lock = path.join(os.tmpdir(), 'claude-board-smoke.lock')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
for (let waited = false; ; waited = true) {
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {
    let owner = 0
    try { owner = Number(readFileSync(lock, 'utf8')) } catch { /* released just now */ }
    if (owner && !alive(owner)) { rmSync(lock, { force: true }); continue }
    if (!waited) console.log(`another smoke run (pid ${owner}) is using the app: waiting for it to finish…`)
    await new Promise((r) => setTimeout(r, 2000))
  }
}
const unlock = () => { try { if (Number(readFileSync(lock, 'utf8')) === process.pid) rmSync(lock, { force: true }) } catch { /* already gone */ } }
process.on('exit', unlock)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cb-smoke-'))
// every scenario gets its own HOME and data folder; "persist-1" and "persist-2" share one (the second is a restart of the first)
const dirsFor = (name) => {
  const group = name.replace(/-\d+$/, '')
  const home = path.join(tmp, `home-${group}`), data = path.join(tmp, `data-${group}`)
  for (const d of [home, data, path.join(home, 'proj-a'), path.join(home, 'proj-b'), path.join(home, '.claude', 'projects')]) mkdirSync(d, { recursive: true })
  return { home, data }
}

const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`
let passed = 0, failed = 0
const failures = []

let lingered = 0 // apps that finished their scenario but did not exit by themselves (killed after a grace period)
function runScenario(name, strictQuit = false, timeoutMs = 150_000) {
  return new Promise((resolve) => {
    console.log(`\n${name}`)
    const { home, data } = dirsFor(name)
    // The app writes to a log file that is followed here, not to pipes: helper processes inherit pipes, and an app whose stdout is a
    // pipe sometimes lingers after quitting on macOS, waiting on its helpers.
    const logFile = path.join(tmp, `${name}.log`)
    const logFd = openSync(logFile, 'w')
    const child = spawn(electron, [path.join(smoke, 'harness.cjs')], {
      env: { ...process.env, HOME: home, SMOKE_DATA: data, SMOKE_SCENARIO: name, SMOKE_BIN: path.join(smoke, 'bin'), CB_OPEN: path.join(smoke, 'bin', 'fake-open'), SHELL: path.join(smoke, 'fake-shell.sh') },
      stdio: ['ignore', logFd, logFd],
      detached: true, // its own process group, so a lingering app and its helpers can be killed together
    })
    let exited = false
    closeSync(logFd)
    const tail = []
    let buf = '', done = false, last = '(nothing yet)'
    const onLine = (line) => {
      if (line.startsWith('@@ok ')) { passed++; last = line.slice(5); console.log(`  ${green('✔')} ${line.slice(5)}`) }
      else if (line.startsWith('@@fail ')) { failed++; const [n, d] = line.slice(7).split(' :: '); failures.push(`${name}: ${n}`); console.log(`  ${red('✖')} ${n}${d ? dim('  — ' + d) : ''}`) }
      else if (line.startsWith('@@done')) {
        done = true
        // Electron's own shutdown sometimes lingers on macOS, waiting for its helper processes. Give it a moment, then end the whole
        // process group. Only a scenario that tests quitting (strictQuit) fails for it.
        setTimeout(() => {
          if (exited) return
          lingered++
          if (strictQuit) { failed++; failures.push(`${name}: the app did not quit by itself`); console.log(`  ${red('✖')} the app did not quit by itself after finishing`) }
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
        }, strictQuit ? 30_000 : 10_000)
      }
      else if (line.startsWith('@@info ')) { if (process.env.SMOKE_VERBOSE) console.log('  ' + dim(line.slice(7))) }
      else if (line.trim()) { tail.push(line); if (tail.length > 12) tail.shift() }
    }
    const feed = (chunk) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1) } }
    let offset = 0
    const follow = () => { // read whatever the app has written since last time
      let size = 0
      try { size = statSync(logFile).size } catch { return }
      if (size <= offset) return
      const fd = openSync(logFile, 'r')
      const chunk = Buffer.alloc(size - offset)
      readSync(fd, chunk, 0, chunk.length, offset)
      closeSync(fd)
      offset = size
      feed(chunk.toString())
    }
    const poll = setInterval(follow, 100)
    const timer = setTimeout(() => { failed++; failures.push(`${name}: timed out`); console.log(`  ${red('✖')} timed out after ${timeoutMs / 1000}s${dim('  — the last check that passed: ' + last + (done ? ' (the scenario had finished: the app did not quit)' : ' (the scenario had not finished)'))}`)
      tail.forEach((l) => console.log(dim('    ' + l)))
      try { // what is the lingering app still holding? (children, open resources)
        const kids = execFileSync('sh', ['-c', `ps -axo pid,ppid,command | awk -v p=${child.pid} '$2==p' | cut -c1-110`]).toString().trim()
        const lsof = execFileSync('sh', ['-c', `lsof -p ${child.pid} 2>/dev/null | awk '{print $5}' | sort | uniq -c | sort -rn | head -6`]).toString().trim()
        console.log(dim(`    children:\n      ${kids.split('\n').join('\n      ') || '(none)'}\n    open resources by type:\n      ${lsof.split('\n').join('\n      ')}`))
      } catch { /* best effort */ }
      try { // where is it stuck? (macOS `sample`: the main thread's busiest frames)
        const sampleOut = execFileSync('sample', [String(child.pid), '2', '-mayDie'], { timeout: 20_000 }).toString()
        const i = sampleOut.indexOf('main-thread'), frames = sampleOut.slice(i, i + 4000).split('\n').slice(0, 14).map((l) => l.replace(/^[ +!:|]+/, '').slice(0, 130))
        console.log(dim('    main thread:\n      ' + frames.join('\n      ')))
        if (process.env.SMOKE_KEEP_SAMPLE) writeFileSync(process.env.SMOKE_KEEP_SAMPLE, sampleOut)
      } catch { /* no `sample` here */ }
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, timeoutMs)
    child.on('exit', () => {
      exited = true
      clearTimeout(timer)
      clearInterval(poll)
      follow()
      if (!done && !failures.some((f) => f.startsWith(`${name}: timed out`))) { failed++; failures.push(`${name}: app exited early`); console.log(`  ${red('✖')} the app exited before the scenario finished`); tail.forEach((l) => console.log(dim('    ' + l))) }
      resolve()
    })
  })
}


// A Dock launch: the app gets launchd's bare environment, not the one your terminal builds from ~/.zshrc. The stand-in `claude`
// is on PATH *only* through a fake HOME's .zshrc, so it is found only if the app asks the user's own shell for its environment.
async function dockStage() {
  console.log('\ndock (launched with a bare Dock-style environment)')
  const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`  ${green('✔')} ${name}`) } else { failed++; failures.push(`dock: ${name}`); console.log(`  ${red('✖')} ${name}${detail ? dim('  — ' + detail) : ''}`) } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const launch = async (withRc, port) => {
    const home = mkdtempSync(path.join(tmp, 'dockhome-'))
    mkdirSync(path.join(home, 'bin'))
    cpSync(path.join(smoke, 'bin', 'claude'), path.join(home, 'bin', 'claude'))
    chmodSync(path.join(home, 'bin', 'claude'), 0o755)
    if (withRc) writeFileSync(path.join(home, '.zshrc'), 'export PATH="$HOME/bin:$PATH"\n')
    const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, 'data')}`], {
      env: { HOME: home, USER: process.env.USER, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: process.env.TMPDIR },
      stdio: 'ignore',
    })
    let page = null
    for (let i = 0; i < 40 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === 'page') } catch {} }
    if (!page) { child.kill('SIGKILL'); return null }
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let n = 0
    const pending = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
    const ev = async (expr) => (await new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })) })).result.result.value
    const status = await ev('api.claudeStatus()')
    await sleep(300)
    const banner = await ev(`!document.getElementById('banner').hidden`)
    child.kill('SIGTERM')
    await sleep(1500)
    child.kill('SIGKILL')
    return { status, banner, home }
  }
  const withRc = await launch(true, 9610)
  if (!withRc) return check('the app starts under a bare environment', false)
  check('claude is found through the user\'s own shell (PATH only exists in ~/.zshrc)', withRc.status.ok && withRc.status.path === path.join(withRc.home, 'bin', 'claude'), JSON.stringify(withRc.status))
  check('no "claude not found" banner', withRc.banner === false)
  const without = await launch(false, 9611)
  check('without that ~/.zshrc it is not found (so the check above really depends on the shell)', !!without && (!without.status.ok || !without.status.path.startsWith(without.home)), JSON.stringify(without?.status))
  check('and the banner tells the user', !!without && (without.status.ok || without.banner === true))
}

console.log('building…')
execFileSync('npm', ['run', 'build', '--silent'], { cwd: root, stdio: 'inherit' })

const picked = SCENARIOS.filter((s) => (!fast || !s.slow) && (!only.length || only.some((o) => s.name.includes(o))))
const wantsDock = !only.length || only.some((o) => 'dock'.includes(o))
if (!picked.length && !wantsDock) { console.error(`no scenario matches: ${only.join(' ')}\nscenarios: ${SCENARIOS.map((s) => s.name).join(', ')}, dock`); process.exit(2) }
const started = Date.now()
for (const s of picked) await runScenario(s.name, !!s.strictQuit)
if (wantsDock) await dockStage()

// leftovers would mean a quit left a chat running
const countStrays = () => { try { return execFileSync('pgrep', ['-f', `${smoke}/bin/claude`]).toString().trim().split('\n').filter(Boolean).length } catch { return 0 } }
for (let i = 0; i < 10 && countStrays(); i++) await new Promise((r) => setTimeout(r, 300)) // a SIGHUPed process needs a moment to go
const strays = countStrays()
if (strays) { failed++; failures.push('cleanup: stand-in claude processes left running'); console.log(`\n  ${red('✖')} ${strays} stand-in claude process(es) left running after the app quit`); try { execFileSync('pkill', ['-f', `${smoke}/bin/claude`]) } catch {} }

console.log(`\n${failed ? red(`${failed} failed`) : green('all passed')}, ${passed} checks ok  ${dim(`(${Math.round((Date.now() - started) / 1000)}s)`)}`)
if (lingered) console.log(dim(`${lingered} app(s) lingered after finishing their scenario and were killed (Electron shutdown on macOS; not a test failure)`))
if (failures.length) failures.forEach((f) => console.log(red('  ✖ ' + f)))
if (!keep) rmSync(tmp, { recursive: true, force: true }); else console.log(dim(`kept ${tmp}`))
process.exit(failed ? 1 : 0)
