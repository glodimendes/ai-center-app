import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { ContextEngine } from '@shared/types'
import { isoDate } from '@shared/time'

const run = promisify(execFile)

/** Cheapest models, chosen by the user for cost. Effort applies to this run only, not the global CLI config. */
export const CONTEXT_MODELS = {
  codex: { model: 'gpt-5.6-luna', effort: 'medium' },
  claude: { model: 'claude-haiku-5-5', effort: 'medium' }
} as const
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

/** The packaged app doesn't inherit the shell PATH, so ask a login shell where the CLI lives. */
export async function resolveBinary(name: string): Promise<string> {
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) if (existsSync(p)) return p
  const { stdout } = await run('/bin/zsh', ['-lc', `command -v ${name}`])
  const p = stdout.trim()
  if (!p) throw new Error(`Couldn't find the "${name}" command. Install it or switch the engine in Settings.`)
  return p
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

/**
 * Runs the chosen CLI headlessly inside the vault. Claude gets file tools only (no shell, no web).
 * Codex has no switch to turn its shell off: it runs in its workspace-write sandbox, which keeps
 * writes inside the vault and has no network. Either way only text files are diffed and undoable.
 * Progress lines (e.g. "Editing 04_Context_Docs/current-priorities.md") are reported as they happen.
 */
export async function runContextAgent(engine: ContextEngine, vault: string, instruction: string, onProgress: (line: string) => void): Promise<AgentRun> {
  let child: ChildProcess
  let lastMessage: string | null = null
  const rel = (p?: string) => (p ? relative(vault, p) || p : '')

  if (engine === 'codex') {
    const bin = await resolveBinary('codex')
    const outDir = mkdtempSync(join(tmpdir(), 'planner-codex-'))
    lastMessage = join(outDir, 'last.txt')
    child = spawn(bin, ['exec', '-m', CONTEXT_MODELS.codex.model, '-c', `model_reasoning_effort="${CONTEXT_MODELS.codex.effort}"`, '-C', vault, '-s', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '--json', '-o', lastMessage, prompt(instruction)], {
      cwd: vault,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    const bin = await resolveBinary('claude')
    child = spawn(
      bin,
      [
        '-p',
        prompt(instruction),
        '--model',
        CONTEXT_MODELS.claude.model,
        '--effort',
        CONTEXT_MODELS.claude.effort,
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        '--disallowedTools',
        'Bash',
        'WebFetch',
        'WebSearch',
        '--no-session-persistence'
      ],
      { cwd: vault, stdio: ['ignore', 'pipe', 'pipe'] }
    )
  }

  let buf = ''
  let result = ''
  let stderr = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line)
        // Claude Code stream-json
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content ?? []) {
            if (c.type === 'tool_use') {
              const target = rel(c.input?.file_path) || c.input?.pattern || ''
              const verb = { Read: 'Reading', Edit: 'Editing', Write: 'Writing', Glob: 'Looking for', Grep: 'Searching' }[c.name as string] ?? c.name
              onProgress(`${verb} ${target}`.trim())
            }
          }
        }
        if (ev.type === 'result') result = String(ev.result ?? '')
        // Codex --json
        const item = ev.item ?? ev.msg
        if (item?.type === 'file_change') for (const ch of item.changes ?? []) onProgress(`Editing ${rel(ch.path)}`)
        if (item?.type === 'agent_message' && item.text) result = item.text
      } catch {
        /* non-JSON noise */
      }
    }
  })
  child.stderr!.on('data', (c: Buffer) => (stderr += c.toString()))

  const done = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGTERM'), 6 * 60_000)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (lastMessage && existsSync(lastMessage)) {
        result = readFileSync(lastMessage, 'utf8').trim() || result
        rmSync(join(lastMessage, '..'), { recursive: true, force: true })
      }
      if (signal) return reject(new Error('Cancelled.'))
      if (code !== 0 && !result) return reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `Exited with code ${code}.`))
      resolve(result.trim())
    })
  })
  return { done, cancel: () => child.kill('SIGTERM') }
}
