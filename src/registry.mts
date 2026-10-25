export type RegEntry = { sessionId: string; cwd: string }

/** The saved list of chats the app started. Anything malformed or duplicated is dropped rather than trusted. */
export function sanitizeRegistry(raw: unknown): RegEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: RegEntry[] = []
  for (const r of raw) {
    if (!r || typeof r.sessionId !== 'string' || typeof r.cwd !== 'string' || !r.sessionId || !r.cwd) continue
    if (seen.has(r.sessionId)) continue
    seen.add(r.sessionId)
    out.push({ sessionId: r.sessionId, cwd: r.cwd })
  }
  return out
}
