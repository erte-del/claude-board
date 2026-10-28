import type { TermTheme } from './termthemes.mts'

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const byte = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 255).toString(16).padStart(2, '0') : null
}

/** An iTerm `.itermcolors` file (an XML plist) as a terminal theme, or null if it lacks the background, foreground or any of the 16 ANSI colours.
 *  The colour space is ignored: iTerm's sRGB and calibrated exports are both read as plain sRGB. */
export function parseItermColors(xml: string): TermTheme | null {
  const colors = new Map<string, string>()
  for (const [, key, body] of xml.matchAll(/<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g)) {
    const c = ['Red', 'Green', 'Blue'].map((n) => byte(new RegExp(`<key>${n} Component</key>\\s*<(?:real|integer)>([^<]+)</`).exec(body)?.[1] ?? ''))
    if (c.every((v) => v !== null)) colors.set(key, `#${c.join('')}`)
  }
  const ansi = Array.from({ length: 16 }, (_, i) => colors.get(`Ansi ${i} Color`))
  const background = colors.get('Background Color'), foreground = colors.get('Foreground Color')
  if (!background || !foreground || ansi.some((c) => !c)) return null
  const theme: TermTheme = { background, foreground, cursor: colors.get('Cursor Color') ?? foreground, selectionBackground: colors.get('Selection Color') ?? ansi[8]! }
  NAMES.forEach((n, i) => { theme[n] = ansi[i]!; theme[`bright${n[0].toUpperCase()}${n.slice(1)}`] = ansi[i + 8]! })
  return theme
}
