import test from 'node:test'
import assert from 'node:assert/strict'
import { permissionMode, waitingForUser } from './screen.mts'

test('recognises question, permission and trust dialogs', () => {
  assert.ok(waitingForUser(['Do you prefer red or blue?', '❯ 1. Red', '  2. Blue', 'Enter to select · ↑/↓ to navigate · Esc to cancel']))
  assert.ok(waitingForUser(['Do you want to proceed?', '❯ 1. Yes', '  2. No']))
  assert.ok(waitingForUser(['Enter to confirm · Esc to cancel']))
})

test('ordinary prompt and working screens are not waiting', () => {
  assert.ok(!waitingForUser(['> ', '? for shortcuts']))
  assert.ok(!waitingForUser(['✻ Thinking… (esc to interrupt)']))
})

test('modelFromScreen reads the banner model, in either spelling', async () => {
  const { modelFromScreen } = await import('./screen.mts')
  assert.equal(modelFromScreen(['Claude Code v2', 'Sonnet 5.5 · Claude Max', '~/proj']), 'claude-sonnet-5-5')
  assert.equal(modelFromScreen(['model: claude-opus-5-5']), 'claude-opus-5-5')
  assert.equal(modelFromScreen(['Fable 5.1']), 'claude-fable-5-1')
  assert.equal(modelFromScreen(['Welcome', '❯ ']), null)
})

test('permissionPrompt finds the answer keys of a real permission dialog', async () => {
  const { permissionPrompt } = await import('./screen.mts')
  const real = [' Bash command', ' touch x', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and don’t ask again for: touch *', '   3. Yes, and switch to auto mode']
  assert.deepEqual(permissionPrompt(real), { question: 'Do you want to proceed?', yes: '1', no: '\x1b' })
  const withNo = ['│ Do you want to make this edit to a.ts? │', '│ ❯ 1. Yes │', '│   2. Yes, allow all edits during this session │', '│   3. No, and tell Claude what to do differently (esc) │']
  assert.deepEqual(permissionPrompt(withNo), { question: 'Do you want to make this edit to a.ts?', yes: '1', no: '3' })
})

test('permissionPrompt refuses anything it cannot be sure of', async () => {
  const { permissionPrompt } = await import('./screen.mts')
  assert.equal(permissionPrompt([' Quick safety check', ' ❯ No, exit', '   Yes, I trust this folder', ' Enter to confirm · Esc to cancel']), null) // trust dialog
  assert.equal(permissionPrompt(['Do you prefer red or blue?', '❯ 1. Red', '  2. Blue']), null) // a question
  assert.equal(permissionPrompt(['Do you want to proceed?', '❯ 1. Sure', '  2. Not now']), null) // no plain "Yes"
  assert.equal(permissionPrompt(['Do you want to proceed?', '❯ 1. Yes', '  3. No']), null) // gap in the numbering
  assert.equal(permissionPrompt(['Do you want to proceed?', '❯ 1. Yes']), null) // only one option: not a dialog
  assert.equal(permissionPrompt(['Do you want to proceed?', '❯ 1. Yes', '  2. No', '', 'Do you want to proceed?']), null) // newest question has no options yet
})

test('permissionMode reads the mode off the status line (strings from a real claude: auto, manual)', () => {
  assert.equal(permissionMode(['❯ ', '⏵⏵ auto mode on (shift+tab to cycle)']), 'auto')
  assert.equal(permissionMode(['❯ ', '⏸ manual mode on']), 'manual')
  assert.equal(permissionMode(['⏵⏵ accept edits on (shift+tab to cycle)']), 'accept-edits')
  assert.equal(permissionMode(['⏸ plan mode on (shift+tab to cycle)']), 'plan')
  assert.equal(permissionMode(['⏵⏵ bypass permissions on (shift+tab to cycle)']), 'bypass')
  assert.equal(permissionMode(['⏸ manual mode on', '⏵⏵ auto mode on']), 'auto') // the lowest row wins
  assert.equal(permissionMode(['Do you want to proceed?', '❯ 1. Yes']), null) // a dialog hides the line
  assert.equal(permissionMode(['we should turn auto mode on later']), null)
})
