import { dump, load } from 'js-yaml'
import type { AgentDef, AgentOutput, Permission } from '@shared/agents'

export type { AgentDef, AgentOutput, Permission }
export type TriggerKind = 'manual' | 'schedule' | 'on-open' | 'file-watch'

const PERMISSIONS: Permission[] = ['read', 'propose', 'act']
const OUTPUTS: AgentOutput[] = ['reply', 'file', 'suggestions', 'actions']
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

export class AgentError extends Error {}

const list = (v: unknown, field: string): string[] => {
  if (v == null) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' && typeof x !== 'number')) throw new AgentError(`"${field}" must be a list.`)
  return v.map(String)
}

/** Reads one agent file: YAML frontmatter, then the instructions. Throws AgentError with a message fit for the UI. */
export function parseAgent(id: string, text: string): AgentDef {
  if (!ID_RE.test(id)) throw new AgentError(`"${id}" isn't a valid agent id (lowercase letters, digits and dashes).`)
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new AgentError('Missing the --- frontmatter block at the top.')
  let fm: any
  try {
    fm = load(m[1])
  } catch (e) {
    throw new AgentError(`Frontmatter isn't valid YAML: ${(e as Error).message.split('\n')[0]}`)
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) throw new AgentError('Frontmatter must be key: value lines.')
  const permission = fm.permission ?? 'read'
  if (!PERMISSIONS.includes(permission)) throw new AgentError(`"permission" must be one of ${PERMISSIONS.join(', ')}.`)
  const output = fm.output ?? 'reply'
  if (!OUTPUTS.includes(output)) throw new AgentError(`"output" must be one of ${OUTPUTS.join(', ')}.`)
  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : id
  const profile = typeof fm.profile === 'string' && fm.profile ? fm.profile : 'claude'
  const budget = fm.budget == null ? undefined : Number(fm.budget)
  if (budget !== undefined && !(budget > 0 && budget <= 100)) throw new AgentError('"budget" is a percent between 1 and 100.')
  const workdir = fm.workdir == null ? undefined : String(fm.workdir)
  if (workdir && (workdir.startsWith('/') || workdir.split('/').includes('..'))) throw new AgentError('"workdir" must stay inside the vault.')
  const instructions = m[2].trim()
  if (!instructions) throw new AgentError('The instructions (text after the frontmatter) are empty.')
  return {
    id,
    name,
    profile,
    model: fm.model ? String(fm.model) : undefined,
    effort: fm.effort ? String(fm.effort) : undefined,
    permission,
    workdir,
    sources: list(fm.sources, 'sources'),
    triggers: list(fm.triggers, 'triggers').length ? list(fm.triggers, 'triggers') : ['manual'],
    output,
    budget,
    description: fm.description ? String(fm.description) : undefined,
    instructions
  }
}

export function serializeAgent(a: AgentDef): string {
  const fm: Record<string, unknown> = { name: a.name, profile: a.profile, permission: a.permission, output: a.output, triggers: a.triggers }
  if (a.description) fm.description = a.description
  if (a.model) fm.model = a.model
  if (a.effort) fm.effort = a.effort
  if (a.workdir) fm.workdir = a.workdir
  if (a.sources.length) fm.sources = a.sources
  if (a.budget) fm.budget = a.budget
  return `---\n${dump(fm, { lineWidth: 120 })}---\n\n${a.instructions.trim()}\n`
}
