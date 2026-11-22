import type { AgentDef, AgentOrganization } from '@shared/agents'

/** Agents in their groups (in the user's order), then the ungrouped ones; empty sections are left out. */
export function groupSections(agents: AgentDef[], org: Pick<AgentOrganization, 'groups' | 'group'>) {
  const known = new Set(org.groups)
  return [...org.groups.map((name) => ({ name, list: agents.filter((g) => org.group[g.id] === name) })), { name: '', list: agents.filter((g) => !known.has(org.group[g.id] ?? '')) }].filter((s) => s.list.length)
}
