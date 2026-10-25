/** Does a card match the board filter? Every word the user typed must appear somewhere in the card's text (case-insensitive). */
export function matches(query: string, parts: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = parts.filter((p): p is string => !!p).join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Status chips: with none selected every status matches; otherwise a card must be in one of the selected statuses. */
export const statusMatches = (selected: ReadonlySet<string>, status: string) => selected.size === 0 || selected.has(status)
