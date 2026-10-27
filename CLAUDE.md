# Claude Board

Electron app (macOS, arm64) that shows all terminal Claude Code chats on one board. Each chat is a real `claude` CLI in a node-pty
pseudo-terminal rendered with xterm.js. Nothing is re-implemented on top of the API.

## Workflow

- **Claude makes the commits and pushes to GitHub** (`origin` = `erte-del/claude-board`, branch `main`). The owner does not run git by hand.
- **Test whatever you build before you commit.** Run `npm run check` (typecheck + unit tests + fast smoke). For a UI change, also
  drive the real feature (the button, the flow) and say what you saw. Passing unit tests alone is not "it works".
- If a check can't run, say so in the commit/summary. Never commit as if it passed.
- One small commit per change, short imperative subject in the existing style (`Show the folder name on the branch row`).
  Version bumps are their own commit (`Version 1.1.0`).
- Don't commit `dist/`, `release/` or `node_modules/` (all gitignored).

## Commands

| | |
|---|---|
| `npm run check` | typecheck + `npm test` + `npm run smoke:fast`. Run before every commit. |
| `npm test` | `node --test src/*.test.mts` (pure logic, ~125 tests) |
| `npm run smoke` / `smoke:fast` | drives the real built `dist/` app offline with a stand-in `claude` in a throwaway HOME. `:fast` skips the slow `limit` scenario. `npm run smoke -- chat` runs one scenario. |
| `npm run build` | esbuild bundle into `dist/` (`build.mjs`) |
| `npm run dev` | build then launch Electron |
| `npm run package` | build + electron-builder + ad-hoc codesign → `release/mac-arm64/Claude Board.app` |
| `npm run scan` | run the transcript scanner from the CLI |

Smoke runs take a lock (`$TMPDIR/claude-board-smoke.lock`), so a second run waits for the first. Don't run two at once or fight over it.

## Layout

- `src/main.ts`, `src/preload.ts`: Electron main process and the bridge. `src/types.ts` holds shared types (`ChatInfo`, status values `working|idle|waiting|limit|ended`).
- `src/*.mts`: small pure modules, each with a sibling `*.test.mts`. **Put new logic here with a test**, then wire it into main/renderer.
- `src/renderer/`: UI. `board.ts` (the board and cards), `renderer.ts` (wiring, handlers, keyboard), `chatview.ts`, `settings.ts`, `cardmenu.ts`, `tour.ts`, plus `index.html` and `styles.css`.
- `scripts/smoke.mjs` + `scripts/smoke/`: end-to-end harness. `docs/screenshots/` is for the README.

## Conventions

- Match the surrounding code: terse, few comments, and comments explain *why*. TypeScript, no new dependencies for something a few lines can do.
- A new setting goes through the existing settings/layout persistence, not a new storage path.
- When chat state changes in the list (`onChatsChanged`), any derived UI (e.g. reconnect pick state via `syncPick()`) must resync. This has already caused one bug.
- Ended chats only revive if `status === 'ended' && resumable`; `revivable()` in `renderer.ts` is the shared check.

## Local environment gotchas

- `tsc` may be missing (`node_modules/.bin/tsc: No such file`) when `npm install` hasn't completed. Then `npm run typecheck` can't run; report it rather than skipping silently.
- `npm install` has failed on this machine's network twice: first `SELF_SIGNED_CERT_IN_CHAIN` (fixed by `NODE_OPTIONS="--use-system-ca"`, already in the rebuild script), then `403 Forbidden` on `yargs-parser@21.1.1` (an electron-builder dependency). The registry/proxy config is default, so it looks like a network policy. Don't switch registries or work around it; ask the owner.
- `postinstall` runs `electron-rebuild` for node-pty and needs Xcode Command Line Tools.

## Deploying to the owner's machine

`~/Desktop/Rebuild Claude Board.command` builds with `npm run package`, replaces `~/Desktop/Claude Board.app` in place and opens it.
"Replace the desktop copy" means that. The owner double-clicks it from Finder, so Claude can't run it for them if the network blocks `npm install`.

## Docs

User-facing changes update `README.md` (install, features, shortcuts). The app is ad-hoc signed, not notarized; keep the README's first-launch note accurate.
