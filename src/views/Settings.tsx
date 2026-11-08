import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, FolderOpen } from 'lucide-react'
import type { CategoryPref, Preferences, Weekday } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Dot, Header } from '@/components/ui'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const input = 'h-7 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export function Settings() {
  const s = useStore((st) => st.state)!
  const [prefs, setPrefs] = useState<Preferences>(s.vault.preferences)
  const [clientId, setClientId] = useState(s.settings.googleClientId ?? '')
  const [secret, setSecret] = useState(s.settings.googleClientSecret ?? '')
  const [connecting, setConnecting] = useState(false)
  const dirty = JSON.stringify(prefs) !== JSON.stringify(s.vault.preferences)

  useEffect(() => {
    if (!dirty) setPrefs(s.vault.preferences)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.vault.preferences])

  const setCat = (key: string, patch: Partial<CategoryPref>) => setPrefs({ ...prefs, categories: prefs.categories.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  const calendars = s.calendar.calendars

  const connect = async () => {
    setConnecting(true)
    await act(api.saveSettings({ googleClientId: clientId.trim(), googleClientSecret: secret.trim() }))
    await act(api.connectCalendar(), 'Google Calendar connected')
    setConnecting(false)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Settings">
        {(dirty || !s.vault.preferencesFileExists) && (
          <Button kind="primary" onClick={() => act(api.savePreferences(prefs), 'Preferences saved to the vault')}>
            {s.vault.preferencesFileExists ? 'Save preferences' : 'Create preferences file'}
          </Button>
        )}
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col gap-8">
          <Card title="Vault" desc="Where tasks, docs and logs are read from and written to.">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[12px] bg-sunken px-2 py-1.5 rounded-md truncate">{s.vault.vaultPath}</code>
              <Button
                onClick={async () => {
                  const p = await api.chooseVault()
                  if (p) await act(api.saveSettings({ vaultPath: p }), 'Vault changed')
                }}
              >
                <FolderOpen size={13} /> Change
              </Button>
              <Button kind="ghost" onClick={() => api.revealVault()}>
                Open
              </Button>
            </div>
            <label className="flex items-center gap-2 mt-3 text-[12.5px]">
              <input type="checkbox" checked={s.settings.autoCommit} onChange={(e) => act(api.saveSettings({ autoCommit: e.target.checked }))} />
              Commit each change to the vault's git history (authored by you) so everything can be undone
            </label>
            <label className="flex items-center gap-2 mt-3 text-[12.5px]">
              <span className="text-muted">“Update context” runs with</span>
              <select className={input} value={s.settings.contextEngine} onChange={(e) => act(api.saveSettings({ contextEngine: e.target.value as 'claude' | 'codex' }))}>
                <option value="codex">Codex · GPT-5.6 Terra, medium</option>
                <option value="claude">Claude Code · Sonnet 5, medium</option>
              </select>
              <span className="text-[11.5px] text-faint">uses your existing subscription; file edits inside the vault only</span>
            </label>
          </Card>

          <Card title="Google Calendar" desc="Reads all your calendars to find free time and writes planned blocks into the category's calendar. Only events the planner created are ever changed.">
            {s.calendar.connected ? (
              <div className="flex items-center gap-3">
                <span className="text-ok text-[12.5px] font-medium">Connected</span>
                <span className="text-[12px] text-muted">
                  {calendars.length} calendars{s.calendar.lastRefresh && ` · refreshed ${new Date(s.calendar.lastRefresh).toLocaleTimeString()}`}
                </span>
                <span className="flex-1" />
                <Button onClick={() => act(api.refreshCalendar())}>Refresh</Button>
                <Button kind="danger" onClick={() => act(api.disconnectCalendar(), 'Disconnected')}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <>
                <ol className="text-[12.5px] text-muted list-decimal pl-5 space-y-1 mb-4">
                  <li>
                    Open{' '}
                    <a className="text-accent underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
                      Google Cloud Console <ExternalLink size={10} className="inline" />
                    </a>{' '}
                    and create a project (e.g. "AI Center Planner").
                  </li>
                  <li>
                    Enable the{' '}
                    <a className="text-accent underline" href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">
                      Google Calendar API
                    </a>
                    .
                  </li>
                  <li>
                    Under <b>Google Auth Platform → Branding/Audience</b>, set up the consent screen as <b>External</b>, keep it in <b>Testing</b>, and add your own Gmail
                    address as a test user.
                  </li>
                  <li>
                    Under <b>Clients</b>, create an OAuth client of type <b>Desktop app</b>. Copy its client ID and secret here.
                  </li>
                  <li>Click Connect: your browser opens Google's sign-in, then you come back here.</li>
                </ol>
                <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-[12.5px]">
                  <span className="text-muted">Client ID</span>
                  <input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
                  <span className="text-muted">Client secret</span>
                  <input className={input} value={secret} onChange={(e) => setSecret(e.target.value)} type="password" />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button kind="primary" onClick={connect} disabled={!clientId || !secret || connecting}>
                    {connecting ? 'Waiting for browser…' : 'Connect'}
                  </Button>
                  {s.calendar.error && <span className="text-danger text-[12px]">{s.calendar.error}</span>}
                </div>
              </>
            )}
          </Card>

          <Card
            title="Categories"
            desc="How todo headings map to categories, which calendar each one's blocks go to, and which existing events (e.g. 'Thesis Deep Work') the planner fills with tasks."
          >
            {!s.vault.preferencesFileExists && (
              <div className="mb-3 text-[12px] bg-warn-soft text-warn px-3 py-2 rounded-md">
                Using built-in defaults. Click “Create preferences file” to save them as 05_Tasks/planner/preferences.md in your vault (readable by Claude and Codex too).
              </div>
            )}
            <div className="flex flex-col gap-3">
              {prefs.categories.map((c) => (
                <div key={c.key} className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2">
                    <input type="color" value={c.color} onChange={(e) => setCat(c.key, { color: e.target.value })} className="w-6 h-6 rounded border-0 bg-transparent" />
                    <input className={`${input} w-40 font-medium`} value={c.label} onChange={(e) => setCat(c.key, { label: e.target.value })} />
                    <span className="text-[11px] text-faint">{c.key}</span>
                    <span className="flex-1" />
                    <span className="text-[11.5px] text-muted">Calendar</span>
                    {calendars.length ? (
                      <select className={input} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })}>
                        {!calendars.some((k) => k.name === c.calendar) && <option>{c.calendar}</option>}
                        {calendars
                          .filter((k) => k.writable)
                          .map((k) => (
                            <option key={k.id}>{k.name}</option>
                          ))}
                      </select>
                    ) : (
                      <input className={`${input} w-40`} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })} />
                    )}
                  </div>
                  <div className="grid grid-cols-[130px_1fr_130px_1fr] gap-x-3 gap-y-2 mt-3 items-center text-[12px]">
                    <span className="text-muted">Todo headings</span>
                    <input className={input} value={c.headings.join(', ')} onChange={(e) => setCat(c.key, { headings: list(e.target.value) })} placeholder="e.g. Thesis, BRASA" />
                    <span className="text-muted">Container events</span>
                    <input className={input} value={c.containers.join(', ')} onChange={(e) => setCat(c.key, { containers: list(e.target.value) })} placeholder="e.g. Thesis Deep Work" />
                    <span className="text-muted">Default estimate (min)</span>
                    <input className={input} type="number" value={c.defaultEstimateMinutes} onChange={(e) => setCat(c.key, { defaultEstimateMinutes: Number(e.target.value) || 30 })} />
                    <span className="text-muted">Time window</span>
                    <div className="flex gap-1 items-center">
                      <input type="time" className={input} value={c.window?.[0] ?? ''} onChange={(e) => setCat(c.key, { window: e.target.value ? [e.target.value, c.window?.[1] ?? '21:00'] : undefined })} />
                      –
                      <input type="time" className={input} value={c.window?.[1] ?? ''} onChange={(e) => setCat(c.key, { window: e.target.value ? [c.window?.[0] ?? '08:00', e.target.value] : undefined })} />
                    </div>
                    <span className="text-muted">Weekly target (h)</span>
                    <input
                      className={input}
                      type="number"
                      value={c.budget?.minHours ?? ''}
                      onChange={(e) => setCat(c.key, { budget: { ...c.budget, minHours: e.target.value ? Number(e.target.value) : undefined } })}
                    />
                    <span className="text-muted">Weekly cap (h)</span>
                    <input
                      className={input}
                      type="number"
                      value={c.budget?.maxHours ?? ''}
                      onChange={(e) => setCat(c.key, { budget: { ...c.budget, maxHours: e.target.value ? Number(e.target.value) : undefined } })}
                    />
                    <span className="text-muted">Deep work</span>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={Boolean(c.deepWork)} onChange={(e) => setCat(c.key, { deepWork: e.target.checked })} /> counts toward the daily deep-work cap
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Working hours & rules" desc="The scheduler only places work inside these hours (training uses its own windows).">
            <div className="grid grid-cols-7 gap-2">
              {DAYS.map((d) => {
                const wh = prefs.workingHours[d]
                return (
                  <div key={d} className="rounded-md border border-line p-2 text-[12px]">
                    <label className="flex items-center gap-1.5 font-medium capitalize">
                      <input
                        type="checkbox"
                        checked={Boolean(wh)}
                        onChange={(e) => setPrefs({ ...prefs, workingHours: { ...prefs.workingHours, [d]: e.target.checked ? ['09:00', '18:00'] : null } })}
                      />
                      {d}
                    </label>
                    {wh && (
                      <div className="flex flex-col gap-1 mt-1.5">
                        <input type="time" className={input} value={wh[0]} onChange={(e) => setPrefs({ ...prefs, workingHours: { ...prefs.workingHours, [d]: [e.target.value, wh[1]] } })} />
                        <input type="time" className={input} value={wh[1]} onChange={(e) => setPrefs({ ...prefs, workingHours: { ...prefs.workingHours, [d]: [wh[0], e.target.value] } })} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="grid grid-cols-4 gap-3 mt-4 text-[12px]">
              <Num label="Buffer between blocks (min)" value={prefs.bufferMinutes} onChange={(v) => setPrefs({ ...prefs, bufferMinutes: v })} />
              <Num label="Shortest chunk (min)" value={prefs.minChunkMinutes} onChange={(v) => setPrefs({ ...prefs, minChunkMinutes: v })} />
              <Num label="Max deep work / day (min)" value={prefs.maxDeepWorkMinutesPerDay} onChange={(v) => setPrefs({ ...prefs, maxDeepWorkMinutesPerDay: v })} />
              <Num label="Days synced to calendar" value={prefs.syncDays} onChange={(v) => setPrefs({ ...prefs, syncDays: v })} />
            </div>
          </Card>

          <Card title="Training" desc="Sessions come from 02_Projects/hybrid-training.md. They go into an existing Sports event that day, or into a free slot in the windows below.">
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="text-muted">A date that was Day 1 (and week 1 of the Day 7 rotation)</span>
              <input type="date" className={input} value={prefs.training.cycleStart} onChange={(e) => setPrefs({ ...prefs, training: { ...prefs.training, cycleStart: e.target.value } })} />
            </div>
            <div className="flex items-center gap-2 mt-3 text-[12.5px]">
              <span className="text-muted">Preferred windows</span>
              {prefs.training.preferredWindows.map((w, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input
                    type="time"
                    className={input}
                    value={w[0]}
                    onChange={(e) => {
                      const ws = prefs.training.preferredWindows.map((x, j) => (j === i ? ([e.target.value, x[1]] as [string, string]) : x))
                      setPrefs({ ...prefs, training: { ...prefs.training, preferredWindows: ws } })
                    }}
                  />
                  –
                  <input
                    type="time"
                    className={input}
                    value={w[1]}
                    onChange={(e) => {
                      const ws = prefs.training.preferredWindows.map((x, j) => (j === i ? ([x[0], e.target.value] as [string, string]) : x))
                      setPrefs({ ...prefs, training: { ...prefs.training, preferredWindows: ws } })
                    }}
                  />
                </span>
              ))}
            </div>
            {s.vault.training && (
              <div className="mt-3 text-[11.5px] text-muted flex flex-wrap gap-x-4">
                {s.vault.training.days.map((d) => (
                  <span key={d.day}>
                    <Dot color="#ef4444" className="mr-1" />
                    Day {d.day}: {d.session}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {desc && <p className="text-[12px] text-muted mt-0.5 mb-3">{desc}</p>}
      <div className="rounded-xl border border-line bg-panel p-4">{children}</div>
    </section>
  )
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input type="number" className={input} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  )
}
