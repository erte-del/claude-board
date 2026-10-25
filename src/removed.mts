export type Removed = { sessionId: string; cwd: string; name: string; at: number }
export const REMOVED_CAP = 500

/** The saved list of removed cards; anything malformed is dropped rather than trusted. */
export function sanitizeRemoved(raw: unknown): Removed[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r) => r && typeof r.sessionId === 'string' && r.sessionId && typeof r.cwd === 'string' && r.cwd)
    .map((r) => ({ sessionId: r.sessionId, cwd: r.cwd, name: typeof r.name === 'string' ? r.name : '', at: Number(r.at) || 0 }))
    .slice(-REMOVED_CAP)
}

/** Newest last, one entry per chat, oldest dropped beyond the cap. */
export function pushRemoved(log: Removed[], entry: Removed, cap = REMOVED_CAP): Removed[] {
  return [...log.filter((e) => e.sessionId !== entry.sessionId), entry].slice(-cap)
}

/** The newest entry that can still be restored, and the log without it. Entries that can't be (transcript gone, already back on the board) are dropped on the way. */
export function takeRestorable(log: Removed[], canRestore: (e: Removed) => boolean): { entry: Removed | null; log: Removed[] } {
  const rest = [...log]
  while (rest.length) {
    const e = rest.pop()!
    if (canRestore(e)) return { entry: e, log: rest }
  }
  return { entry: null, log: rest }
}
