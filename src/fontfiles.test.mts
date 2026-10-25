import test from 'node:test'
import assert from 'node:assert/strict'
import { groupFontFiles } from './fontfiles.mts'

test('groups regular and bold faces into one family and skips other styles', () => {
  const g = groupFontFiles(['Hack-Regular.ttf', 'Hack-Bold.ttf', 'Hack-Italic.ttf', 'Hack-BoldItalic.ttf'])
  assert.deepEqual(g, [{ name: 'Hack', regular: 'Hack-Regular.ttf', bold: 'Hack-Bold.ttf' }])
})

test('names with spaces and "for Powerline" stay whole', () => {
  const g = groupFontFiles(['Anonymice Powerline.ttf', 'Anonymice Powerline Bold.ttf', 'Anonymice Powerline Italic.ttf', 'Anonymice Powerline Bold Italic.ttf', 'Droid Sans Mono for Powerline.otf', 'Cousine for Powerline.ttf', 'Cousine Bold for Powerline.ttf'])
  assert.deepEqual(g.map((x) => [x.name, x.regular, x.bold ?? null]), [
    ['Anonymice Powerline', 'Anonymice Powerline.ttf', 'Anonymice Powerline Bold.ttf'],
    ['Cousine for Powerline', 'Cousine for Powerline.ttf', 'Cousine Bold for Powerline.ttf'],
    ['Droid Sans Mono for Powerline', 'Droid Sans Mono for Powerline.otf', null],
  ])
})

test('odd naming: "Plain" counts as regular, underscores and mixed case work', () => {
  const g = groupFontFiles(['CPMono_v07 Plain.otf', 'CPMono_v07 Bold.otf', 'CPMono_v07 Black.otf', 'FuraMono-Regular Powerline.otf', 'FuraMono-Bold Powerline.otf'])
  assert.deepEqual(g.map((x) => [x.name, x.regular, x.bold ?? null]), [
    ['CPMono v07', 'CPMono_v07 Plain.otf', 'CPMono_v07 Bold.otf'],
    ['Fura Mono Powerline', 'FuraMono-Regular Powerline.otf', 'FuraMono-Bold Powerline.otf'],
  ])
})

test('families with no regular face, non-font files and bare style names are dropped', () => {
  assert.deepEqual(groupFontFiles(['Thing-Bold.ttf', 'readme.txt', 'Bold.ttf', '.DS_Store', 'Solo.ttf']), [{ name: 'Solo', regular: 'Solo.ttf' }])
})
