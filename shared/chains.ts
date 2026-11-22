import type { Run } from './agents'

export interface Chain {
  id: string
  /** Runs of the chain, parents before the runs they started; `depth` is how far down the tree each sits. */
  runs: { run: Run; depth: number }[]
  tokens: number
  costUsd: number
  /** Newest run's queue time, to order chains among each other. */
  latest: string
}

/** Groups runs by the chain of handoffs they belong to (`chainId`), as a tree by `parentRunId`, newest chain first. Runs without a chain are chains of one. */
export function groupChains(runs: Run[]): Chain[] {
  const byChain = new Map<string, Run[]>()
  for (const r of runs) byChain.set(r.chainId ?? r.id, [...(byChain.get(r.chainId ?? r.id) ?? []), r])
  const out: Chain[] = []
  for (const [id, members] of byChain) {
    const ids = new Set(members.map((m) => m.id))
    const rows: Chain['runs'] = []
    const walk = (parent: string | undefined, depth: number) => {
      for (const r of members.filter((m) => (ids.has(m.parentRunId ?? '') ? m.parentRunId : undefined) === parent)) {
        rows.push({ run: r, depth })
        walk(r.id, depth + 1)
      }
    }
    walk(undefined, 0)
    // A run whose parent was pruned from the list is still shown, at the top level.
    for (const r of members) if (!rows.some((x) => x.run.id === r.id)) rows.push({ run: r, depth: 0 })
    out.push({
      id,
      runs: rows,
      tokens: members.reduce((n, r) => n + (r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0), 0),
      costUsd: members.reduce((n, r) => n + (r.usage?.costUsd ?? 0), 0),
      latest: members.map((m) => m.queuedAt).sort().at(-1)!
    })
  }
  return out.sort((a, b) => b.latest.localeCompare(a.latest))
}
