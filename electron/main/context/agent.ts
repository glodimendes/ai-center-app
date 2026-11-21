import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ContextEngine } from '@shared/types'
import { isoDate } from '@shared/time'
import { ENGINES, EngineTimeout, runEngine } from '../agents/engines'
import { findProfile } from '../agents/profiles'

const TEXT_EXT = /\.(md|txt|ya?ml|json)$/i
const SKIP_DIR = /^(\.git|node_modules|dist|output|\.obsidian)$/

/** Text files in the vault, so an agent run can be diffed and undone exactly. */
export function snapshotVault(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        if (!SKIP_DIR.test(name)) walk(abs)
      } else if (TEXT_EXT.test(name) && st.size < 2_000_000) out.set(relative(root, abs), readFileSync(abs, 'utf8'))
    }
  }
  walk(root)
  return out
}

function prompt(instruction: string) {
  return `You are updating the user's AI Center knowledge base (the current directory). The user typed this instruction into their planner app's "Update context" box:

"""
${instruction}
"""

Today is ${isoDate(new Date())}.

Read 00_START_HERE.md, 03_Workflows/context-maintenance.md and 03_Workflows/assistant-file-update-rules.md first and follow them.
- Make the smallest targeted edits to the narrowest relevant files, and update "Last updated:" lines on files you change.
- Do not delete, move or rename files. Do not edit anything in 05_Tasks/weekly/ or 05_Tasks/planner/.
- If the instruction needs something those rules say requires confirmation, don't do it; say so in your summary instead.
- The user reviews a diff of your edits before they are kept.

Finish with a short plain-text summary (at most 5 bullets) of what you changed and why, naming the files.`
}

export interface AgentRun {
  done: Promise<string>
  cancel: () => void
}

const VERBS: Record<string, string> = { Read: 'Reading', Edit: 'Editing', Write: 'Writing', Glob: 'Looking for', Grep: 'Searching' }

/**
 * Runs the chosen CLI headlessly inside the vault. Claude gets file tools only (no shell, no web).
 * Codex has no switch to turn its shell off: it runs in its workspace-write sandbox, which keeps
 * writes inside the vault and has no network. Either way only text files are diffed and undoable.
 * Progress lines (e.g. "Editing 04_Context_Docs/current-priorities.md") are reported as they happen.
 */
export async function runContextAgent(engine: ContextEngine, vault: string, instruction: string, onProgress: (line: string) => void): Promise<AgentRun> {
  const profile = findProfile(engine)
  const rel = (p?: string) => (p ? relative(vault, p) || p : '')
  const run = await runEngine(ENGINES[profile.engine], {
    profile,
    mode: 'edit',
    prompt: prompt(instruction),
    cwd: vault,
    timeoutMs: 6 * 60_000,
    onEvent: (ev) => {
      if (ev.type === 'tool') onProgress(`${VERBS[ev.name] ?? ev.name} ${ev.name === 'Read' || ev.name === 'Edit' || ev.name === 'Write' ? rel(ev.target) : ev.target}`.trim())
      if (ev.type === 'file_change') onProgress(`Editing ${rel(ev.path)}`)
    }
  })
  const done = run.done.then(
    (r) => {
      if (r.code !== 0 && !r.text) throw new Error(r.stderr.trim().split('\n').slice(-3).join(' ') || `Exited with code ${r.code}.`)
      return r.text
    },
    (e) => {
      throw e instanceof EngineTimeout ? new Error('Stopped after 6 minutes without finishing. Nothing was kept.') : e
    }
  )
  return { done, cancel: run.cancel }
}
