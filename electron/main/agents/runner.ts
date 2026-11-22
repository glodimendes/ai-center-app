import { isAbsolute, join, relative } from 'node:path'
import type { AgentDef } from './definition'
import type { HandoffPacket, Limits } from '@shared/agents'
import { ENGINES, EngineTimeout, failureMessage, runEngine, type Usage } from './engines'
import { engineMode } from './permissions'
import { findProfile } from './profiles'
import type { AccountProfile } from './engines/types'

const ACTIONS_FORMAT = `If you want something done outside your own output (add or complete a task, create a calendar event, draft an email, call an API), do NOT do it yourself. End your answer with a fenced block (no introducing sentence or label before it) the app shows to the user for approval:
\`\`\`actions
[{"kind": "add-task | complete-task | create-event | email-draft | api-call | run-agent | new-agent", "title": "short label for the user", "payload": {"...": "what is needed to do it"}}]
\`\`\`
Use payload {"section": ["Heading"], "body": "task text"} for add-task, {"taskId": "..."} for complete-task, {"agent": "agent-id", "input": "..."} for run-agent (hands work to another agent), and the agent's fields (id, name, permission, output, instructions, triggers) for new-agent. Nothing in that block happens without the user's click.`

/** Most handoffs one after another before the app stops offering more (a chain can't run away). */
export const MAX_HOPS = 3
/** A handed-over text longer than this travels as a vault file; the receiver gets the path and a short head. */
export const SPILL_CHARS = 2000

/** Chat answers may point at another agent. Only handing work over and adding a task can be proposed this way; the user's click decides. */
export function handoffFormat(peers: { id: string; description?: string }[]): string {
  const list = peers.map((p) => `- ${p.id}${p.description ? `: ${p.description}` : ''}`).join('\n')
  return `If part of your answer is clearly better handled by one of the user's other agents, or is a task worth adding, you may end your answer with a fenced block (no sentence or label before it):
\`\`\`actions
[{"kind": "run-agent", "title": "short label", "payload": {"agent": "agent-id", "objective": "what that agent should achieve", "input": "only the material it needs", "expect": "the form the answer should take"}}, {"kind": "add-task", "title": "short label", "payload": {"section": ["Heading"], "body": "task text"}}]
\`\`\`
The other agent sees nothing of this conversation, so the objective and input must stand on their own. Nothing in that block happens without the user's click. Propose only when it clearly helps; most answers need none.${list ? `\nOther agents:\n${list}` : ''}`
}

/** The message the receiving agent gets for a handoff (also what the chat shows). */
export function renderPacket(p: HandoffPacket, fromName: string): string {
  return [
    `Handed over by ${fromName}.`,
    `Objective: ${p.objective}`,
    p.expect ? `Expected answer: ${p.expect}` : '',
    p.context?.length ? `Read first:\n${p.context.map((c) => `- ${c}`).join('\n')}` : '',
    p.input ? `Material:\n"""\n${p.input}\n"""` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** A resumed chat turn is just the user's message: the CLI already holds the instructions and earlier turns. */
export function buildPrompt(def: AgentDef, input: string, date: string, sources = '', resumed = false, handoff = '', where?: { cwd: string; vault: string }): string {
  if (resumed) return input.trim()
  const parts = [def.instructions, `Today is ${date}.`]
  if (where && where.cwd !== where.vault) parts.push(`You work in ${where.cwd}. The user's vault (their notes, tasks and projects) is at ${where.vault}: read it there when you need it.`)
  if (sources) parts.push(sources)
  if (input.trim()) parts.push(`The user's input for this run:\n"""\n${input.trim()}\n"""`)
  if (def.permission === 'read') parts.push('You can only read files; you cannot change anything. Answer in plain text.')
  if (def.permission === 'propose') parts.push('Your file edits are shown to the user as a diff and kept only if they approve. Finish with a short plain-text summary of what you changed.')
  if (def.output === 'actions' || def.output === 'suggestions') parts.push(ACTIONS_FORMAT)
  else if (handoff) parts.push(handoff)
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
  /** Text of the agent's data sources (see sources.ts), already fetched. */
  sources?: string
  /** Chat and central runs: how the agent may propose handing work to another agent (see handoffFormat). */
  handoff?: string
  /** Continue (or start) a chat conversation for this agent. */
  session?: { id: string; resume: boolean }
  /** Where the agent works (see resolveCwd). Unset = the vault. */
  cwd?: string
}

/**
 * The folder an agent works in: the conversation's own folder, else the agent's `workdir` (vault-relative or absolute),
 * else its own empty workspace under the app's data folder. The vault is always added next to it (see vaultDirs).
 */
export function resolveCwd(def: Pick<AgentDef, 'id' | 'workdir'>, o: { vaultRoot: string; workspaces: string; chatFolder?: string }): string {
  const pick = o.chatFolder || def.workdir
  if (pick) return isAbsolute(pick) ? pick : join(o.vaultRoot, pick)
  return join(o.workspaces, def.id)
}

/** The vault as an extra folder, unless the agent already works inside it. */
export function vaultDirs(cwd: string, vaultRoot: string): string[] {
  const rel = relative(vaultRoot, cwd)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? [] : [vaultRoot]
}

/** Runs one agent definition through its engine, with the permission mapped to flags. Returns the final text. */
export async function runAgentDef(def: AgentDef, input: string, ctx: RunContext): Promise<{ text: string; usage?: Usage; sessionId?: string }> {
  const profile = findProfile(def.profile, ctx.profiles)
  const cwd = ctx.cwd ?? ctx.vaultRoot
  const rel = (p: string) => (p ? relative(ctx.vaultRoot, p) || p : '')
  const timeoutMs = ctx.timeoutMs ?? 6 * 60_000
  const run = await runEngine(ENGINES[profile.engine], {
    profile,
    mode: engineMode(def.permission),
    prompt: buildPrompt(def, input, ctx.date, ctx.sources, ctx.session?.resume, ctx.handoff, { cwd, vault: ctx.vaultRoot }),
    session: ctx.session,
    model: def.model,
    effort: def.effort,
    cwd,
    addDirs: vaultDirs(cwd, ctx.vaultRoot),
    purpose: `agent:${def.id}`,
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
    if (r.code !== 0 && !r.text) throw new Error(failureMessage(r.stderr, r.code, profile.engine))
    return { text: r.text, usage: r.usage, sessionId: r.sessionId }
  } catch (e) {
    throw e instanceof EngineTimeout ? new Error(`Stopped after ${Math.round(timeoutMs / 60_000)} minutes without finishing.`) : e
  }
}
