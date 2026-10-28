import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItermColors } from './itermcolors.mts'

const color = (r: number, g: number, b: number, kind = 'real') =>
  `<dict><key>Alpha Component</key><real>1</real><key>Blue Component</key><${kind}>${b}</${kind}><key>Color Space</key><string>sRGB</string><key>Green Component</key><${kind}>${g}</${kind}><key>Red Component</key><${kind}>${r}</${kind}></dict>`
const plist = (entries: Record<string, string>) => `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(entries).map(([k, v]) => `<key>${k}</key>${v}`).join('')}</dict></plist>`
const full = (): Record<string, string> => ({
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`Ansi ${i} Color`, color(i / 15, 0, 1 - i / 15)])),
  'Background Color': color(0, 0, 0, 'integer'),
  'Foreground Color': color(1, 1, 1, 'integer'),
})

test('a complete file maps to a theme: ANSI 0-7 normal, 8-15 bright, 0-1 components to hex', () => {
  const t = parseItermColors(plist(full()))!
  assert.equal(t.background, '#000000')
  assert.equal(t.foreground, '#ffffff')
  assert.equal(t.black, '#0000ff')
  assert.equal(t.brightBlack, '#880077')
  assert.equal(t.brightWhite, '#ff0000')
  assert.equal(t.cursor, '#ffffff', 'no cursor colour: falls back to the text colour')
  assert.equal(t.selectionBackground, t.brightBlack, 'no selection colour: falls back to bright black')
})

test('cursor and selection colours are used when present', () => {
  const t = parseItermColors(plist({ ...full(), 'Cursor Color': color(1, 0, 0), 'Selection Color': color(0, 1, 0) }))!
  assert.equal(t.cursor, '#ff0000')
  assert.equal(t.selectionBackground, '#00ff00')
})

test('a file missing the background, the foreground or an ANSI colour is refused', () => {
  const noBg = full(); delete noBg['Background Color']
  const noFg = full(); delete noFg['Foreground Color']
  const noAnsi = full(); delete noAnsi['Ansi 9 Color']
  for (const e of [noBg, noFg, noAnsi]) assert.equal(parseItermColors(plist(e)), null)
  assert.equal(parseItermColors('not a plist'), null)
  assert.equal(parseItermColors(''), null)
})

test('a component outside 0-1 drops that colour, which refuses the file when it is required', () => {
  assert.equal(parseItermColors(plist({ ...full(), 'Background Color': color(2, 0, 0) })), null)
})
