import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTEXT_MODELS } from './models'
import type { Engine, EngineEvent } from './types'

/**
 * Codex CLI. It has no switch to turn its shell off, so the sandbox is the limit: `workspace-write` for edits
 * (writes stay inside the folder, no network) and `read-only` from an empty folder for answers.
 */
export const codexCli: Engine = {
  id: 'codex',
  prepare(spec) {
    if (spec.mode === 'tools') throw new Error('Codex has no per-tool restrictions, so it can\'t run read-only tool agents like the daily brief.')
    const { model, effort } = CONTEXT_MODELS.codex
    const dir = mkdtempSync(join(tmpdir(), 'planner-codex-'))
    const last = join(dir, 'last.txt')
    const edit = spec.mode === 'edit'
    const cwd = edit ? spec.cwd : dir
    const args = ['exec', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-C', cwd, '-s', edit ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '--ephemeral', ...(edit ? ['--json'] : []), '-o', last, spec.prompt]
    return { binary: 'codex', args, cwd, output: edit ? 'stream' : 'none', lastMessageFile: last, tempDir: dir }
  },
  parse(ev): EngineEvent[] {
    const out: EngineEvent[] = []
    const item = ev.item ?? ev.msg
    if (item?.type === 'file_change') for (const ch of item.changes ?? []) out.push({ type: 'file_change', path: String(ch.path) })
    if (item?.type === 'agent_message' && item.text) out.push({ type: 'text', text: String(item.text) })
    if (item?.type === 'token_count' && item.info?.total_token_usage) {
      const u = item.info.total_token_usage
      out.push({ type: 'usage', usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens } })
    }
    return out
  }
}
