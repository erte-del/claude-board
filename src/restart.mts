/**
 * Auto-restart budget: a crashed chat may be resumed at most `max` times within `windowMs`, so a broken `claude` can't loop forever.
 * `times` are the earlier restarts (epoch ms); returns whether to restart now and the history to keep.
 */
export function planRestart(times: number[], now: number, max = 3, windowMs = 10 * 60_000): { ok: boolean; times: number[] } {
  const recent = times.filter((t) => now - t < windowMs)
  return recent.length >= max ? { ok: false, times: recent } : { ok: true, times: [...recent, now] }
}
