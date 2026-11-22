import { describe, expect, it } from 'vitest'
import type { AgentDef } from '../shared/agents'
import { rankAgents } from '../shared/route'

const def = (id: string, description: string, instructions = ''): AgentDef => ({ id, name: id, profile: 'claude', permission: 'read', sources: [], triggers: ['manual'], output: 'reply', description, instructions })

describe('rankAgents', () => {
  const agents = [def('email-triage', 'Sorts incoming email and drafts replies'), def('researcher', 'Finds papers and summarises research topics', 'Read sources and summarise findings'), def('planner', 'Plans the week')]
  it('puts the agent whose description matches first', () => {
    expect(rankAgents('Reply to the email from Anna and draft an answer', agents)[0].agent.id).toBe('email-triage')
    expect(rankAgents('Summarise research on sampling', agents)[0].agent.id).toBe('researcher')
  })
  it('breaks ties by recent use and skips built-ins', () => {
    const r = rankAgents('nothing in common', [...agents, { ...def('daily-brief', 'x'), builtin: true }], { planner: 5 })
    expect(r.map((x) => x.agent.id)).toEqual(['planner', 'email-triage', 'researcher'])
    expect(r.every((x) => x.score === 0)).toBe(true)
  })
})
