import { describe, expect, it } from 'vitest'
import type { Run } from '../shared/agents'
import { groupChains } from '../shared/chains'

const run = (id: string, extra: Partial<Run> = {}): Run => ({ id, agentId: id, agentName: id, profile: 'claude', input: { from: 'user', to: id, text: '' }, status: 'done', queuedAt: `2026-11-22T10:0${id.length}:00Z`, progress: [], ...extra })

describe('groupChains', () => {
  it('nests handed-over runs under their parent and sums tokens and cost', () => {
    const a = run('a', { chainId: 'a', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } })
    const b = run('bb', { chainId: 'a', parentRunId: 'a', hops: 1, usage: { inputTokens: 20, costUsd: 0.02 } })
    const c = run('ccc', { chainId: 'a', parentRunId: 'bb', hops: 2 })
    const [chain] = groupChains([c, b, a])
    expect(chain.runs.map((r) => [r.run.id, r.depth])).toEqual([['a', 0], ['bb', 1], ['ccc', 2]])
    expect(chain.tokens).toBe(35)
    expect(chain.costUsd).toBeCloseTo(0.03)
  })
  it('keeps unrelated runs as chains of one, newest first, and survives a pruned parent', () => {
    const x = run('x', { chainId: 'x' })
    const y = run('yy', { chainId: 'yy' })
    const orphan = run('zzz', { chainId: 'q', parentRunId: 'gone' })
    const chains = groupChains([x, y, orphan])
    expect(chains.map((c) => c.id)).toEqual(['q', 'yy', 'x'])
    expect(chains[0].runs).toHaveLength(1)
  })
})
