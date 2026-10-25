import { build, context } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const watch = process.argv.includes('--watch')
mkdirSync('dist', { recursive: true })
copyFileSync('src/renderer/index.html', 'dist/index.html')

const common = { bundle: true, sourcemap: true, logLevel: 'info' }
const configs = [
  { ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', 'node-pty'] },
  { ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife', external: ['file://*'] },
]
for (const c of configs) {
  if (watch) await (await context(c)).watch()
  else await build(c)
}
