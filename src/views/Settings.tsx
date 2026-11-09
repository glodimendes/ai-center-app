import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, FolderOpen } from 'lucide-react'
import type { Preferences, Weekday } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Header } from '@/components/ui'
import { HeadingMap } from './settings/HeadingMap'
import { AreaSettings, DurationInput, input } from './settings/AreaSettings'
import { StrategySettings } from './settings/StrategySettings'
import { BriefPromptEditor } from './settings/BriefPrompt'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

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
                    and create a project (e.g. "AI Center").
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

          <Card title="Areas" desc="Add or remove areas; set colour, calendar, which of your calendar events (e.g. “Thesis Deep Work”) get filled, and the windows each area is planned in. Training is an area like the others, with a gap around it.">
            {!s.vault.preferencesFileExists && (
              <div className="mb-3 text-[12px] bg-warn-soft text-warn px-3 py-2 rounded-md">
                Using built-in defaults. Click “Create preferences file” to save them as 05_Tasks/planner/preferences.md in your vault (readable by Claude and Codex too).
              </div>
            )}
            <AreaSettings prefs={prefs} setPrefs={setPrefs} calendars={calendars} />
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
              <Dur label="Buffer between blocks" value={prefs.bufferMinutes} onChange={(v) => setPrefs({ ...prefs, bufferMinutes: v })} />
              <Dur label="Shortest chunk" value={prefs.minChunkMinutes} onChange={(v) => setPrefs({ ...prefs, minChunkMinutes: v })} />
              <Dur label="Max deep work / day" value={prefs.maxDeepWorkMinutesPerDay} onChange={(v) => setPrefs({ ...prefs, maxDeepWorkMinutesPerDay: v })} />
              <Num label="Days synced to calendar" value={prefs.syncDays} onChange={(v) => setPrefs({ ...prefs, syncDays: v })} />
            </div>
          </Card>

          <Card title="Scheduling strategy" desc="How tasks are ranked and how time is divided between areas.">
            <StrategySettings prefs={prefs} setPrefs={setPrefs} />
          </Card>

          <Card title="Planning rules" desc="How the planner fills your days. The plan stays put during the day; it's fully re-planned each morning (from 04:00), when these settings change, or when you click Re-plan.">
            <div className="grid grid-cols-4 gap-3 text-[12px]">
              <Dur label="Max work / weekday" value={prefs.dailyMaxMinutes.weekday} onChange={(v) => setPrefs({ ...prefs, dailyMaxMinutes: { ...prefs.dailyMaxMinutes, weekday: v } })} />
              <Dur label="Max work / weekend day" value={prefs.dailyMaxMinutes.weekend} onChange={(v) => setPrefs({ ...prefs, dailyMaxMinutes: { ...prefs.dailyMaxMinutes, weekend: v } })} />
              <Dur label="Max on one task / day" value={prefs.maxTaskMinutesPerDay} onChange={(v) => setPrefs({ ...prefs, maxTaskMinutesPerDay: v })} />
              <Dur label="Longest block" value={prefs.maxBlockMinutes} onChange={(v) => setPrefs({ ...prefs, maxBlockMinutes: v })} />
              <Dur label="Gap after deep work" value={prefs.deepWorkBufferMinutes} onChange={(v) => setPrefs({ ...prefs, deepWorkBufferMinutes: v })} />
              <Num label="Finish deadlines early by (days)" value={prefs.deadlineSlackDays} onChange={(v) => setPrefs({ ...prefs, deadlineSlackDays: v })} />
              <Num label="Overdue becomes stale after (days)" value={prefs.staleOverdueDays} onChange={(v) => setPrefs({ ...prefs, staleOverdueDays: v })} />
              <Dur label="Checked-off task block, 0 = off" value={prefs.completedTaskMinutes} onChange={(v) => setPrefs({ ...prefs, completedTaskMinutes: v })} />
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
                    <DurationInput value={b.minutes} onChange={(v) => setBreak({ minutes: v || 30 })} />
                    <span className="text-faint">hh:mm</span>
                    <Button kind="danger" onClick={() => setPrefs({ ...prefs, breaks: prefs.breaks.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                )
              })}
              <Button onClick={() => setPrefs({ ...prefs, breaks: [...prefs.breaks, { label: 'Break', window: ['15:00', '17:00'], minutes: 20 }] })}>Add break</Button>
            </div>
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

/** Minutes shown and typed as hh:mm. */
function Dur({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label} (hh:mm)</span>
      <DurationInput className="w-full" value={value} onChange={(v) => onChange(v ?? 0)} />
    </label>
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
