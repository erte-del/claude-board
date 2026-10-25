import path from 'node:path'

/**
 * A GUI app (opened from the Dock or Finder) gets launchd's bare environment, not the one Terminal.app builds from your shell
 * config, so `claude` (usually in ~/.local/bin, added in ~/.zshrc) and everything Claude Code runs (node, npx, MCP servers)
 * can't be found. The fix is to ask the user's own shell for its environment once and use that.
 */

/** Parse `env -0` output (NUL-separated KEY=VALUE) that follows `marker`; anything before it is shell start-up noise. */
export function parseEnv0(output: string, marker: string): Record<string, string> | null {
  const i = output.lastIndexOf(marker)
  if (i < 0) return null
  const env: Record<string, string> = {}
  for (const entry of output.slice(i + marker.length).split('\0')) {
    const eq = entry.indexOf('=')
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return env
}

/** Where `claude` is usually installed, tried after PATH. */
export const commonBinDirs = (home: string) => [
  path.join(home, '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(home, '.claude', 'local'),
  path.join(home, '.npm-global', 'bin'),
  path.join(home, '.bun', 'bin'),
  path.join(home, '.volta', 'bin'),
]

/** First executable `name` along PATH (in order), then the extra directories. */
export function findExecutable(name: string, pathVar: string, extraDirs: string[], isExecutable: (p: string) => boolean): string | null {
  for (const dir of [...pathVar.split(':'), ...extraDirs]) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}
