// Rebuilds recent runs from the supervisor's JSON-lines logs, so the history survives a restart. No Electron imports.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Run } from '@shared/agents'

const MAX_FILES = 400
const MAX_PROGRESS = 200

/** One log file (`<id>.jsonl`) back into a Run; null when it has no readable `queued` event. A run with no `end` was cut off by the app closing. */
export function runFromLog(id: string, text: string): Run | null {
  let run: Run | null = null
  let last = ''
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    last = e.t ?? last
    if (e.type === 'queued') {
      if (!e.input) continue
      run = {
        id,
        agentId: String(e.agent ?? ''),
        // Logs from before these fields existed fall back to the agent id.
        agentName: e.agentName ?? String(e.agent ?? ''),
        profile: e.profile ?? '',
        input: e.input,
        status: 'queued',
        queuedAt: e.queuedAt ?? e.t,
        progress: [],
        chat: e.chat || undefined,
        chainId: e.chainId,
        hops: e.hops,
        parentRunId: e.parentRunId
      }
    } else if (!run) continue
    else if (e.type === 'start') ((run.status = 'running'), (run.startedAt = e.t))
    else if (e.type === 'paused') run.status = 'paused'
    else if (e.type === 'progress' && typeof e.line === 'string') run.progress = [...run.progress, e.line].slice(-MAX_PROGRESS)
    else if (e.type === 'end') {
      run.status = e.status
      run.error = e.error
      run.output = e.output
      run.usage = e.usage
      run.outputFile = e.outputFile
      run.endedAt = e.t
    }
  }
  if (run && !['done', 'error', 'cancelled'].includes(run.status)) {
    run.status = 'cancelled'
    run.error = 'Interrupted when the app closed.'
    run.endedAt = last || run.queuedAt
  }
  return run
}

/** The newest `limit` runs from `<logDir>/YYYY-MM/<id>.jsonl`, oldest first. Reads at most MAX_FILES files, newest first. */
export function loadHistory(logDir: string, limit = 100): Run[] {
  if (!existsSync(logDir)) return []
  const runs: Run[] = []
  let files = 0
  for (const month of readdirSync(logDir).sort().reverse()) {
    let names: string[]
    try {
      names = readdirSync(join(logDir, month)).filter((f) => f.endsWith('.jsonl')).sort().reverse()
    } catch {
      continue
    }
    for (const f of names) {
      if (runs.length >= limit || files >= MAX_FILES) return runs.sort(byQueued)
      files++
      try {
        const run = runFromLog(basename(f, '.jsonl'), readFileSync(join(logDir, month, f), 'utf8'))
        if (run) runs.push(run)
      } catch {
        /* an unreadable file is skipped */
      }
    }
  }
  return runs.sort(byQueued)
}

const byQueued = (a: Run, b: Run) => a.queuedAt.localeCompare(b.queuedAt)
