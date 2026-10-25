// Renders build/icon.png and build/icon.icns. Run with: npx electron scripts/make-icon.js
// Uses Electron itself to rasterise the SVG, then macOS `sips` + `iconutil` for the icon set.
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const out = path.join(__dirname, '..', 'build')
// A folder hub in the middle, four chat cards around it, linked: the board itself, in miniature.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34343a"/><stop offset="1" stop-color="#151518"/></linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)"/>
  <g stroke-width="22" stroke-linecap="round" fill="none">
    <path d="M512 512 L330 330" stroke="#3fb950"/><path d="M512 512 L694 330" stroke="#f0883e"/>
    <path d="M512 512 L330 694" stroke="#8a8a93"/><path d="M512 512 L694 694" stroke="#3fb950"/>
  </g>
  <g fill="#1b1b1e" stroke-width="22">
    <rect x="236" y="262" width="190" height="136" rx="30" stroke="#3fb950"/>
    <rect x="598" y="262" width="190" height="136" rx="30" stroke="#f0883e"/>
    <rect x="236" y="626" width="190" height="136" rx="30" stroke="#8a8a93"/>
    <rect x="598" y="626" width="190" height="136" rx="30" stroke="#3fb950"/>
  </g>
  <g fill="#ececf0" opacity=".85"><rect x="264" y="296" width="80" height="16" rx="8"/><rect x="626" y="296" width="80" height="16" rx="8"/><rect x="264" y="660" width="80" height="16" rx="8"/><rect x="626" y="660" width="80" height="16" rx="8"/></g>
  <rect x="412" y="468" width="200" height="88" rx="44" fill="#4c4c54" stroke="#6a6a73" stroke-width="6"/>
  <circle cx="754" cy="272" r="34" fill="#f0883e" stroke="#151518" stroke-width="10"/>
  <rect x="749" y="252" width="10" height="26" rx="5" fill="#1a1208"/><circle cx="754" cy="292" r="6" fill="#1a1208"/>
</svg>`

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`))
  await new Promise((r) => setTimeout(r, 400))
  fs.writeFileSync(path.join(out, 'icon-raw.png'), (await w.webContents.capturePage()).toPNG())
  const set = path.join(out, 'icon.iconset')
  fs.rmSync(set, { recursive: true, force: true })
  fs.mkdirSync(set)
  const master = path.join(out, 'icon.png')
  execFileSync('sips', ['-z', '1024', '1024', path.join(out, 'icon-raw.png'), '--out', master], { stdio: 'ignore' })
  for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]])
    execFileSync('sips', ['-z', String(px), String(px), master, '--out', path.join(set, `icon_${name}.png`)], { stdio: 'ignore' })
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')])
  fs.rmSync(set, { recursive: true, force: true })
  fs.rmSync(path.join(out, 'icon-raw.png'))
  console.log('ICON ok')
  app.exit(0)
})
