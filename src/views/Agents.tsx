import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FileInput, Loader2, MessageSquare, Pencil, Pin, PinOff, Plus, Square, Trash2 } from 'lucide-react'
import type { AgentDef, AgentOutput, FoundAgent, Permission, Run } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { groupChains } from '@shared/chains'
import { TASKS_DIR } from '@shared/paths'
import { groupSections } from '@/lib/agentGroups'
import { Goals } from '@/components/Goals'
import { ApprovalCard, PausedCard, ReviewCard } from '@/components/Inline'
import { Button, Header, Modal } from '@/components/ui'

const PERMISSION_HELP: Record<Permission, string> = {
  read: 'Reads files and answers. Changes nothing.',
  propose: 'Edits files; you review the changes and keep or undo them.',
  act: 'Like propose, and adds tasks on its own. Everything else still needs your OK.'
}
const OUTPUT_HELP: Record<AgentOutput, string> = {
  reply: 'Shows the answer',
  file: 'Saves the answer as a file in your vault',
  suggestions: 'Proposes things for you to approve',
  actions: 'Proposes actions for you to approve'
}
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const blank = (): AgentDef => ({ id: '', name: '', profile: 'claude', permission: 'read', sources: [], triggers: ['manual'], output: 'reply', instructions: '' })

