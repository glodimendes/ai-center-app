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

/**
 * The frontmatter as YAML. Files written by hand or by AI tools often have an unquoted ": " inside a value
 * (`description: Tutor: hints first`), which YAML rejects; then simple `key: value` lines are read instead, the
 * value being everything after the first colon (a value starting with [, { or a quote is still read as YAML).
 * Anything more complex (indented lines) keeps the YAML error.
 */
function readFrontmatter(src: string): unknown {
  try {
    return load(src)
  } catch (e) {
    const out: Record<string, unknown> = {}
    for (const line of src.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
      if (!m) throw e
      const v = m[2].trim()
      let value: unknown = v === '' ? null : v
      if (/^[[{"']/.test(v)) {
        try {
          value = load(v)
        } catch {
          /* keep the text */
        }
      }
      out[m[1]] = value
    }
    return out
  }
}

/** Reads one agent file: YAML frontmatter, then the instructions. Throws AgentError with a message fit for the UI. */
export function parseAgent(id: string, text: string): AgentDef {
  if (!ID_RE.test(id)) throw new AgentError(`"${id}" isn't a valid agent id (lowercase letters, digits and dashes).`)
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new AgentError('Missing the --- frontmatter block at the top.')
  let fm: any
  try {
    fm = readFrontmatter(m[1])
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
  if (workdir && workdir.split('/').includes('..')) throw new AgentError('"workdir" can\'t contain "..". Use a folder in the vault (projects) or an absolute path.')
  const instructions = m[2].trim()
  if (!instructions) throw new AgentError('The instructions (text after the frontmatter) are empty.')
  return {
    id,
    name,
    profile,
    // Claude Code's `inherit` means "the default model", which is what no model means here.
    model: fm.model && fm.model !== 'inherit' ? String(fm.model) : undefined,
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

/** Frontmatter fields other tools use in their agent or prompt files (Claude Code subagents and commands, Codex prompts). */
const FOREIGN: Record<string, string> = {
  tools: 'tool list',
  'allowed-tools': 'tool list',
  allowedTools: 'tool list',
  disallowedTools: 'tool list',
  'disallowed-tools': 'tool list',
  permissionMode: 'permission mode',
  mcpServers: 'MCP servers',
  'argument-hint': 'argument hint',
  color: 'colour'
}

export const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/**
 * How a file another tool wrote would be imported. Claude Code and Codex files differ (tool lists, model aliases,
 * `$ARGUMENTS`, no frontmatter at all), so this is lenient where parseAgent is strict: unknown fields are
 * ignored and named, a missing frontmatter means the whole text is the instructions, and an id the app can't use
 * becomes a new file name. What the agent may do always comes from the app's own permission (default: read).
 * `inPlace`: the file reads as it is; otherwise importing writes `<def.id>.md` and leaves the original alone.
 */
export function readForeignAgent(file: string, text: string, taken: (id: string) => boolean): { def: AgentDef; notes: string[]; inPlace: boolean } {
  const stem = file.replace(/\.md$/i, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  let fm: any = {}
  if (m) {
    try {
      fm = readFrontmatter(m[1]) ?? {}
    } catch (e) {
      throw new AgentError(`Frontmatter isn't valid YAML: ${(e as Error).message.split('\n')[0]}`)
    }
    if (typeof fm !== 'object' || Array.isArray(fm)) throw new AgentError('Frontmatter must be key: value lines.')
  }
  const notes: string[] = []
  const foreign = [...new Set(Object.keys(fm).filter((k) => k in FOREIGN).map((k) => FOREIGN[k]))]
  if (foreign.length) notes.push(`Ignored: ${foreign.join(', ')}. What it may do comes from its permission in the app.`)
  if (!m) notes.push('No frontmatter: the whole file becomes its instructions.')
  const body = (m ? m[2] : text).trim()
  if (/\$ARGUMENTS|\$\d\b/.test(body)) notes.push('Uses $ARGUMENTS: in the app, your message is sent after these instructions instead.')
  // The strict reader first, so a file in the app's own format is imported exactly as it is.
  if (ID_RE.test(stem) && m) {
    try {
      return { def: parseAgent(stem, text), notes, inPlace: true }
    } catch {
      /* fall through to the lenient reading */
    }
  }
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : (heading ?? stem)
  // `taken` covers every file in the folder too, so the original is never overwritten.
  let id = slugId(typeof fm.name === 'string' && ID_RE.test(fm.name) ? fm.name : stem) || slugId(name) || 'imported-agent'
  for (let n = 2; taken(id); n++) id = `${slugId(typeof fm.name === 'string' && ID_RE.test(fm.name) ? fm.name : stem).slice(0, 36) || 'imported-agent'}-${n}`
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T, label: string): T => {
    if (v == null) return fallback
    if (allowed.includes(v as T)) return v as T
    notes.push(`"${label}: ${String(v)}" isn't one the app knows; using ${fallback}.`)
    return fallback
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String) : typeof v === 'string' ? [v] : [])
  if (!body) throw new AgentError('The file has no instructions.')
  notes.push(`Saved as ${id}.md in the app's format; the original file stays where it is, hidden.`)
  const model = typeof fm.model === 'string' && fm.model !== 'inherit' ? fm.model : undefined
  return {
    def: {
      id,
      name,
      profile: typeof fm.profile === 'string' && fm.profile ? fm.profile : 'claude',
      model,
      permission: pick(fm.permission, PERMISSIONS, 'read', 'permission'),
      output: pick(fm.output, OUTPUTS, 'reply', 'output'),
      sources: strings(fm.sources),
      triggers: strings(fm.triggers).length ? strings(fm.triggers) : ['manual'],
      description: typeof fm.description === 'string' ? fm.description : undefined,
      instructions: body
    },
    notes,
    inPlace: false
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
