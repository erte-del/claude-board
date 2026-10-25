import test from 'node:test'
import assert from 'node:assert/strict'
import { winPrefs } from './winprefs.mts'

test('window settings default to off and fully opaque, and are clamped', () => {
  assert.deepEqual(winPrefs(null), { launchAtLogin: false, alwaysOnTop: false, opacity: 1, hotkey: false })
  assert.deepEqual(winPrefs({ launchAtLogin: true, alwaysOnTop: true, opacity: 80, hotkey: true }), { launchAtLogin: true, alwaysOnTop: true, opacity: 0.8, hotkey: true })
  assert.equal(winPrefs({ opacity: 5 }).opacity, 0.5) // never so faint the window is lost
  assert.equal(winPrefs({ opacity: 500 }).opacity, 1)
  assert.equal(winPrefs({ opacity: 'x' }).opacity, 1)
  assert.equal(winPrefs({ hotkey: 'yes' }).hotkey, false) // only a real true turns a global shortcut on
})
