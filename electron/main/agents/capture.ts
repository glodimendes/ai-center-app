import type { AgentDef } from '@shared/agents'

export type CaptureRoute = { kind: 'inbox'; text: string } | { kind: 'agent'; agent: AgentDef; message: string } | { kind: 'unknown'; name: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * `@agent message` goes to that agent (matched by id, or by its name written without spaces: `@email-triage`, `@emailtriage`);
 * anything else keeps its old behaviour and lands in the inbox. Built-in agents have their own places and aren't addressable here.
 */
export function routeCapture(text: string, agents: AgentDef[]): CaptureRoute {
  const m = text.trim().match(/^@([^\s]+)\s*([\s\S]*)$/)
  if (!m) return { kind: 'inbox', text: text.trim() }
  const key = slug(m[1])
  const squash = (s: string) => slug(s).replace(/-/g, '')
  const hit = agents.filter((a) => !a.builtin).find((a) => a.id === key || squash(a.name) === squash(m[1]) || squash(a.id) === squash(m[1]))
  return hit ? { kind: 'agent', agent: hit, message: m[2].trim() } : { kind: 'unknown', name: m[1] }
}
