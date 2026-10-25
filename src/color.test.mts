import test from 'node:test'
import assert from 'node:assert/strict'
import { hexToRgb, hsvToHex, rgbToHex, rgbToHsv } from './color.mts'

test('hex parsing: 3 and 6 digits, optional #, rejects junk', () => {
  assert.deepEqual(hexToRgb('#3fb950'), [63, 185, 80])
  assert.deepEqual(hexToRgb('f80'), [255, 136, 0])
  assert.deepEqual(hexToRgb('  #FFF '), [255, 255, 255])
  for (const bad of ['', '#12', '#12345', 'ggg', '#1234567']) assert.equal(hexToRgb(bad), null)
})

test('hex -> hsv -> hex round-trips the colours the app uses', () => {
  for (const hex of ['#3fb950', '#000000', '#f0883e', '#f85149', '#666666', '#ffffff', '#22d3ee', '#4c9aff']) {
    assert.equal(rgbToHex(...hexToRgb(hex)!), hex)
    assert.equal(hsvToHex(rgbToHsv(...hexToRgb(hex)!)), hex)
  }
})

test('known hues', () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), '#ff0000')
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00')
  assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), '#0000ff')
  assert.equal(hsvToHex({ h: 200, s: 0, v: 0 }), '#000000') // hue is irrelevant at zero value
})
