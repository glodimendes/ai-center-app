// Summarises the app's local usage log (speed and token use): node scripts/usage-report.mjs [days=7] [--packaged | --dir <app data folder>]
// Reads <app data>/metrics/*.jsonl (written by electron/main/metrics.ts: names, sizes, counts, durations; no text). Default: the dev app's folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 7)
const dirIdx = args.indexOf('--dir')
const base = dirIdx >= 0 ? args[dirIdx + 1] : join(homedir(), 'Library/Application Support', flag('--packaged') ? 'AI Center Planner' : 'ai-center-core-dev')
const dir = join(base, 'metrics')
if (!existsSync(dir)) {
  console.log(`No usage log in ${dir} yet. Run the app (it writes one line per event) and try again.`)
  process.exit(0)
}

const since = Date.now() - days * 86_400_000
const rows = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
  .flatMap((l) => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })
  .filter((r) => Date.parse(r.t) >= since)
const of = (ev) => rows.filter((r) => r.ev === ev)

const pct = (xs, p) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : undefined }
const sum = (xs) => xs.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
const ms = (x) => (x === undefined ? '-' : x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}ms`)
const num = (x) => (x === undefined ? '-' : Math.round(x).toLocaleString())
const group = (list, key) => { const m = new Map(); for (const r of list) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]) } return [...m] }
const table = (title, head, body) => {
  console.log(`\n## ${title}`)
  if (!body.length) return console.log('(nothing yet)')
  const all = [head, ...body]
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)))
  for (const r of all) console.log(r.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join('  '))
}

console.log(`Usage log: ${dir}\nLast ${days} day(s): ${rows.length} events`)

const start = of('startup')
table('Startup (ms since the main process loaded)', ['phase', 'runs', 'median', 'worst'], group(start, (r) => r.phase).map(([k, l]) => [k, l.length, ms(pct(l.map((r) => r.ms), 50)), ms(Math.max(...l.map((r) => r.ms)))]))

table('Calls from the UI (slowest by total time)', ['method', 'calls', 'p50', 'p95', 'total'], group(of('ipc'), (r) => r.method)
  .map(([k, l]) => [k, l.length, pct(l.map((r) => r.ms), 50), pct(l.map((r) => r.ms), 95), sum(l.map((r) => r.ms))])
  .sort((a, b) => b[4] - a[4]).slice(0, 12).map(([k, n, a, b, t]) => [k, n, ms(a), ms(b), ms(t)]))

const st = of('state')
table('State builds (every change re-plans and pushes)', ['step', 'p50', 'p95'], [['vault read', 'vaultMs'], ['plan', 'planMs'], ['agents etc.', 'restMs'], ['total', 'totalMs']].map(([n, k]) => [n, ms(pct(st.map((r) => r[k]), 50)), ms(pct(st.map((r) => r[k]), 95))]))
if (st.length) console.log(`${st.length} builds; ${num(pct(st.map((r) => r.tasks), 50))} tasks, ${num(pct(st.map((r) => r.blocks), 50))} blocks; state size ${num(pct(st.map((r) => r.kb), 50))} KB (sampled)`)

table('Calendar fetches', ['provider', 'fetches', 'p50', 'p95'], group(of('calendar'), (r) => r.provider).map(([k, l]) => [k, l.length, ms(pct(l.map((r) => r.ms), 50)), ms(pct(l.map((r) => r.ms), 95))]))

table('Screens opened', ['view', 'visits'], group(of('ui').filter((r) => r.kind === 'view'), (r) => r.name).map(([k, l]) => [k, l.length]).sort((a, b) => b[1] - a[1]))

const ai = of('ai')
table('AI calls by purpose and model', ['purpose / model', 'calls', 'prompt chars', 'in tok', 'out tok', 'cache read', 'cost $', 'p50', 'p95', '1st out p50', 'failed'],
  group(ai, (r) => `${String(r.purpose).replace(/^agent:.*/, 'agent:*')} / ${r.model ?? 'default'}`)
    .map(([k, l]) => {
      const input = sum(l.map((r) => r.inputTokens)) + sum(l.map((r) => r.cacheReadTokens)) + sum(l.map((r) => r.cacheWriteTokens))
      return [k, l.length, num(sum(l.map((r) => r.promptChars)) / l.length), num(sum(l.map((r) => r.inputTokens))), num(sum(l.map((r) => r.outputTokens))), input ? `${Math.round((100 * sum(l.map((r) => r.cacheReadTokens))) / input)}%` : '-', sum(l.map((r) => r.costUsd)).toFixed(3), ms(pct(l.map((r) => r.ms), 50)), ms(pct(l.map((r) => r.ms), 95)), ms(pct(l.map((r) => r.firstOutputMs), 50)), l.filter((r) => r.failed).length]
    })
    .sort((a, b) => Number(b[6]) - Number(a[6])))

table('Agent runs (queue wait vs running)', ['agent', 'runs', 'queue p50', 'queue p95', 'run p50', 'run p95', 'tool calls'], group(of('run'), (r) => r.agent)
  .map(([k, l]) => [k, l.length, ms(pct(l.map((r) => r.queueMs), 50)), ms(pct(l.map((r) => r.queueMs), 95)), ms(pct(l.map((r) => r.runMs), 50)), ms(pct(l.map((r) => r.runMs), 95)), num(sum(l.map((r) => r.tools)) / l.length)]))

const costs = ai.filter((r) => r.costUsd).sort((a, b) => b.costUsd - a.costUsd).slice(0, 5)
table('Five most expensive calls', ['when', 'purpose', 'model', 'cost $', 'out tok', 'prompt chars'], costs.map((r) => [r.t.slice(5, 16).replace('T', ' '), r.purpose, r.model ?? 'default', r.costUsd.toFixed(3), num(r.outputTokens), num(r.promptChars)]))
