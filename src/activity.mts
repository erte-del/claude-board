// Tells a chat that is working from one that merely repaints. Claude Code redraws its status line on a timer, so an idle chat emits
// a lone burst of bytes every ~10s; a working one streams output (spinner) every ~0.1s. Only sustained output counts as working.
const GAP = 500 // silence this long ends a burst
const SUSTAIN = 700 // a burst must run this long to count (status-line repaints are shorter)
const ECHO = 300 // output this soon after our own input is the terminal echoing or redrawing
const HOLD = 2000 // after the last output, keep reading as working this long

export type Activity = { start: number; last: number }

export const newActivity = (): Activity => ({ start: 0, last: 0 })

export const isWorking = (a: Activity, now: number) => now - a.last < HOLD && a.last - a.start >= SUSTAIN

/** Record an output chunk at `now`. A chunk after a pause starts a new burst, unless the chat is already working (a short lull mid-turn). */
export function record(a: Activity, now: number, lastInput: number) {
  if (now - lastInput <= ECHO) return
  if (now - a.last > GAP && !isWorking(a, now)) a.start = now
  a.last = now
}
