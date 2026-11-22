import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTEXT_MODELS } from './models'
import type { Engine, EngineEvent } from './types'

/** Codex reports `primary` (300 min = 5 h) and `secondary` (10080 min = weekly) with used_percent and resets_at (epoch seconds). */
export function codexLimits(rl: any): { fiveHour?: { usedPct: number; resetsAt: string }; weekly?: { usedPct: number; resetsAt: string } } {
  const out: ReturnType<typeof codexLimits> = {}
  for (const w of [rl?.primary, rl?.secondary]) {
    if (!w || typeof w.used_percent !== 'number' || !w.resets_at) continue
    const win = { usedPct: w.used_percent, resetsAt: new Date(w.resets_at * 1000).toISOString() }
    if (w.window_minutes === 300) out.fiveHour = win
    else if (w.window_minutes === 10080) out.weekly = win
  }
  return out
}

/**
 * Codex CLI. It has no switch to turn its shell off, so the sandbox is the limit: `workspace-write` for edits
 * (writes stay inside the folder, no network) and `read-only` from an empty folder for answers.
 */
export const codexCli: Engine = {
  id: 'codex',
  chat: true,
  prepare(spec) {
    if (spec.mode === 'tools') throw new Error('Codex has no per-tool restrictions, so it can\'t run read-only tool agents like the daily brief.')
    const model = spec.model ?? spec.profile.model ?? CONTEXT_MODELS.codex.model
    const effort = spec.effort ?? CONTEXT_MODELS.codex.effort
    const dir = mkdtempSync(join(tmpdir(), 'planner-codex-'))
    const last = join(dir, 'last.txt')
    const edit = spec.mode === 'edit'
    // `read` looks at the vault but can't write (read-only sandbox); `ask` sees nothing.
    const cwd = edit || spec.mode === 'read' ? spec.cwd : dir
    const sandbox = edit ? 'workspace-write' : 'read-only'
    const common = ['-m', model, '-c', `model_reasoning_effort="${effort}"`, '--skip-git-repo-check']
    // A chat keeps its thread so the next turn can resume it. `exec resume` has no -s/-C: the sandbox goes in as config, the folder is the process cwd.
    const args = spec.session?.resume
      ? ['exec', 'resume', ...common, '-c', `sandbox_mode="${sandbox}"`, '--json', '-o', last, spec.session.id, spec.prompt]
      : ['exec', ...common, '-C', cwd, '-s', sandbox, ...(spec.session ? [] : ['--ephemeral']), ...(edit || spec.session ? ['--json'] : []), '-o', last, spec.prompt]
    return { binary: 'codex', args, cwd, output: edit || spec.session ? 'stream' : 'none', lastMessageFile: last, tempDir: dir }
  },
  parse(ev): EngineEvent[] {
    const out: EngineEvent[] = []
    if (ev.type === 'thread.started' && ev.thread_id) out.push({ type: 'session', id: String(ev.thread_id) })
    // With --json Codex reports failures (bad model, usage limit, login) on stdout, not stderr.
    if (ev.type === 'turn.failed' && ev.error?.message) out.push({ type: 'done', text: String(ev.error.message), isError: true })
    const item = ev.item ?? ev.msg
    if (item?.type === 'file_change') for (const ch of item.changes ?? []) out.push({ type: 'file_change', path: String(ch.path) })
    if (item?.type === 'agent_message' && item.text) out.push({ type: 'text', text: String(item.text) })
    if (item?.type === 'token_count' && item.rate_limits) out.push({ type: 'limits', limits: codexLimits(item.rate_limits) })
    if (item?.type === 'token_count' && item.info?.total_token_usage) {
      const u = item.info.total_token_usage
      out.push({ type: 'usage', usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens } })
    }
    return out
  }
}