/** Agents: see, create and edit them. Talking to them happens in Chat; what they did and what waits for you is under Activity. */
export function Agents() {
  const s = useStore((st) => st.state)!
  const openChat = useStore((st) => st.openChat)
  const a = s.agents
  const [tab, setTab] = useState<'agents' | 'activity'>('agents')
  const [editing, setEditing] = useState<AgentDef | null>(null)
  const [examples, setExamples] = useState(false)
  const custom = a.agents.filter((g) => !g.builtin)
  const builtin = a.agents.filter((g) => g.builtin)
  const waiting = a.approvals.filter((x) => x.status === 'pending').length + a.runs.filter((r) => r.status === 'paused').length + (a.review ? 1 : 0)
  const label = (g: AgentDef) => [a.profiles.find((p) => p.id === g.profile)?.label ?? g.profile, g.permission].join(' · ')

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Agents">
        <div className="flex rounded-full bg-sunken p-0.5 text-[12.5px]">
          {(['agents', 'activity'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx('px-3.5 h-7 rounded-full capitalize', tab === t ? 'bg-panel shadow-sm font-medium' : 'text-muted')}>
              {t}
              {t === 'activity' && waiting > 0 && <span className="ml-1.5 text-warn">{waiting}</span>}
            </button>
          ))}
        </div>
        <Button kind="primary" onClick={() => setEditing(blank())}>
          <Plus size={13} /> New agent
        </Button>
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[44rem] mx-auto px-6 py-8 space-y-8">
          {a.errors.map((e) => (
            <div key={e.id} className="text-[13px] text-danger">
              {e.id}.md can't be read: {e.message}
            </div>
          ))}

          {tab === 'agents' && (
            <>
              {a.found.length > 0 && <Found found={a.found} />}
              {custom.length > 0 ? (
                groupSections(custom, a.organization).map((sec) => (
                  <section key={sec.name || '_none'}>
                    {a.organization.groups.length > 0 && (
                      <div className="flex items-center gap-1 mb-2 text-[12px] text-faint">
                        <span className="flex-1">{sec.name || 'No group'}</span>
                        {sec.name && a.organization.groups.length > 1 && (
                          <>
                            <button title="Move group up" onClick={() => act(api.organizeAgents({ kind: 'move-group', group: sec.name, dir: -1 }))} className="p-1 rounded hover:text-ink">
                              <ArrowUp size={12} />
                            </button>
                            <button title="Move group down" onClick={() => act(api.organizeAgents({ kind: 'move-group', group: sec.name, dir: 1 }))} className="p-1 rounded hover:text-ink">
                              <ArrowDown size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className="rounded-2xl border border-line bg-panel divide-y divide-line/70 overflow-hidden">
                      {sec.list.map((g) => {
                        const pinned = a.organization.pinned.includes(g.id)
                        return (
                          <div key={g.id} className="flex items-center gap-3 px-5 py-4">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing(g)}>
                              <div className="text-[15px] font-medium truncate">{g.name}</div>
                              <div className="text-[13px] text-muted truncate">{g.description ?? g.instructions.split('\n')[0]}</div>
                            </div>
                            <div className="text-[12px] text-faint shrink-0 @max-3xl:hidden">{label(g)}</div>
                            <GroupPicker id={g.id} current={a.organization.group[g.id] ?? ''} groups={a.organization.groups} />
                            <button
                              onClick={() => act(api.organizeAgents({ kind: 'pin', id: g.id, pinned: !pinned }))}
                              title={pinned ? 'Pinned to Chat: click to remove it from the Chat list' : 'Not in the Chat list: click to pin it'}
                              className={cx('p-2 rounded-lg hover:bg-sunken', pinned ? 'text-accent' : 'text-faint hover:text-ink')}
                            >
                              {pinned ? <Pin size={15} /> : <PinOff size={15} />}
                            </button>
                            <button onClick={() => setEditing(g)} title="Edit" className="p-2 rounded-lg text-faint hover:text-ink hover:bg-sunken">
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => openChat(g.id)} title="Chat" className="p-2 rounded-lg text-faint hover:text-accent hover:bg-sunken">
                              <MessageSquare size={15} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))
              ) : (
                <div className="text-center pt-10">
                  <h2 className="text-[20px] font-semibold">Define your first agent</h2>
                  <p className="mt-2 text-[14px] text-muted max-w-md mx-auto">An agent is a set of instructions that runs on an AI account you already have. Describe what it should do and what it may touch, then chat with it.</p>
                  <div className="mt-5 flex justify-center gap-2">
                    <Button kind="primary" onClick={() => setEditing(blank())}>
                      <Plus size={13} /> New agent
                    </Button>
                    <Button onClick={() => setExamples(true)}>Start from an example</Button>
                  </div>
                </div>
              )}
              {custom.length > 0 && a.samples.some((x) => !x.added) && (
                <button onClick={() => setExamples(true)} className="text-[13px] text-muted hover:text-ink">
                  + Add from examples
                </button>
              )}
              {a.ignored.length > 0 && <Ignored files={a.ignored} />}
              <div>
                <div className="text-[12px] text-faint mb-2">Built in</div>
                <div className="rounded-2xl border border-line/70 divide-y divide-line/60 overflow-hidden">
                  {builtin.map((g) => (
                    <div key={g.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px]">{g.name}</div>
                        <div className="text-[12.5px] text-muted truncate">{g.description}</div>
                      </div>
                      {g.id === 'daily-brief' && (
                        <Button onClick={() => act(api.runAgent(g.id, ''))} title="Generate today's brief now">
                          Run
                        </Button>
                      )}
                      {g.id === 'update-context' && <span className="text-[12px] text-faint">⌘U</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'activity' && <Activity />}
        </div>
      </div>
      {editing && <Editor def={editing} onClose={() => setEditing(null)} />}
      {examples && <Examples onClose={() => setExamples(false)} />}
    </div>
  )
}

function GroupPicker({ id, current, groups }: { id: string; current: string; groups: string[] }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const set = (group: string) => act(api.organizeAgents({ kind: 'group', id, group }))
  if (adding)
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() && set(name), setAdding(false), setName(''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') (setName(''), setAdding(false))
        }}
        placeholder="New group"
        className="w-28 h-7 px-2 rounded-lg border border-line bg-bg text-[12px] outline-none focus:border-accent"
      />
    )
  return (
    <select
      value={current}
      title="Group"
      onChange={(e) => (e.target.value === '__new' ? setAdding(true) : set(e.target.value))}
      className="h-7 max-w-28 px-1.5 rounded-lg border border-line/70 bg-bg text-[12px] text-muted outline-none @max-3xl:hidden"
    >
      <option value="">No group</option>
      {groups.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
      <option value="__new">New group…</option>
    </select>
  )
}

/** Files another tool put into the agents folder: not agents until imported. */
function Found({ found }: { found: FoundAgent[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="rounded-2xl border border-warn/40 bg-warn-soft/40 p-4 space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold flex items-center gap-2">
          <FileInput size={15} className="text-warn" /> Found in your agents folder
        </h2>
        <p className="text-[12.5px] text-muted mt-0.5">These files weren't made in AI Center (another tool may have written them). They don't run, chat or get handoffs until you import them. Importing keeps the app's rules: an imported agent starts read-only unless its file says otherwise in the app's format.</p>
      </div>
      {found.map((f) => (
        <div key={f.file} className="rounded-xl bg-panel border border-line/70 px-4 py-3 text-[13px]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {f.def?.name ?? f.file} <span className="text-faint font-normal">· {f.file}</span>
              </div>
              {f.def?.description && <div className="text-muted truncate">{f.def.description}</div>}
              {f.def && (
                <div className="text-[12px] text-faint mt-0.5">
                  Imports as: {f.def.permission} · {OUTPUT_HELP[f.def.output].toLowerCase()} · account {f.def.profile}
                  {f.def.model ? ` · model ${f.def.model}` : ''}
                </div>
              )}
              {f.error && <div className="text-danger mt-0.5">Can't be imported: {f.error}</div>}
              {f.notes.map((n) => (
                <div key={n} className="text-[12px] text-muted mt-0.5">
                  {n}
                </div>
              ))}
              {f.def && (
                <button onClick={() => setOpen(open === f.file ? null : f.file)} className="text-[12px] text-accent mt-1">
                  {open === f.file ? 'Hide instructions' : 'Show instructions'}
                </button>
              )}
              {open === f.file && f.def && <pre className="mt-2 text-[11.5px] bg-sunken rounded-md p-2 max-h-48 overflow-auto whitespace-pre-wrap">{f.def.instructions}</pre>}
            </div>
            <div className="flex gap-1.5 shrink-0">
              {f.def && <Button onClick={() => act(api.organizeAgents({ kind: 'import', file: f.file }), `${f.def!.name} imported`)}>Import</Button>}
              <Button kind="ghost" onClick={() => act(api.organizeAgents({ kind: 'ignore', file: f.file, ignore: true }))}>
                Ignore
              </Button>
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

function Ignored({ files }: { files: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12.5px]">
      <button onClick={() => setOpen(!open)} className="text-muted hover:text-ink">
        {open ? '▾' : '▸'} {files.length} ignored file{files.length === 1 ? '' : 's'} in the agents folder
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {files.map((f) => (
            <div key={f} className="flex items-center gap-2 pl-4">
              <span className="flex-1 text-muted truncate">{f}</span>
              <button onClick={() => act(api.organizeAgents({ kind: 'ignore', file: f, ignore: false }))} className="text-accent">
                Show again
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Activity() {
  const a = useStore((st) => st.state)!.agents
  const pending = a.approvals.filter((x) => x.status === 'pending')
  const paused = a.runs.filter((r) => r.status === 'paused')
  return (
    <>
      {(pending.length > 0 || paused.length > 0 || a.review) && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium text-muted">Waiting for you</h2>
          {paused.map((r) => (
            <PausedCard key={r.id} run={r} />
          ))}
          {a.review && <ReviewCard />}
          {pending.map((x) => (
            <ApprovalCard key={x.id} action={x} />
          ))}
        </section>
      )}
      <Goals />
      <History runs={a.runs} />
    </>
  )
}

function History({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null)
  // Runs started by a handoff are grouped under a header with the chain's total tokens and cost; single runs stay as they were.
  const list = groupChains(runs).flatMap((c) => [...(c.runs.length > 1 ? [{ header: c } as const] : []), ...c.runs.map((x) => ({ run: x.run, depth: c.runs.length > 1 ? x.depth + 1 : 0 }))])
  return (
    <section>
      <h2 className="text-[13px] font-medium text-muted mb-2">Recent runs</h2>
      {!list.length && <div className="text-[13px] text-faint">Nothing has run yet.</div>}
      <div className="rounded-2xl border border-line/70 divide-y divide-line/60 overflow-hidden">
        {list.map((row) => {
          if ('header' in row) {
            const c = row.header
            return (
              <div key={`chain-${c.id}`} className="px-4 py-2 text-[12px] text-muted bg-sunken/50 flex gap-2">
                <span className="font-medium">Handoff chain</span>
                <span>{c.runs.length} runs</span>
                <span className="text-faint">{[c.tokens ? `${c.tokens} tokens` : '', c.costUsd ? `$${c.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ')}</span>
              </div>
            )
          }
          const { run: r, depth } = row
          return (
          <div key={r.id}>
            <button onClick={() => setOpen(open === r.id ? null : r.id)} style={{ paddingLeft: 16 + depth * 18 }} className="w-full flex items-center gap-2 pr-4 py-2.5 text-[13px] text-left">
              {open === r.id ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
              {r.status === 'running' && <Loader2 size={12} className="animate-spin text-accent" />}
              <span className="font-medium">{r.agentName}</span>
              <span className="flex-1 truncate text-muted">{r.input.text}</span>
              <span className={cx('text-[12px]', r.status === 'error' ? 'text-danger' : r.status === 'done' ? 'text-ok' : 'text-muted')}>{r.status}</span>
              <span className="text-[12px] text-faint">{when(r.queuedAt)}</span>
              {(r.status === 'running' || r.status === 'queued' || r.status === 'paused') && (
                <span role="button" title="Cancel" onClick={(e) => (e.stopPropagation(), act(api.cancelRun(r.id)))} className="text-muted hover:text-danger">
                  <Square size={12} />
                </span>
              )}
            </button>
            {open === r.id && (
              <div className="px-4 pb-3 text-[13px] space-y-2">
                {r.error && <div className="text-danger">{r.error}</div>}
                {r.output?.text && <div className="whitespace-pre-wrap leading-relaxed">{r.output.text}</div>}
                {r.outputFile && <div className="text-muted">Saved to {r.outputFile}</div>}
                {r.progress.length > 0 && (
                  <div className="font-mono text-[11.5px] text-muted max-h-32 overflow-y-auto">
                    {r.progress.map((p, i) => (
                      <div key={i}>{p}</div>
                    ))}
                  </div>
                )}
                {r.usage && <div className="text-[12px] text-faint">{[r.usage.inputTokens && `${r.usage.inputTokens} in`, r.usage.outputTokens && `${r.usage.outputTokens} out`, r.usage.costUsd && `$${r.usage.costUsd.toFixed(3)}`].filter(Boolean).join(' · ')}</div>}
              </div>
            )}
          </div>
          )
        })}
      </div>
    </section>
  )
}

function Examples({ onClose }: { onClose: () => void }) {
  const samples = useStore((st) => st.state)!.agents.samples.filter((x) => !x.added)
  return (
    <Modal onClose={onClose} width="max-w-lg">
      <div className="p-6">
        <h2 className="text-[17px] font-semibold">Start from an example</h2>
        <p className="text-[13px] text-muted mt-1">Examples are ordinary agents you can change or delete. Adding one writes its file to your agents folder.</p>
        <div className="mt-4 divide-y divide-line/70">
          {samples.map((x) => (
            <div key={x.id} className="py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-medium">{x.name}</div>
                <div className="text-[13px] text-muted">{x.description}</div>
                {x.needs && <div className="text-[12px] text-warn mt-0.5">Needs {x.needs}</div>}
              </div>
              <Button onClick={() => act(api.addSampleAgent(x.id), `${x.name} added`)}>
                <Plus size={13} /> Add
              </Button>
            </div>
          ))}
          {!samples.length && <div className="py-3 text-[13px] text-faint">You have added all the examples.</div>}
        </div>
        <div className="flex justify-end mt-4">
          <Button kind="ghost" onClick={onClose}>
            Done
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
  // Models this account can run; null while loading. Empty = the engine picks its own.
  const [models, setModels] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    setModels(null)
    api.agentModels(d.profile).then((m) => live && setModels(m), () => live && setModels([]))
    return () => {
      live = false
    }
  }, [d.profile])
  // Effort levels the account's engine accepts; empty = none to choose.
  const [efforts, setEfforts] = useState<Record<string, string[]>>({})
  useEffect(() => {
    api.chatModels().then((l) => setEfforts(Object.fromEntries(l.map((o) => [o.profile, o.efforts]))), () => {})
  }, [])
  const unavailable = Boolean(d.model && models && models.length > 0 && !models.includes(d.model))
  const set = (p: Partial<AgentDef>) => setD({ ...d, ...p })
  const field = 'h-9 px-3 rounded-xl border border-line bg-bg text-[13.5px] outline-none focus:border-accent'
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const save = async () => {
    try {
      const folders = (d.folders ?? []).map((f) => f.trim()).filter(Boolean)
      await api.saveAgent({ ...d, folders: folders.length ? folders : undefined, id: isNew ? slug(d.name) : d.id, name: d.name.trim() || d.id })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal onClose={onClose} width="max-w-xl">
      <div className="p-6 space-y-5">
        <h2 className="text-[17px] font-semibold">{isNew ? 'New agent' : d.name}</h2>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-muted">Name</span>
          <input autoFocus={isNew} className={field} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Weekly summary" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-muted">What it should do</span>
          <textarea value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={8} placeholder="Describe the agent's job in plain language…" className="px-3 py-2.5 rounded-xl border border-line bg-bg text-[14px] leading-relaxed outline-none focus:border-accent resize-none" />
        </label>
        <div className="grid grid-cols-2 gap-4 @max-3xl:grid-cols-1 text-[13px]">
          <label className="flex flex-col gap-1.5">
            <span className="text-muted">Account</span>
            <select className={field} value={d.profile} onChange={(e) => set({ profile: e.target.value, model: undefined, effort: undefined })}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-muted">What it may do</span>
            <select className={field} value={d.permission} onChange={(e) => set({ permission: e.target.value as Permission })}>
              {(['read', 'propose', 'act'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-faint">{PERMISSION_HELP[d.permission]}</span>
          </label>
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted hover:text-ink select-none">More options</summary>
          <div className="grid grid-cols-2 gap-4 @max-3xl:grid-cols-1 mt-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-muted">Description</span>
              <input className={field} value={d.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} placeholder="Shown in lists and to coordinators" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-muted">Result</span>
              <select className={field} value={d.output} onChange={(e) => set({ output: e.target.value as AgentOutput })}>
                {(Object.keys(OUTPUT_HELP) as AgentOutput[]).map((o) => (
                  <option key={o} value={o}>
                    {OUTPUT_HELP[o]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-muted">Model</span>
              <select className={cx(field, unavailable && 'border-danger text-danger')} value={d.model ?? ''} disabled={!models?.length && !d.model} onChange={(e) => set({ model: e.target.value || undefined })}>
                <option value="">{models && !models.length ? 'Chosen by the account' : 'Account default'}</option>
                {unavailable && <option value={d.model}>{d.model} (not available)</option>}
                {(models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {unavailable && <span className="text-[12px] text-danger">This account can't run “{d.model}”. Pick one from the list.</span>}
            </label>
            {(efforts[d.profile]?.length ?? 0) > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-muted">Effort</span>
                <select className={field} value={d.effort ?? ''} onChange={(e) => set({ effort: e.target.value || undefined })}>
                  <option value="">Account default</option>
                  {efforts[d.profile].map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
                <span className="text-[11.5px] text-faint">The default for its chats too; the chat can switch model and effort for one conversation.</span>
              </label>
            )}
            <div className="flex flex-col gap-1.5 col-span-2 @max-3xl:col-span-1">
              <span className="text-muted">Folders</span>
              <div className="flex gap-2">
                <input className={cx(field, 'flex-1 min-w-0')} value={d.workdir ?? ''} onChange={(e) => set({ workdir: e.target.value || undefined })} placeholder="Main folder: it works and saves its files here (default: its own workspace)" />
                <Button onClick={async () => { const f = await api.chooseFolder(); if (f) set({ workdir: f }) }}>Choose…</Button>
              </div>
              {(d.folders ?? []).map((f, i) => (
                <div key={i} className="flex gap-2">
                  <input className={cx(field, 'flex-1 min-w-0')} value={f} onChange={(e) => set({ folders: (d.folders ?? []).map((x, j) => (j === i ? e.target.value : x)) })} placeholder="Another folder it may use" />
                  <Button kind="ghost" onClick={() => set({ folders: (d.folders ?? []).filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              ))}
              <div>
                <Button onClick={async () => { const f = await api.chooseFolder(); if (f) set({ folders: [...(d.folders ?? []), f] }) }}>Add folder…</Button>
              </div>
              <div className="h-9 px-3 rounded-xl border border-dashed border-line text-[13px] text-faint flex items-center">AI Center vault · always available for context</div>
              <span className="text-[11.5px] text-faint">Folders in the vault (projects) or anywhere on your Mac. Edits outside the vault aren't reviewed.</span>
            </div>
            <label className="flex flex-col gap-1.5 col-span-2 @max-3xl:col-span-1">
              <span className="text-muted">Runs on its own (one per line: schedule: 07:00, on-open, file-watch: {TASKS_DIR}/*.md)</span>
              <textarea className="px-3 py-2 rounded-xl border border-line bg-bg text-[13px] font-mono outline-none focus:border-accent resize-none" rows={2} value={d.triggers.filter((t) => t !== 'manual').join('\n')} onChange={(e) => set({ triggers: ['manual', ...e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)] })} />
            </label>
          </div>
        </details>
        {error && <div className="text-danger text-[13px]">{error}</div>}
        <div className="flex items-center justify-between pt-1">
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
              <Check size={13} /> Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
