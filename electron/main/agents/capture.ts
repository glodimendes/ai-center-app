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

export interface Mentions {
  /** Agents tagged with @id or @name (in order, without duplicates). */
  agents: AgentDef[]
  /** The message with the tags removed. */
  text: string
  /** Tags that matched no agent. */
  unknown: string[]
}

/** `@agent` tags anywhere in a message (not inside words or e-mail addresses). Built-in agents aren't addressable. */
export function parseMentions(text: string, agents: AgentDef[]): Mentions {
  const squash = (s: string) => slug(s).replace(/-/g, '')
  const found: AgentDef[] = []
  const unknown: string[] = []
  const stripped = text.replace(/(^|\s)@([^\s@]+)/g, (whole, lead: string, name: string) => {
    const hit = agents.filter((a) => !a.builtin).find((a) => a.id === slug(name) || squash(a.name) === squash(name) || squash(a.id) === squash(name))
    if (!hit) return unknown.push(name), whole
    if (!found.includes(hit)) found.push(hit)
    return lead
  })
  return { agents: found, text: stripped.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim(), unknown }
}

/** A transcript as plain text, for engines that can't keep a conversation themselves. */
export function withHistory(history: { role: 'user' | 'agent'; text: string }[], message: string, limit = 10): string {
  const recent = history.slice(-limit)
  if (!recent.length) return message
  return `Conversation so far:\n${recent.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n')}\n\nNew message from the user: ${message}`
}
