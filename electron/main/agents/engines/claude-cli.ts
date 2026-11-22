import { CONTEXT_MODELS } from './models'
import type { Engine, EngineEvent } from './types'

const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep']
const NO_SHELL = ['Bash', 'WebFetch', 'WebSearch']
const READ_ONLY = ['Read', 'Glob', 'Grep']
const NO_WRITE = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']

/** Claude Code CLI. Claude can be restricted tool by tool, so every mode is enforced by flags, not by the prompt. */
export const claudeCli: Engine = {
  id: 'claude',
  chat: true,
  readsFiles: true,
  prepare(spec) {
    const model = spec.model ?? spec.profile.model ?? CONTEXT_MODELS.claude.model
    const effort = spec.effort ?? CONTEXT_MODELS.claude.effort
    const base = ['-p', spec.prompt, '--model', model, '--effort', effort, ...(spec.addDirs?.length ? ['--add-dir', ...spec.addDirs] : [])]
    // A chat keeps its session on disk so the next turn can resume it; every other run leaves nothing behind.
    const none = spec.session ? (spec.session.resume ? '--resume' : '--session-id') : '--no-session-persistence'
    const sessArgs = (rest: string[]) => (spec.session ? [...rest, none, spec.session.id] : [...rest, none])
    if (spec.mode === 'ask') return { binary: 'claude', args: sessArgs([...base, '--output-format', 'json', '--tools', '', '--strict-mcp-config']), cwd: spec.cwd, output: 'json' }
    if (spec.mode === 'read')
      return { binary: 'claude', args: sessArgs([...base, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...READ_ONLY, '--disallowedTools', ...NO_WRITE, '--strict-mcp-config']), cwd: spec.cwd, output: 'stream' }
    if (spec.mode === 'edit')
      return {
        binary: 'claude',
        args: sessArgs([...base, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...FILE_TOOLS, '--disallowedTools', ...NO_SHELL]),
        cwd: spec.cwd,
        output: 'stream'
      }
    return {
      binary: 'claude',
      args: sessArgs([...base, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...(spec.allowedTools ?? []), '--disallowedTools', ...(spec.disallowedTools ?? [])]),
      cwd: spec.cwd,
      output: 'stream'
    }
  },
  parse(ev): EngineEvent[] {
    const out: EngineEvent[] = []
    if (ev.type === 'assistant')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_use') out.push({ type: 'tool', name: String(c.name), target: String(c.input?.file_path ?? c.input?.pattern ?? '') })
    if (ev.type === 'rate_limit_event') {
      // utilization is a 0..1 fraction (checked against a heavily used account: 0.17 five-hour, 0.32 weekly).
      const w = ev.rate_limit_info?.unifiedWindows ?? {}
      const win = (x: any) => (x && typeof x.utilization === 'number' && x.resetsAt ? { usedPct: Math.round(x.utilization * 1000) / 10, resetsAt: new Date(x.resetsAt * 1000).toISOString() } : undefined)
      out.push({ type: 'limits', limits: { fiveHour: win(w.five_hour), weekly: win(w.seven_day) } })
    }
    if (ev.type === 'result') {
      const u = ev.usage
      if (u || ev.total_cost_usd != null) out.push({ type: 'usage', usage: { inputTokens: u?.input_tokens, outputTokens: u?.output_tokens, cacheReadTokens: u?.cache_read_input_tokens, cacheWriteTokens: u?.cache_creation_input_tokens, costUsd: ev.total_cost_usd } })
      out.push({ type: 'done', text: String(ev.result ?? ''), isError: Boolean(ev.is_error) })
    }
    return out
  }
}
