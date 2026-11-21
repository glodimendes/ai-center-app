import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import type { AccountProfile, LimitWindow, UsageTotal } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button } from '@/components/ui'
import { input } from './AreaSettings'

const DEFAULT_CEILING = 70

function Bar({ label, w, ceiling }: { label: string; w?: LimitWindow; ceiling: number }) {
  const live = w && Date.parse(w.resetsAt) > Date.now() ? w : undefined
  const pct = live?.usedPct ?? 0
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="w-14 text-muted">{label}</span>
      <div className="relative flex-1 h-2 rounded-full bg-sunken overflow-hidden">
        <div className={cx('h-full', pct >= ceiling ? 'bg-danger' : 'bg-accent')} style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-ink/50" style={{ left: `${ceiling}%` }} title={`Agents pause at ${ceiling}%`} />
      </div>
      <span className="w-40 text-right text-muted">
        {live ? `${Math.round(pct)}% · resets ${new Date(live.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : w ? 'reset since last seen' : 'not seen yet'}
      </span>
    </div>
  )
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

function Totals({ rows, names }: { rows: UsageTotal[]; names: Map<string, string> }) {
  if (!rows.length) return <div className="text-[11.5px] text-faint">No agent runs yet.</div>
  return (
    <table className="text-[11.5px] w-full">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.agentId}|${r.profile}`} className="border-t border-line first:border-0">
            <td className="py-1">{names.get(r.agentId) ?? r.agentId}</td>
            <td className="text-muted">{r.profile}</td>
            <td className="text-right text-muted">
              {r.runs} run{r.runs === 1 ? '' : 's'}
            </td>
            <td className="text-right text-muted">
              {fmt(r.inputTokens)} in · {fmt(r.outputTokens)} out
            </td>
            <td className="text-right text-muted w-16">{r.costUsd ? `$${r.costUsd.toFixed(2)}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Settings → Engines & accounts: the CLIs found, each account profile with its window usage, ceiling and a Test. */
export function EnginesSettings() {
  const a = useStore((st) => st.state)!.agents
  const toast = useStore((st) => st.toast)
  const [testing, setTesting] = useState<string | null>(null)
  const names = new Map(a.agents.map((g) => [g.id, g.name]))
  const save = (list: AccountProfile[]) => act(api.saveProfiles(list))
  const edit = (id: string, patch: Partial<AccountProfile>) => save(a.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const test = async (id: string) => {
    setTesting(id)
    try {
      const r = await api.testProfile(id)
      toast(r.message, r.ok ? 'info' : 'error')
    } finally {
      setTesting(null)
    }
  }
  const add = () => {
    let n = 2
    while (a.profiles.some((p) => p.id === `claude-${n}`)) n++
    save([...a.profiles, { id: `claude-${n}`, engine: 'claude', label: `Claude ${n}` }])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {a.cli.map((c) => (
          <span key={c.engine} title={c.path ?? c.error}>
            <b className="text-ink">{c.engine}</b> {c.version ?? <span className="text-danger">not found</span>}
          </span>
        ))}
        {!a.cli.length && <span>Looking for the CLIs…</span>}
      </div>

      {a.profiles.map((p) => {
        const lim = a.limits[p.id]
        const ceiling = p.sharePct ?? DEFAULT_CEILING
        const builtin = p.id === 'claude' || p.id === 'codex'
        return (
          <div key={p.id} className="border border-line rounded-lg p-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <input className={cx(input, 'w-40')} defaultValue={p.label} onBlur={(e) => e.target.value !== p.label && edit(p.id, { label: e.target.value.trim() || p.label })} title="Name shown in the app" />
              <code className="text-[11.5px] text-muted">{p.id}</code>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-sunken text-muted">{p.engine}</span>
              <div className="flex-1" />
              <Button onClick={() => test(p.id)} disabled={testing !== null} title="Checks the login and refreshes the window usage (Claude: one tiny cheapest-model call)">
                {testing === p.id && <Loader2 size={12} className="animate-spin" />} Test
              </Button>
              {!builtin && (
                <Button kind="ghost" title="Delete this profile" onClick={() => save(a.profiles.filter((x) => x.id !== p.id))}>
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] flex-wrap">
              <span className="text-muted">{p.engine === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'}</span>
              <input
                className={cx(input, 'flex-1 min-w-48 font-mono text-[11.5px]')}
                defaultValue={p.configDir ?? ''}
                placeholder="empty = the CLI's default login"
                onBlur={(e) => e.target.value.trim() !== (p.configDir ?? '') && edit(p.id, { configDir: e.target.value.trim() || undefined })}
              />
              <span className="text-muted">Agents pause at</span>
              <input className={cx(input, 'w-16')} type="number" min={1} max={100} defaultValue={ceiling} onBlur={(e) => Number(e.target.value) !== ceiling && edit(p.id, { sharePct: Number(e.target.value) })} />
              <span className="text-muted">% of the window</span>
            </div>
            <Bar label="5-hour" w={lim?.fiveHour} ceiling={ceiling} />
            <Bar label="Weekly" w={lim?.weekly} ceiling={ceiling} />
            <div className="text-[11px] text-faint">
              Estimates read from the {p.engine === 'claude' ? 'Claude CLI (updated after each agent run or Test)' : 'Codex session logs'}
              {lim ? `, last seen ${new Date(lim.asOf).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}` : ''}. The numbers cover the whole account, not only agents.
            </div>
          </div>
        )
      })}
      <Button onClick={add}>
        <Plus size={13} /> Add a Claude account
      </Button>

      <div>
        <h4 className="text-[12px] font-semibold mb-1">Agent usage today</h4>
        <Totals rows={a.totals.today} names={names} />
        <h4 className="text-[12px] font-semibold mt-3 mb-1">Last 7 days</h4>
        <Totals rows={a.totals.week} names={names} />
      </div>
    </div>
  )
}
