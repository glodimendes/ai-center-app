import { useState } from 'react'
import { Bot, Check, Pause, ChevronDown, ChevronRight, Loader2, Pencil, Play, Plus, Square, Trash2, Undo2, X } from 'lucide-react'
import type { AgentDef, AgentOutput, Permission, Run } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { ChangesList } from '@/components/ChangesList'
import { Button, Empty, Header, Modal } from '@/components/ui'

const PERMISSION_HELP: Record<Permission, string> = {
  read: 'Reads files, answers only. Changes nothing.',
  propose: 'Edits files; you review the diff and Keep or Undo.',
  act: 'Like propose, and adds tasks without a click. Completing, sending and calendar changes still need your OK.'
}
const OUTPUTS: AgentOutput[] = ['reply', 'file', 'suggestions', 'actions']
const badge = {
  read: 'bg-sunken text-muted',
  propose: 'bg-warn-soft text-warn',
  act: 'bg-danger/10 text-danger'
} as const

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

const blank = (): AgentDef => ({ id: '', name: '', profile: 'claude', permission: 'read', sources: [], triggers: ['manual'], output: 'reply', instructions: '' })

export function Agents() {
  const s = useStore((st) => st.state)!
  const toast = useStore((st) => st.toast)
  const a = s.agents
  const [editing, setEditing] = useState<AgentDef | null>(null)
  const [running, setRunning] = useState<AgentDef | null>(null)
  const pending = a.approvals.filter((x) => x.status === 'pending')
  const runsFor = (id: string) => a.runs.filter((r) => r.agentId === id).slice(-1)[0]

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Agents" sub={`${a.agents.length} agents · definitions in ${a.dir}`}>
        <Button kind="primary" onClick={() => setEditing(blank())}>
          <Plus size={13} /> New agent
        </Button>
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 @max-3xl:px-3 py-5 space-y-6">
          {a.runs
            .filter((r) => r.status === 'paused')
            .map((r) => (
              <section key={r.id} className="border border-warn/40 rounded-lg bg-panel p-3">
                <div className="text-[13px] font-medium">“{r.agentName}” is paused</div>
                <div className="text-[12px] text-muted mt-0.5">{r.pauseReason}</div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button kind="ghost" onClick={() => act(api.cancelRun(r.id))}>
                    Skip this run
                  </Button>
                  <Button onClick={() => act(api.allowRun(r.id, true))} title="Lifts this account's ceiling by 20 points">
                    Allow and raise ceiling
                  </Button>
                  <Button kind="primary" onClick={() => act(api.allowRun(r.id, false))}>
                    Allow once
                  </Button>
                </div>
              </section>
            ))}
          {a.review && <Review />}
          {pending.length > 0 && (
            <section>
              <h2 className="text-[12px] font-semibold text-muted uppercase tracking-wide mb-2">Waiting for your OK ({pending.length})</h2>
              {pending.map((x) => (
                <div key={x.id} className="border border-line rounded-lg p-3 mb-2 bg-panel">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium">{x.title}</div>
                      <div className="text-[11.5px] text-muted">
                        {x.kind} · from {a.agents.find((g) => g.id === x.agentId)?.name ?? x.agentId}
                      </div>
                      {Object.keys(x.payload).length > 0 && <pre className="mt-1 text-[11px] text-muted whitespace-pre-wrap font-mono">{JSON.stringify(x.payload, null, 1)}</pre>}
                    </div>
                    <Button kind="ghost" onClick={() => act(api.rejectAction(x.id))}>
                      <X size={13} /> Reject
                    </Button>
                    <Button
                      kind="primary"
                      onClick={() =>
                        act(api.approveAction(x.id).then((r) => r.status === 'failed' && toast(r.error ?? 'Failed', 'error')))
                      }
                    >
                      <Check size={13} /> Approve
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
          {a.errors.map((e) => (
            <div key={e.id} className="text-[12px] text-danger bg-danger/10 rounded-md px-3 py-2">
              {e.id}.md can't be read: {e.message}
            </div>
          ))}
          <section className="space-y-2">
            {a.agents.map((g) => {
              const last = runsFor(g.id)
              return (
                <div key={g.id} className="border border-line rounded-lg bg-panel p-3">
                  <div className="flex items-center gap-2">
                    <Bot size={15} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium">{g.name}</span>
                        <span className={cx('text-[10.5px] px-1.5 py-0.5 rounded', badge[g.permission])} title={PERMISSION_HELP[g.permission]}>
                          {g.permission}
                        </span>
                        <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-sunken text-muted">
                          {a.profiles.find((p) => p.id === g.profile)?.label ?? g.profile}
                          {g.model ? ` · ${g.model}` : ''}
                        </span>
                        {g.builtin && <span className="text-[10.5px] text-faint">built-in</span>}
                      </div>
                      <div className="text-[11.5px] text-muted truncate">
                        {g.description ?? g.instructions.split('\n')[0]} · triggers: {g.triggers.join(', ')}
                        {last && ` · last run ${when(last.endedAt ?? last.queuedAt)} (${last.status})`}
                      </div>
                    </div>
                    {!g.builtin && (
                      <>
                        <Button kind="ghost" title="Edit" onClick={() => setEditing(g)}>
                          <Pencil size={13} />
                        </Button>
                      </>
                    )}
                    <Button kind="default" onClick={() => (g.builtin ? act(api.runAgent(g.id, '')) : setRunning(g))} title={g.builtin && g.id !== 'daily-brief' ? 'Runs from its own place in the app' : 'Run now'}>
                      <Play size={12} /> Run now
                    </Button>
                  </div>
                </div>
              )
            })}
            {!a.agents.some((g) => !g.builtin) && <Empty>No custom agents yet. “New agent” writes a Markdown file into the folder above.</Empty>}
            {a.samples.some((x) => !x.added) && (
              <div className="pt-2">
                <h2 className="text-[12px] font-semibold text-muted uppercase tracking-wide mb-2">Sample agents</h2>
                {a.samples
                  .filter((x) => !x.added)
                  .map((x) => (
                    <div key={x.id} className="flex items-center gap-3 border border-dashed border-line rounded-lg p-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium">{x.name}</div>
                        <div className="text-[11.5px] text-muted">{x.description}</div>
                        {x.needs && <div className="text-[11px] text-warn mt-0.5">Needs {x.needs}</div>}
                      </div>
                      <Button onClick={() => act(api.addSampleAgent(x.id), `${x.name} added. Edit it any time.`)}>
                        <Plus size={13} /> Add
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </section>
          <History runs={a.runs} />
        </div>
      </div>
      {editing && <Editor def={editing} onClose={() => setEditing(null)} />}
      {running && <RunDialog def={running} onClose={() => setRunning(null)} />}
    </div>
  )
}

function Review() {
  const r = useStore((st) => st.state)!.agents.review!
  const toast = useStore((st) => st.toast)
  return (
    <section className="border border-warn/40 rounded-lg bg-panel">
      <div className="p-3 border-b border-line">
        <div className="text-[13px] font-medium">Review changes{r.instruction.trim() ? ` from “${r.instruction.slice(0, 60)}”` : ''}</div>
        <div className="text-[12px] text-muted whitespace-pre-wrap mt-1">{r.summary || 'Done.'}</div>
      </div>
      <div className="p-3">
        <ChangesList changes={r.changes} />
      </div>
      <div className="p-3 border-t border-line flex justify-end gap-2">
        <Button
          kind="ghost"
          onClick={async () => {
            const skipped = await api.contextUndo()
            toast(skipped.length ? `Undone, except ${skipped.join(', ')} (changed since).` : 'Changes undone.')
          }}
        >
          <Undo2 size={13} /> Undo all
        </Button>
        <Button kind="primary" onClick={() => act(api.contextKeep())}>
          <Check size={13} /> Keep changes
        </Button>
      </div>
    </section>
  )
}

function History({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = [...runs].reverse()
  if (!list.length) return null
  return (
    <section>
      <h2 className="text-[12px] font-semibold text-muted uppercase tracking-wide mb-2">Runs</h2>
      {list.map((r) => (
        <div key={r.id} className="border border-line rounded-md mb-1.5 bg-panel">
          <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-left">
            {open === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {r.status === 'running' && <Loader2 size={12} className="animate-spin text-accent" />}
            {r.status === 'paused' && <Pause size={12} className="text-warn" />}
            <span className="font-medium">{r.agentName}</span>
            <span className="flex-1 truncate text-muted">{r.input.text}</span>
            <span className={cx('text-[11px]', r.status === 'error' ? 'text-danger' : r.status === 'done' ? 'text-ok' : 'text-muted')}>{r.status}</span>
            <span className="text-[11px] text-faint">{when(r.queuedAt)}</span>
            {(r.status === 'running' || r.status === 'queued' || r.status === 'paused') && (
              <span
                role="button"
                title="Cancel"
                onClick={(e) => (e.stopPropagation(), act(api.cancelRun(r.id)))}
                className="text-muted hover:text-danger"
              >
                <Square size={12} />
              </span>
            )}
          </button>
          {open === r.id && (
            <div className="px-3 pb-3 text-[12px] space-y-2">
              {r.error && <div className="text-danger">{r.error}</div>}
              {r.output?.text && <div className="whitespace-pre-wrap leading-relaxed">{r.output.text}</div>}
              {r.outputFile && <div className="text-muted">Saved to {r.outputFile}</div>}
              {r.progress.length > 0 && <div className="font-mono text-[11px] text-muted max-h-32 overflow-y-auto">{r.progress.map((p, i) => <div key={i}>{p}</div>)}</div>}
              {r.usage && <div className="text-[11px] text-faint">{[r.usage.inputTokens && `${r.usage.inputTokens} in`, r.usage.outputTokens && `${r.usage.outputTokens} out`, r.usage.costUsd && `$${r.usage.costUsd.toFixed(3)}`].filter(Boolean).join(' · ')}</div>}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function RunDialog({ def, onClose }: { def: AgentDef; onClose: () => void }) {
  const [text, setText] = useState('')
  const go = async () => {
    await act(api.runAgent(def.id, text.trim()))
    onClose()
  }
  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <h2 className="text-[15px] font-semibold">Run “{def.name}”</h2>
        <p className="text-[12px] text-muted mt-1">{PERMISSION_HELP[def.permission]} A second run waits until the first has finished.</p>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.metaKey && go()} rows={4} placeholder="Optional input for this run…" className="mt-3 w-full px-3 py-2 rounded-lg border border-line bg-bg text-[13px] outline-none focus:border-accent resize-none" />
        <div className="flex justify-end gap-2 mt-3">
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" onClick={go}>
            <Play size={12} /> Run ⌘↵
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Editor({ def, onClose }: { def: AgentDef; onClose: () => void }) {
  const isNew = !def.id
  const profiles = useStore((st) => st.state)!.agents.profiles
  const [d, setD] = useState(def)
  const [error, setError] = useState('')
  const set = (p: Partial<AgentDef>) => setD({ ...d, ...p })
  const input = 'h-8 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const save = async () => {
    try {
      await api.saveAgent({ ...d, id: isNew ? slug(d.name) : d.id, name: d.name.trim() || d.id })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="p-5 space-y-3">
        <h2 className="text-[15px] font-semibold">{isNew ? 'New agent' : `Edit ${def.name}`}</h2>
        <div className="grid grid-cols-2 gap-3 @max-3xl:grid-cols-1 text-[12px]">
          <label className="flex flex-col gap-1">
            Name
            <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            Account
            <select className={input} value={d.profile} onChange={(e) => set({ profile: e.target.value })}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Permission
            <select className={input} value={d.permission} onChange={(e) => set({ permission: e.target.value as Permission })}>
              {(['read', 'propose', 'act'] as const).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <span className="text-faint">{PERMISSION_HELP[d.permission]}</span>
          </label>
          <label className="flex flex-col gap-1">
            Output
            <select className={input} value={d.output} onChange={(e) => set({ output: e.target.value as AgentOutput })}>
              {OUTPUTS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <span className="text-faint">file: saved under 05_Tasks/agent-output · suggestions/actions: proposals wait for your OK</span>
          </label>
          <label className="flex flex-col gap-1">
            Model (empty = the cheap default)
            <input className={input} value={d.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })} placeholder="e.g. claude-sonnet-5-5" />
          </label>
          <label className="flex flex-col gap-1">
            Folder in the vault (empty = whole vault)
            <input className={input} value={d.workdir ?? ''} onChange={(e) => set({ workdir: e.target.value || undefined })} placeholder="e.g. 02_Projects" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12px]">
          Instructions
          <textarea value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={9} className="px-3 py-2 rounded-lg border border-line bg-bg text-[13px] leading-relaxed outline-none focus:border-accent font-mono" />
        </label>
        {error && <div className="text-danger text-[12px]">{error}</div>}
        <div className="flex justify-between">
          {!isNew ? (
            <Button
              kind="danger"
              onClick={async () => {
                if (!confirm(`Delete ${def.name}? Its file is removed.`)) return
                await act(api.deleteAgent(def.id))
                onClose()
              }}
            >
              <Trash2 size={13} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={save} disabled={!d.name.trim() || !d.instructions.trim()}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
