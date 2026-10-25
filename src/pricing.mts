// Context windows: Anthropic's model table (all four current models are 1M).
export const CONTEXT_WINDOW: Record<string, number> = {
  'claude-sonnet-5-5': 1_000_000,
  'claude-opus-5-5': 1_000_000,
  'claude-haiku-5-5': 1_000_000,
  'claude-fable-5-1': 1_000_000,
}

// $ per million tokens. Only models whose prices were *verified* are listed; anything else shows no cost rather than a guess.
// Sonnet 5.5, checked against Claude Code's own `cost-state` totals: matched to the cent on sessions after ~Oct 16 2026
// (mean error 1%, worst 5%). NOTE the cache-read price here is $0.10, half of the $0.20 in Anthropic's published table:
// sessions before ~Oct 16 reconcile at $0.20 and later ones at $0.10, so the table looks stale. Re-verify if prices change.
// write5m is null when no 5-minute cache writes were ever seen in the checking data: such a message then has no cost rather than a guess.
// Haiku 5.5, solved from three of Claude Code's `lastModelUsage` totals in ~/.claude.json (two tiny no-cache sessions give in and out
// exactly; the third, with 1h cache writes and reads, then reconciles to the cent fraction): in $0.10, out $0.50, read $0.01, 1h write $0.20.
// Opus 5.5 and Fable 5.1 have no cost-state data on this machine, so they have no price.
export type Price = { in: number; out: number; read: number; write1h: number; write5m: number | null }
export const PRICES: Record<string, Price> = {
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.1, write1h: 4, write5m: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, write1h: 0.2, write5m: null },
}

export type Usage = { in: number; out: number; read: number; write1h: number; write5m: number }

/** Cost in USD of one assistant message, or null if the model's price isn't known. */
export function messageCost(model: string | null, u: Usage): number | null {
  const p = model ? PRICES[model] : undefined
  if (!p || (u.write5m > 0 && p.write5m === null)) return null
  return (u.in * p.in + u.out * p.out + u.read * p.read + u.write1h * p.write1h + u.write5m * (p.write5m ?? 0)) / 1e6
}

/** Everything the model had to read for one request: what is in the context window right now. */
export const contextOf = (u: Usage) => u.in + u.read + u.write1h + u.write5m

export function formatTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}

export function formatUsd(usd: number): string {
  return usd < 0.005 ? '<$0.01' : usd < 10 ? `$${usd.toFixed(2)}` : usd < 100 ? `$${usd.toFixed(1)}` : `$${Math.round(usd)}`
}
