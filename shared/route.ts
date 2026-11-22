import type { AgentDef } from './agents'

const STOP = new Set('the and for with that this from have has are was were you your not but can will all any out about into over then than them they what when which who how its our their there here also just like more some such only very been being would could should'.split(' '))

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w))

/**
 * Which agents a piece of text fits best, so the app can suggest where to hand it. Plain word overlap with each agent's name,
 * description and the start of its instructions (no model call); ties go to the agent used most recently.
 */
export function rankAgents(text: string, agents: AgentDef[], recent: Record<string, number> = {}): { agent: AgentDef; score: number }[] {
  const tokens = new Set(words(text))
  return agents
    .filter((a) => !a.builtin)
    .map((agent) => {
      const head = new Set(words(`${agent.name} ${agent.id.replace(/-/g, ' ')} ${agent.description ?? ''}`))
      const body = new Set(words(agent.instructions.slice(0, 600)))
      let score = 0
      for (const t of tokens) score += head.has(t) ? 3 : body.has(t) ? 1 : 0
      return { agent, score }
    })
    .sort((a, b) => b.score - a.score || (recent[b.agent.id] ?? 0) - (recent[a.agent.id] ?? 0) || a.agent.name.localeCompare(b.agent.name))
}
