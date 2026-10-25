/**
 * A file path as it should be typed into a shell prompt (what Terminal.app inserts when you drop a file): characters the
 * shell would treat specially are backslash-escaped. A path with control characters (a newline in a file name) can't be
 * backslash-escaped, so it is single-quoted instead.
 */
export function shellEscapePath(p: string): string {
  if (/[\u0000-\u001f\u007f]/.test(p)) return `'${p.replace(/'/g, `'\\''`)}'`
  return p.replace(/[^A-Za-z0-9_\-.,:/@%+=~\u0080-￿]/g, '\\$&')
}
