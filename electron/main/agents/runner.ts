import { join, relative } from 'node:path'
import type { AgentDef } from './definition'
import type { Limits } from '@shared/agents'
import { ENGINES, EngineTimeout, runEngine, type Usage } from './engines'
import { engineMode } from './permissions'
import { findProfile } from './profiles'
import type { AccountProfile } from './engines/types'

const ACTIONS_FORMAT = `If you want something done outside your own output (add or complete a task, create a calendar event, draft an email, call an API), do NOT do it yourself. End your answer with a fenced block (no introducing sentence or label before it) the app shows to the user for approval:
\`\`\`actions
[{"kind": "add-task | complete-task | create-event | email-draft | api-call", "title": "short label for the user", "payload": {"...": "what is needed to do it"}}]
\`\`\`
Use payload {"section": ["Heading"], "body": "task text"} for add-task, {"taskId": "..."} for complete-task. Nothing in that block happens without the user's click.`

export function buildPrompt(def: AgentDef, input: string, date: string): string {
  const parts = [def.instructions, `Today is ${date}.`]
  if (input.trim()) parts.push(`The user's input for this run:\n"""\n${input.trim()}\n"""`)
  if (def.permission === 'read') parts.push('You can only read files; you cannot change anything. Answer in plain text.')
  if (def.permission === 'propose') parts.push('Your file edits are shown to the user as a diff and kept only if they approve. Finish with a short plain-text summary of what you changed.')
  if (def.output === 'actions' || def.output === 'suggestions') parts.push(ACTIONS_FORMAT)
  return parts.join('\n\n')
}

export interface RunContext {
  vaultRoot: string
  profiles: AccountProfile[]
  date: string
  onProgress: (line: string) => void
  onCancel: (cancel: () => void) => void
  /** The account's window usage as the CLI reported it during the run. */
  onLimits?: (limits: Omit<Limits, 'asOf'>) => void
  timeoutMs?: number
}

/** Runs one agent definition through its engine, with the permission mapped to flags. Returns the final text. */
export async function runAgentDef(def: AgentDef, input: string, ctx: RunContext): Promise<{ text: string; usage?: Usage }> {
  const profile = findProfile(def.profile, ctx.profiles)
  const cwd = def.workdir ? join(ctx.vaultRoot, def.workdir) : ctx.vaultRoot
  const rel = (p: string) => (p ? relative(ctx.vaultRoot, p) || p : '')
  const timeoutMs = ctx.timeoutMs ?? 6 * 60_000
  const run = await runEngine(ENGINES[profile.engine], {
    profile,
    mode: engineMode(def.permission),
    prompt: buildPrompt(def, input, ctx.date),
    model: def.model,
    effort: def.effort,
    cwd,
    timeoutMs,
    onEvent: (ev) => {
      if (ev.type === 'tool') ctx.onProgress(`${ev.name} ${['Read', 'Edit', 'Write'].includes(ev.name) ? rel(ev.target) : ev.target}`.trim())
      if (ev.type === 'limits') ctx.onLimits?.(ev.limits)
      if (ev.type === 'file_change') ctx.onProgress(`Editing ${rel(ev.path)}`)
    }
  })
  ctx.onCancel(run.cancel)
  try {
    const r = await run.done
    if (r.isError) throw new Error(r.text || 'The model returned an error.')
    if (r.code !== 0 && !r.text) throw new Error(r.stderr.trim().split('\n').slice(-3).join(' ') || `Exited with code ${r.code}.`)
    return { text: r.text, usage: r.usage }
  } catch (e) {
    throw e instanceof EngineTimeout ? new Error(`Stopped after ${Math.round(timeoutMs / 60_000)} minutes without finishing.`) : e
  }
}
