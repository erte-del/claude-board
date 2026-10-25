import { realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

export type DirResult = { ok: true; path: string } | { ok: false; error: string }

/**
 * Accepts what you'd type in a shell: `cd ~/foo`, `~/foo`, `"my dir"`, `my\ dir`; relative paths resolve from home.
 * shortcut: no $VAR expansion or tab completion; add if typing paths gets tedious.
 */
export function resolveDir(input: string, home = os.homedir()): DirResult {
  let t = input.trim().replace(/^cd(\s+|$)/, '').trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\ /g, ' ')
  if (!t || t === '~') t = home
  else if (t.startsWith('~/')) t = path.join(home, t.slice(2))
  const abs = path.resolve(home, t)
  if (!isDir(abs)) return { ok: false, error: `No such folder: ${abs}` }
  // Always the real path: a chat reports (and files its transcript under) its real working folder, so for a symlinked one
  // (/tmp, /var, a linked project) the app would otherwise look for the transcript under the wrong name and show nothing.
  return { ok: true, path: realpathSync(abs) }
}
