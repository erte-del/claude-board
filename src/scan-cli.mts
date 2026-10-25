import { groupByCwd, scanSessions } from './scanner.mts'

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const sessions = await scanSessions()
const groups = [...groupByCwd(sessions)].sort((a, b) => b[1][0].mtimeMs - a[1][0].mtimeMs)
console.log(`${sessions.length} sessions in ${groups.length} folders\n`)
for (const [cwd, list] of groups) {
  console.log(`${cwd}  (${list.length})`)
  for (const s of list.slice(0, Number(process.argv[2] ?? 5))) console.log(`  ${s.sessionId.slice(0, 8)}  ${ago(s.mtimeMs).padStart(4)} ago  ${String(s.messageCount).padStart(4)} msgs  ${s.title}`)
}
