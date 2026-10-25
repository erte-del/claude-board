const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function zoned(ms: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(ms).map((p) => [p.type, p.value]),
  )
  return { y: +parts.year, m: +parts.month, d: +parts.day, H: +parts.hour % 24, M: +parts.minute, S: +parts.second }
}
const offsetMs = (ms: number, tz: string) => {
  const z = zoned(ms, tz)
  return Date.UTC(z.y, z.m - 1, z.d, z.H, z.M, z.S) - Math.floor(ms / 1000) * 1000
}

/** The instant (epoch ms) at which the wall clock in `tz` reads y-m-d H:M. Two passes so it is right across a DST change. */
export function zonedToUtc(y: number, m: number, d: number, H: number, M: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, H, M)
  const first = guess - offsetMs(guess, tz)
  return guess - offsetMs(first, tz)
}

/**
 * When a usage-limit message says the limit lifts: "resets 2:40am (Asia/Dubai)", "resets 7pm (Asia/Dubai)",
 * "resets Oct 27 at 1am (Asia/Dubai)". `ref` is when the message was written (the next such time after it), so the answer is
 * a fixed instant, not "the next 2:40am from now". Returns null if the text has no recognisable reset time.
 */
export function parseReset(text: string, ref: number, localTz = Intl.DateTimeFormat().resolvedOptions().timeZone): number | null {
  const m = /resets\s+(?:([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:at|,)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(text)
  if (!m) return null
  const hour12 = +m[3], minute = m[4] ? +m[4] : 0
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null
  const H = (hour12 % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0)
  let tz = (m[6] ?? localTz).trim()
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch { tz = localTz } // unknown zone name: assume local
  const now = zoned(ref, tz)
  if (m[1]) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mo < 0) return null
    const t = zonedToUtc(now.y, mo + 1, +m[2], H, minute, tz)
    return t < ref - 86_400_000 ? zonedToUtc(now.y + 1, mo + 1, +m[2], H, minute, tz) : t // "Jan 2" written in December means next year
  }
  const t = zonedToUtc(now.y, now.m, now.d, H, minute, tz)
  return t > ref ? t : zonedToUtc(now.y, now.m, now.d + 1, H, minute, tz)
}

/** "2h 14m", "14m", "<1m". */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return '<1m'
  const mins = Math.floor(ms / 60_000)
  const h = Math.floor(mins / 60)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
}
