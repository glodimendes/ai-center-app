// Engine layer of the AI Center core. No Electron or UI imports: it must run headless later.

import type { AccountProfile, EngineId, Usage } from '@shared/agents'
export type { AccountProfile, EngineId, Usage }

/** What an engine reports while running, whatever the CLI's own format. */
export type EngineEvent =
  | { type: 'tool'; name: string; target: string }
  | { type: 'file_change'; path: string }
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; text: string; isError: boolean }

/**
 * `edit`: file tools inside `cwd`, edits allowed (Update context).
 * `tools`: only the listed tools, read-only in practice (daily brief).
 * `read`: may read files in `cwd`, nothing else, nothing written (custom agents with permission `read`).
 * `ask`: no tools, answer only (one-shot JSON questions).
 */
export type RunMode = 'edit' | 'tools' | 'read' | 'ask'

export interface RunSpec {
  profile: AccountProfile
  mode: RunMode
  prompt: string
  /** Per-run override; unset = the cheap built-in default (CONTEXT_MODELS). */
  model?: string
  effort?: string
  /** Where the CLI runs. `ask` ignores it for Codex and uses an empty temp folder. */
  cwd: string
  allowedTools?: string[]
  disallowedTools?: string[]
  timeoutMs: number
  onEvent?: (ev: EngineEvent) => void
}

export interface RunResult {
  /** The final answer text. */
  text: string
  /** The CLI itself said the run failed (Claude `is_error`). */
  isError: boolean
  usage?: Usage
  code: number | null
  stderr: string
}

export interface EngineRun {
  done: Promise<RunResult>
  cancel: () => void
}

/** What an engine adapter provides: the command line and how to read its output. */
export interface Prepared {
  binary: string
  args: string[]
  cwd: string
  /** `stream`: one JSON event per line. `json`: stdout is a single JSON document. `none`: ignore stdout. */
  output: 'stream' | 'json' | 'none'
  /** The final message is written here instead (Codex `-o`). */
  lastMessageFile?: string
  /** Temp folder to delete after the run. */
  tempDir?: string
}

export interface Engine {
  id: EngineId
  prepare(spec: RunSpec): Prepared
  /** One parsed JSON event → normalized events. */
  parse(ev: any): EngineEvent[]
}
