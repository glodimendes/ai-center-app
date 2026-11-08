import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, FolderOpen } from 'lucide-react'
import type { CategoryPref, Preferences, Weekday } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Dot, Header } from '@/components/ui'
import { ContainerPicker, HeadingMap } from './settings/HeadingMap'
import { StrategySettings } from './settings/StrategySettings'
import { BriefPromptEditor } from './settings/BriefPrompt'

const SWATCHES = ['#6366f1', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b']
const ESTIMATES = [15, 30, 45, 60, 90, 120, 180]

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const input = 'h-7 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'

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
    if (s.calendar.provider === 'google') await act(api.saveSettings({ googleClientId: clientId.trim(), googleClientSecret: secret.trim() }))
    await act(api.connectCalendar(), 'Calendar connected')
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
                <option value="codex">Codex · GPT-5.6 Luna, medium</option>
                <option value="claude">Claude Code · Haiku 5.5, medium</option>
              </select>
              <span className="text-[11.5px] text-faint">uses your existing subscription; file edits inside the vault only</span>
            </label>
          </Card>

          <Card title="Calendar" desc="Reads all your calendars to find free time and writes approved blocks into each area's calendar. Only events the planner created are ever changed, and edits you make in your calendar win.">
            <div className="flex rounded-md border border-line overflow-hidden w-fit mb-4">
              {(
                [
                  ['macos', 'macOS Calendar (recommended)'],
                  ['google', 'Google Calendar (direct)']
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => act(api.saveSettings({ calendarProvider: k }))}
                  className={`px-3 h-7 text-[12px] ${s.calendar.provider === k ? 'bg-accent text-white' : 'text-muted hover:bg-sunken'}`}
                >
                  {label}
                </button>
              ))}
            </div>
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
            ) : s.calendar.provider === 'macos' ? (
              <>
                <ol className="text-[12.5px] text-muted list-decimal pl-5 space-y-1 mb-4">
                  <li>
                    Make sure your Google account is in macOS: <b>System Settings → Internet Accounts → Google</b>, with <b>Calendars</b> switched on. (If the
                    Calendar app already shows Study Schedule and Sports, you're set.)
                  </li>
                  <li>Click <b>Allow calendar access</b> and confirm the macOS prompt. No Google Cloud project, no cost, no weekly re-login.</li>
                </ol>
                <div className="flex items-center gap-3">
                  <Button kind="primary" onClick={connect} disabled={connecting}>
                    {connecting ? 'Waiting for macOS…' : 'Allow calendar access'}
                  </Button>
                  {s.calendar.error && <span className="text-danger text-[12px]">{s.calendar.error}</span>}
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-muted mb-2">Free (no billing). In “Testing” mode Google signs you out every 7 days; set the project to “In production” to avoid that.</p>
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

          <Card title="Daily brief" desc="Prepared by Claude Haiku (cheapest) with read-only access to your vault, Gmail and calendar. It can't send, draft, label or delete anything; suggested todos wait for your click. Saved to 05_Tasks/briefs/.">
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={s.settings.briefAuto} onChange={(e) => act(api.saveSettings({ briefAuto: e.target.checked }))} />
              Prepare it automatically the first time I open the app each day (after 04:00)
            </label>
            <label className="flex items-center gap-2 mt-2 text-[12.5px]">
              <input type="checkbox" checked={s.settings.briefEmail} onChange={(e) => act(api.saveSettings({ briefEmail: e.target.checked }))} />
              Include email (Gmail via your claude.ai connection, read-only)
            </label>
            <BriefPromptEditor />
          </Card>

          <Card title="Todo headings → areas" desc="Every heading from 05_Tasks/daily-todos.md. Click a colour to assign it; sub-headings inherit from their parent unless you set them. The number is how many tasks sit directly under the heading.">
            <HeadingMap prefs={prefs} setPrefs={setPrefs} />
          </Card>

          <Card title="Areas" desc="Colour, calendar, and which of your existing calendar events (e.g. “Thesis Deep Work”) the planner fills with tasks.">
            {!s.vault.preferencesFileExists && (
              <div className="mb-3 text-[12px] bg-warn-soft text-warn px-3 py-2 rounded-md">
                Using built-in defaults. Click “Create preferences file” to save them as 05_Tasks/planner/preferences.md in your vault (readable by Claude and Codex too).
              </div>
            )}
            <div className="flex flex-col gap-3">
              {prefs.categories.map((c) => (
                <div key={c.key} className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2">
                    <input className={`${input} w-36 font-medium`} value={c.label} onChange={(e) => setCat(c.key, { label: e.target.value })} />
                    <div className="flex gap-1">
                      {SWATCHES.map((col) => (
                        <button
                          key={col}
                          onClick={() => setCat(c.key, { color: col })}
                          className="w-4 h-4 rounded-full"
                          style={{ background: col, outline: c.color === col ? `2px solid ${col}` : undefined, outlineOffset: 2 }}
                          title={col}
                        />
                      ))}
                    </div>
                    <span className="flex-1" />
                    <span className="text-[11.5px] text-muted">Calendar</span>
                    {calendars.length ? (
                      <select className={input} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })}>
                        {!calendars.some((k) => k.name === c.calendar) && <option>{c.calendar}</option>}
                        {calendars
                          .filter((k) => k.writable && !prefs.protectedCalendars.some((p) => k.name.toLowerCase().startsWith(p.toLowerCase())))
                          .map((k) => (
                            <option key={k.id}>{k.name}</option>
                          ))}
                      </select>
                    ) : (
                      <input className={`${input} w-40`} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })} />
                    )}
                  </div>
                  <div className="grid grid-cols-[130px_1fr_130px_1fr] gap-x-3 gap-y-2 mt-3 items-center text-[12px]">
                    <span className="text-muted">Fill these events</span>
                    <div className="col-span-3">
                      <ContainerPicker cat={c} onChange={(containers) => setCat(c.key, { containers })} />
                    </div>
                    <span className="text-muted">Default estimate</span>
                    <select className={input} value={c.defaultEstimateMinutes} onChange={(e) => setCat(c.key, { defaultEstimateMinutes: Number(e.target.value) })}>
                      {[...new Set([...ESTIMATES, c.defaultEstimateMinutes])].sort((a, b) => a - b).map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} min` : `${m / 60} h`}
                        </option>
                      ))}
                    </select>
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
                    <span className="text-muted">Preferred window</span>
                    <div className="flex gap-1 items-center">
                      <input type="time" className={input} value={c.preferredWindow?.[0] ?? ''} onChange={(e) => setCat(c.key, { preferredWindow: e.target.value ? [e.target.value, c.preferredWindow?.[1] ?? '18:00'] : undefined })} />
                      –
                      <input type="time" className={input} value={c.preferredWindow?.[1] ?? ''} onChange={(e) => setCat(c.key, { preferredWindow: e.target.value ? [c.preferredWindow?.[0] ?? '08:00', e.target.value] : undefined })} />
                    </div>
                    <span className="text-muted">Shortest new block (min)</span>
                    <input className={input} type="number" value={c.minBlockMinutes ?? ''} onChange={(e) => setCat(c.key, { minBlockMinutes: e.target.value ? Number(e.target.value) : undefined })} />
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

          <Card title="Scheduling strategy" desc="How tasks are ranked and how time is divided between areas.">
            <StrategySettings prefs={prefs} setPrefs={setPrefs} />
          </Card>

          <Card title="Planning rules" desc="How the planner fills your days. The plan stays put during the day; it's fully re-planned each morning (from 04:00), when these settings change, or when you click Re-plan.">
            <div className="grid grid-cols-4 gap-3 text-[12px]">
              <Num label="Max work / weekday (min)" value={prefs.dailyMaxMinutes.weekday} onChange={(v) => setPrefs({ ...prefs, dailyMaxMinutes: { ...prefs.dailyMaxMinutes, weekday: v } })} />
              <Num label="Max work / weekend day (min)" value={prefs.dailyMaxMinutes.weekend} onChange={(v) => setPrefs({ ...prefs, dailyMaxMinutes: { ...prefs.dailyMaxMinutes, weekend: v } })} />
              <Num label="Max on one task / day (min)" value={prefs.maxTaskMinutesPerDay} onChange={(v) => setPrefs({ ...prefs, maxTaskMinutesPerDay: v })} />
              <Num label="Longest block (min)" value={prefs.maxBlockMinutes} onChange={(v) => setPrefs({ ...prefs, maxBlockMinutes: v })} />
              <Num label="Gap after deep work (min)" value={prefs.deepWorkBufferMinutes} onChange={(v) => setPrefs({ ...prefs, deepWorkBufferMinutes: v })} />
              <Num label="Gap around training (min)" value={prefs.trainingBufferMinutes} onChange={(v) => setPrefs({ ...prefs, trainingBufferMinutes: v })} />
              <Num label="Finish deadlines early by (days)" value={prefs.deadlineSlackDays} onChange={(v) => setPrefs({ ...prefs, deadlineSlackDays: v })} />
              <Num label="Overdue becomes stale after (days)" value={prefs.staleOverdueDays} onChange={(v) => setPrefs({ ...prefs, staleOverdueDays: v })} />
            </div>
            <div className="mt-4 text-[12px]">
              <div className="text-muted mb-1.5">Protected breaks (each floats to the first free stretch in its window)</div>
              {prefs.breaks.map((b, i) => {
                const setBreak = (patch: Partial<typeof b>) => setPrefs({ ...prefs, breaks: prefs.breaks.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                return (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <input className={`${input} w-28`} value={b.label} onChange={(e) => setBreak({ label: e.target.value })} />
                    <input type="time" className={input} value={b.window[0]} onChange={(e) => setBreak({ window: [e.target.value, b.window[1]] })} />–
                    <input type="time" className={input} value={b.window[1]} onChange={(e) => setBreak({ window: [b.window[0], e.target.value] })} />
                    <input type="number" className={`${input} w-20`} value={b.minutes} onChange={(e) => setBreak({ minutes: Number(e.target.value) || 30 })} />
                    <span className="text-faint">min</span>
                    <Button kind="danger" onClick={() => setPrefs({ ...prefs, breaks: prefs.breaks.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                )
              })}
              <Button onClick={() => setPrefs({ ...prefs, breaks: [...prefs.breaks, { label: 'Break', window: ['15:00', '17:00'], minutes: 20 }] })}>Add break</Button>
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
