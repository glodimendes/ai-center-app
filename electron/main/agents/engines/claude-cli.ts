import { CONTEXT_MODELS } from './models'
import type { Engine, EngineEvent } from './types'

const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep']
const NO_SHELL = ['Bash', 'WebFetch', 'WebSearch']

/** Claude Code CLI. Claude can be restricted tool by tool, so every mode is enforced by flags, not by the prompt. */
export const claudeCli: Engine = {
  id: 'claude',
  prepare(spec) {
    const { model, effort } = CONTEXT_MODELS.claude
    const base = ['-p', spec.prompt, '--model', model, '--effort', effort]
    const none = '--no-session-persistence'
    if (spec.mode === 'ask') return { binary: 'claude', args: [...base, '--output-format', 'json', '--tools', '', '--strict-mcp-config', none], cwd: spec.cwd, output: 'json' }
    if (spec.mode === 'edit')
      return {
        binary: 'claude',
        args: [...base, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...FILE_TOOLS, '--disallowedTools', ...NO_SHELL, none],
        cwd: spec.cwd,
        output: 'stream'
      }
    return {
      binary: 'claude',
      args: [...base, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...(spec.allowedTools ?? []), '--disallowedTools', ...(spec.disallowedTools ?? []), none],
      cwd: spec.cwd,
      output: 'stream'
    }
  },
  parse(ev): EngineEvent[] {
    const out: EngineEvent[] = []
    if (ev.type === 'assistant')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_use') out.push({ type: 'tool', name: String(c.name), target: String(c.input?.file_path ?? c.input?.pattern ?? '') })
    if (ev.type === 'result') {
      const u = ev.usage
      if (u || ev.total_cost_usd != null) out.push({ type: 'usage', usage: { inputTokens: u?.input_tokens, outputTokens: u?.output_tokens, costUsd: ev.total_cost_usd } })
      out.push({ type: 'done', text: String(ev.result ?? ''), isError: Boolean(ev.is_error) })
    }
    return out
  }
}
