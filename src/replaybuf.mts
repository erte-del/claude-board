/** Append to the replay buffer, keeping the last `max` chars. A cut can land inside an escape sequence, which garbles the
 *  screen on replay, so a trimmed buffer restarts at the next line break. */
export function appendReplay(buf: string, d: string, max: number): string {
  const all = buf + d
  if (all.length <= max) return all
  const cut = all.slice(-max)
  const nl = cut.indexOf('\n')
  return nl < 0 ? cut : cut.slice(nl + 1)
}

/** DECSET/DECRST sequences that put a fresh terminal in the given private modes (alternate screen, mouse reporting, bracketed
 *  paste...). Claude Code sets them once at startup, so they are long gone from a trimmed replay buffer. Synchronized output
 *  (2026) is left out: replaying it mid-frame would freeze the screen until the next frame. */
export function modePrefix(modes: Map<number, boolean>): string {
  let s = ''
  for (const [n, on] of modes) if (n !== 2026) s += `\x1b[?${n}${on ? 'h' : 'l'}`
  return s
}
