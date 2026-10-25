import { appendFileSync, renameSync, statSync } from 'node:fs'

/** A plain text log that keeps one previous generation: when `file` passes `maxBytes` it becomes `file.old`. Never throws. */
export const createLogger = (file: string, maxBytes = 1_000_000) => (msg: string) => {
  try {
    try { if (statSync(file).size > maxBytes) renameSync(file, file + '.old') } catch { /* no log yet */ }
    appendFileSync(file, `${new Date().toISOString()} ${msg}\n`)
  } catch { /* logging must never break the app */ }
}
