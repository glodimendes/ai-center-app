import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Limits, UsageTotal } from '@shared/agents'
import { codexLimits } from './engines/codex-cli'

/** Newest session files first, so the last rate-limit report is found without reading months of logs. */
function newestJsonl(dir: string, count: number): string[] {
  const out: { f: string; m: number }[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 4 || !existsSync(d)) return
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p, depth + 1)
      else if (name.endsWith('.jsonl')) out.push({ f: p, m: st.mtimeMs })
    }
  }
  walk(dir, 0)
  return out.sort((a, b) => b.m - a.m).slice(0, count).map((x) => x.f)
}

function tail(file: string, bytes: number): string {
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  try {
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Codex writes its 5-hour and weekly usage into every session log (token_count events); read the latest, read-only. */
export function readCodexLimits(codexHome: string): Limits | null {
  for (const f of newestJsonl(join(codexHome, 'sessions'), 6)) {
    const lines = tail(f, 2_000_000).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue
      try {
        const e = JSON.parse(lines[i])
        const rl = e.payload?.rate_limits
        const w = codexLimits(rl)
        if (rl && (w.fiveHour || w.weekly)) return { ...w, asOf: e.timestamp ?? new Date().toISOString() }
      } catch {
        /* a cut first line or noise */
      }
    }
  }
  return null
}

/** A window that has reset since we saw it is back to zero; we only know what the CLI last told us. */
export function currentWindows(l: Limits | null | undefined, now = Date.now()): { fiveHour?: number; weekly?: number } {
  const live = (w?: { usedPct: number; resetsAt: string }) => (w && Date.parse(w.resetsAt) > now ? w.usedPct : undefined)
  return { fiveHour: live(l?.fiveHour), weekly: live(l?.weekly) }
}

/** Why an agent run should pause, or null. The ceiling is a percent of the account's window (the whole account, not only agents). */
export function budgetPause(l: Limits | null | undefined, ceilingPct: number, label: string, now = Date.now()): string | null {
  const w = currentWindows(l, now)
  if (w.fiveHour !== undefined && w.fiveHour >= ceilingPct) return `${label}: the 5-hour window is ${Math.round(w.fiveHour)}% used (agents pause at ${ceilingPct}%).`
  if (w.weekly !== undefined && w.weekly >= ceilingPct) return `${label}: the weekly window is ${Math.round(w.weekly)}% used (agents pause at ${ceilingPct}%).`
  return null
}

export interface RunRow {
  t: number
  agentId: string
  profile: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** Finished runs from the supervisor's JSON-lines logs (`<logDir>/YYYY-MM/<id>.jsonl`) since a time. */
export function readRunRows(logDir: string, sinceMs: number): RunRow[] {
  const rows: RunRow[] = []
  if (!existsSync(logDir)) return rows
  const since = new Date(sinceMs)
  const firstMonth = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}`
  for (const month of readdirSync(logDir).filter((m) => m >= firstMonth).sort()) {
    for (const f of readdirSync(join(logDir, month))) {
      if (!f.endsWith('.jsonl')) continue
      for (const line of readFileSync(join(logDir, month, f), 'utf8').split('\n')) {
        if (!line.includes('"type":"end"')) continue
        try {
          const e = JSON.parse(line)
          const t = Date.parse(e.t)
          if (e.type !== 'end' || e.status !== 'done' || t < sinceMs) continue
          rows.push({ t, agentId: e.agent, profile: e.profile ?? '', inputTokens: e.usage?.inputTokens ?? 0, outputTokens: e.usage?.outputTokens ?? 0, costUsd: e.usage?.costUsd ?? 0 })
        } catch {
          /* skip a damaged line */
        }
      }
    }
  }
  return rows
}

export function totalsFor(rows: RunRow[]): UsageTotal[] {
  const map = new Map<string, UsageTotal>()
  for (const r of rows) {
    const k = `${r.agentId}|${r.profile}`
    const t = map.get(k) ?? { agentId: r.agentId, profile: r.profile, runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    t.runs++
    t.inputTokens += r.inputTokens
    t.outputTokens += r.outputTokens
    t.costUsd += r.costUsd
    map.set(k, t)
  }
  return [...map.values()].sort((a, b) => b.outputTokens + b.inputTokens - (a.outputTokens + a.inputTokens))
}

/** Today (local midnight) and the last 7 days. */
export function usageTotals(rows: RunRow[], now = new Date()): { today: UsageTotal[]; week: UsageTotal[] } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return { today: totalsFor(rows.filter((r) => r.t >= midnight)), week: totalsFor(rows.filter((r) => r.t >= now.getTime() - 7 * 86_400_000)) }
}
