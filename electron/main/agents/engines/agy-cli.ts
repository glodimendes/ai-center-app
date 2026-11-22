import type { Engine, EngineEvent } from './types'

/**
 * Antigravity CLI (`agy`). It has execution modes but no per-tool allow lists, so like Codex it is limited by its
 * mode and sandbox rather than by tool names: `plan` + `--sandbox` for read-only runs, `accept-edits` for edits.
 * It can't run the tool-restricted `tools` mode.
 */
export const agyCli: Engine = {
  id: 'agy',
  chat: true,
  readsFiles: true,
  prepare(spec) {
    if (spec.mode === 'tools') throw new Error('Antigravity has no per-tool restrictions, so it can\'t run read-only tool agents like the daily brief.')
    const args = ['-p', spec.prompt, '--output-format', 'stream-json']
    const model = spec.model ?? spec.profile.model
    if (model) args.push('--model', model)
    if (spec.effort) args.push('--effort', spec.effort)
    if (spec.mode === 'edit') args.push('--mode', 'accept-edits')
    else args.push('--mode', 'plan', '--sandbox')
    if (spec.session?.resume) args.push('--conversation', spec.session.id)
    return { binary: 'agy', args, cwd: spec.cwd, output: 'stream' }
  },
  parse(ev): EngineEvent[] {
    const out: EngineEvent[] = []
    if (ev.event === 'init' && ev.init?.conversation_id) out.push({ type: 'session', id: String(ev.init.conversation_id) })
    if (ev.event === 'step_update') {
      const s = ev.step_update ?? {}
      if (s.state === 'ACTIVE' && s.step_type && !['user_input', 'agent_response'].includes(s.step_type)) out.push({ type: 'tool', name: String(s.step_type), target: '' })
    }
    if (ev.event === 'result') {
      const r = ev.result ?? {}
      if (r.conversation_id) out.push({ type: 'session', id: String(r.conversation_id) })
      if (r.usage) out.push({ type: 'usage', usage: { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens } })
      out.push({ type: 'done', text: String(r.response ?? '').trim(), isError: r.status !== 'SUCCESS' })
    }
    return out
  }
}
