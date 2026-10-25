/**
 * OSC 52 is how a program in a terminal asks to put text on the clipboard: ESC ] 52 ; <targets> ; <base64> BEL. Returns that text,
 * or null for anything else, including the "?" form that asks to READ the clipboard (never answered) and anything over `max` bytes.
 */
export function parseOsc52(data: string, max = 1_000_000): string | null {
  const i = data.indexOf(';')
  if (i < 0) return null
  const b64 = data.slice(i + 1)
  if (!b64 || b64 === '?' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length > Math.ceil((max * 4) / 3) + 4) return null
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) // atob + TextDecoder exist in both Node and the renderer
    if (bytes.length > max) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}
