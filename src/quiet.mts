// Keeps chats from stealing focus: `open` and $BROWSER (what CLI tools use to launch an app or URL) go through a shim
// that runs /usr/bin/open -g, so what a chat opens appears behind the board instead of in front of it.
export const SHIM_SCRIPT = '#!/bin/sh\nexec /usr/bin/open -g "$@"\n'

/** The chat environment with the shim dir first on PATH and BROWSER pointing at the shim. */
export function quietEnv(env: Record<string, string>, shimDir: string): Record<string, string> {
  return { ...env, PATH: env.PATH ? `${shimDir}:${env.PATH}` : shimDir, BROWSER: `${shimDir}/open` }
}
