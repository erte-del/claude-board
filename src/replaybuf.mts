/** Append to the replay buffer, keeping the last `max` chars. A cut can land inside an escape sequence, which garbles the
 *  screen on replay, so a trimmed buffer restarts at the next line break. */
export function appendReplay(buf: string, d: string, max: number): string {
  const all = buf + d
  if (all.length <= max) return all
  const cut = all.slice(-max)
  const nl = cut.indexOf('\n')
  return nl < 0 ? cut : cut.slice(nl + 1)
}
