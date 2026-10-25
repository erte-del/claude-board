// Claude Code's blocking dialogs (permission, questions, trust) all carry one of these footers/options.
// The transcript can't show them (the tool call is only written once answered), so look at the live screen.
const DIALOG = /Esc to cancel|Enter to (select|confirm)|Do you want to |❯\s*1\.\s/i

/** screenLines: the bottom of the terminal viewport, one string per row. */
export const waitingForUser = (screenLines: string[]) => DIALOG.test(screenLines.join('\n'))

/** modelFromScreen: the model named on the start-up banner ("Sonnet 5.5 · Claude Max"), as an id like claude-sonnet-5-5. Null if none. */
export const modelFromScreen = (screenLines: string[]): string | null => {
  const m = /\b(opus|sonnet|haiku|fable)[ -](\d+(?:[.-]\d+)?)\b/i.exec(screenLines.join('\n'))
  return m ? `claude-${m[1].toLowerCase()}-${m[2].replace('.', '-')}` : null
}

export type PermMode = 'manual' | 'auto' | 'accept-edits' | 'plan' | 'bypass'
// Only "auto mode on" and "manual mode on" are verified against a real claude; the other three are from memory of its status line.
const MODES: [RegExp, PermMode][] = [[/[⏵⏸]\s*auto mode on\b/i, 'auto'], [/[⏵⏸]\s*manual mode on\b/i, 'manual'], [/[⏵⏸]\s*accept edits on\b/i, 'accept-edits'], [/[⏵⏸]\s*plan mode on\b/i, 'plan'], [/[⏵⏸]\s*bypass permissions on\b/i, 'bypass']]

/** permissionMode: the mode named on Claude Code's status line ("⏵⏵ auto mode on (shift+tab to cycle)"), from the last row that names one. Null if none shows. */
export const permissionMode = (screenLines: string[]): PermMode | null => {
  for (const l of [...screenLines].reverse()) for (const [re, m] of MODES) if (re.test(l)) return m
  return null
}

export type Permission = { question: string; yes: string; no: string }

const OPTION = /^[❯>]?\s*(\d+)\.\s+(.+)$/

/**
 * permissionPrompt: a tool-permission dialog ("Do you want to proceed?" with numbered options) as the keys that answer it, or null.
 * `yes` is the key for the plain "Yes" option only (never "don't ask again" / "switch mode"); `no` is the number of a "No" option if
 * there is one, else Esc, which Claude Code treats as a refusal. Other dialogs (trust, questions with their own options) are not
 * answerable from outside and give null.
 */
export const permissionPrompt = (screenLines: string[]): Permission | null => {
  const lines = screenLines.map((l) => l.replace(/^[\s│┃]+|[\s│┃]+$/g, ''))
  const q = lines.map((l) => /^Do you want to .+\?$/.test(l)).lastIndexOf(true)
  if (q < 0) return null
  let yes: string | null = null, no = '\x1b', want = 1
  for (const l of lines.slice(q + 1)) {
    const m = OPTION.exec(l)
    if (!m) { if (want > 1) break; else continue }
    if (+m[1] !== want) return null // not a clean 1, 2, 3… list: don't guess
    want++
    if (/^Yes$/i.test(m[2])) yes ??= m[1]
    else if (/^No\b/i.test(m[2]) && no === '\x1b') no = m[1]
  }
  return want > 2 && yes ? { question: lines[q], yes, no } : null
}
