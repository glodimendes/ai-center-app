import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarRange, PanelLeftClose, PanelLeftOpen, Sun, FileText, Inbox, ListChecks, Settings as Cog, Sparkles, TrendingUp, Wand2, type LucideProps } from 'lucide-react'
import { bootstrap, useStore, type View } from '@/store/app'
import { cx } from '@/lib/util'
import { Toasts } from '@/components/Toasts'
import { CommandPalette } from '@/components/CommandPalette'
import { ContextUpdate } from '@/components/ContextUpdate'
import { Today } from '@/views/Today'
import { Brief } from '@/views/Brief'
import { Week } from '@/views/Week'
import { Tasks } from '@/views/Tasks'
import { InboxView } from '@/views/Inbox'
import { Docs } from '@/views/Docs'
import { Review } from '@/views/Review'
import { Settings } from '@/views/Settings'
import { Alerts, alertItems } from '@/views/Alerts'

/** Calendar glyph with today's day of the month. */
function TodayIcon({ size = 15 }: LucideProps) {
  const [day, setDay] = useState(new Date().getDate())
  useEffect(() => {
    const t = setInterval(() => setDay(new Date().getDate()), 60_000)
    return () => clearInterval(t)
  }, [])
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="2.5" y="3.5" width="19" height="19" rx="3" />
      <path d="M2.5 8h19" />
      <text x="12" y="20" textAnchor="middle" fontSize={day > 9 ? 11.5 : 13} fontWeight="800" fill="currentColor" stroke="none" fontFamily="-apple-system, system-ui, sans-serif">
        {day}
      </text>
    </svg>
  )
}

const NAV: { view: View; label: string; icon: (p: LucideProps) => React.ReactNode; key: string }[] = [
  { view: 'brief', label: 'Brief', icon: Sun, key: '1' },
  { view: 'today', label: 'Today', icon: TodayIcon, key: '2' },
  { view: 'week', label: 'Week', icon: CalendarRange, key: '3' },
  { view: 'tasks', label: 'Tasks', icon: ListChecks, key: '4' },
  { view: 'alerts', label: 'Alerts', icon: AlertTriangle, key: '5' },
  { view: 'inbox', label: 'Inbox', icon: Inbox, key: '6' },
  { view: 'docs', label: 'Docs', icon: FileText, key: '7' },
  { view: 'review', label: 'Review', icon: TrendingUp, key: '8' }
]

const RAIL_KEY = 'sidebar'
/** Below this window width the sidebar shrinks to icons unless the user expanded it. */
const RAIL_BELOW = 900

function useSidebar(): [boolean, () => void] {
  const [width, setWidth] = useState(window.innerWidth)
  const [pref, setPref] = useState<'auto' | 'rail' | 'full'>(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY)
      return v === 'rail' || v === 'full' ? v : 'auto'
    } catch {
      return 'auto'
    }
  })
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const rail = pref === 'rail' || (pref === 'auto' && width < RAIL_BELOW)
  const toggle = () => {
    // Back to automatic when the choice matches what the width would pick anyway.
    const next = rail === width < RAIL_BELOW ? (rail ? 'full' : 'rail') : 'auto'
    setPref(next)
    try {
      localStorage.setItem(RAIL_KEY, next)
    } catch {
      /* per-device convenience only */
    }
  }
  return [rail, toggle]
}

export function App() {
  const { state, view, go } = useStore()
  const [palette, setPalette] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rail, toggleRail] = useSidebar()
  const [errorsOpen, setErrorsOpen] = useState(false)

  useEffect(() => {
    bootstrap().catch((e) => setError(String(e?.message ?? e)))
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
      const item = NAV.find((n) => n.key === e.key)
      if (item) {
        e.preventDefault()
        go(item.view)
      }
      if (e.key === 'u') {
        e.preventDefault()
        setContextOpen(true)
      }
      if (e.key === ',') {
        e.preventDefault()
        go('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (error) return <div className="p-10 text-danger">Failed to start: {error}</div>
  if (!state) return <div className="h-full grid place-items-center text-muted">Loading vault…</div>

  const inboxCount = state.vault.inbox.length
  const alerts = alertItems(state.plan.warnings, state.vault.tasks)
  const urgent = alerts.some((a) => a.group === 'overdue' || a.group === 'risk')

  return (
    <div className="h-full flex">
      <aside className={cx('shrink-0 border-r border-line bg-sunken flex flex-col overflow-y-auto overflow-x-hidden', rail ? 'w-[52px]' : 'w-52')}>
        <div className="drag-region h-12 shrink-0" />
        <div className={cx('pb-3 flex items-center gap-2 text-[13px] font-semibold', rail ? 'justify-center' : 'px-4')} title={rail ? 'AI Center' : undefined}>
          <Sparkles size={15} className="text-accent shrink-0" /> {!rail && <span className="flex-1 truncate">AI Center</span>}
          {!rail && (
            <button onClick={toggleRail} className="text-faint hover:text-ink" title="Collapse the sidebar">
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>
        <nav className="px-2 flex flex-col gap-0.5">
          {NAV.map(({ view: v, label, icon: Icon, key }) => {
            const count = v === 'inbox' && inboxCount > 0 ? inboxCount : v === 'alerts' && alerts.length > 0 ? alerts.length : 0
            const countClass = v === 'alerts' ? (urgent ? 'text-danger' : 'text-warn') : 'text-faint'
            return (
              <button
                key={v}
                onClick={() => go(v)}
                title={rail ? `${label}${count ? ` (${count})` : ''} · ⌘${key}` : undefined}
                className={cx(
                  'group relative flex items-center gap-2.5 py-1.5 rounded-md text-left',
                  rail ? 'justify-center px-0' : 'px-2.5',
                  view === v ? 'bg-panel shadow-sm font-medium' : 'text-muted hover:bg-panel/60 hover:text-ink'
                )}
              >
                <Icon size={15} />
                {rail ? (
                  count > 0 && <span className={cx('absolute top-0 right-0.5 text-[9.5px] leading-none', countClass)}>{count}</span>
                ) : (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    {count > 0 && <span className={cx('text-[11px]', countClass)}>{count}</span>}
                    <span className="text-[10px] text-faint opacity-0 group-hover:opacity-100">⌘{key}</span>
                  </>
                )}
              </button>
            )
          })}
        </nav>
        <div className="px-2 mt-4">
          <button
            onClick={() => setContextOpen(true)}
            className={cx(
              'w-full flex items-center gap-2 py-2 rounded-md border border-dashed border-line text-[12.5px] text-muted hover:text-ink hover:border-accent hover:bg-panel',
              rail ? 'justify-center px-0' : 'px-2.5'
            )}
            title="Tell the AI what changed (⌘U)"
          >
            <Wand2 size={14} className="text-accent shrink-0" />
            {!rail && (
              <>
                <span className="flex-1 text-left truncate">Update context</span>
                <span className="text-[10px] text-faint">⌘U</span>
              </>
            )}
          </button>
        </div>
        <div className="flex-1" />
        <div className="px-2 pb-3">
          {rail && (
            <button onClick={toggleRail} className="w-full flex justify-center py-1.5 rounded-md text-muted hover:text-ink" title="Expand the sidebar">
              <PanelLeftOpen size={15} />
            </button>
          )}
          <button
            onClick={() => go('settings')}
            title={rail ? 'Settings · ⌘,' : undefined}
            className={cx(
              'w-full flex items-center gap-2.5 py-1.5 rounded-md',
              rail ? 'justify-center' : 'px-2.5',
              view === 'settings' ? 'bg-panel shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <Cog size={15} /> {!rail && 'Settings'}
          </button>
          {!rail && (
            <div className="px-2.5 pt-2 text-[11px] text-faint leading-snug">
              <div className="truncate" title={state.vault.vaultPath}>
                {state.vault.vaultPath.includes('.dev-vault') ? 'Dev vault (copy)' : 'AI Center vault'}
              </div>
              <div className="truncate">{state.calendar.connected ? 'Calendar connected' : 'Calendar not connected'}</div>
              <div className="pt-1">⌘K to search</div>
            </div>
          )}
        </div>
      </aside>
      <main className="@container flex-1 min-w-0 overflow-hidden flex flex-col">
        {state.vault.errors.length > 0 && (
          <div className="bg-warn-soft text-warn px-5 py-2 text-[12px] flex gap-2 items-start">
            <div className={cx('flex-1 min-w-0 break-words', !errorsOpen && 'line-clamp-2')}>{state.vault.errors.join(' · ')}</div>
            <button onClick={() => setErrorsOpen(!errorsOpen)} className="shrink-0 underline">
              {errorsOpen ? 'less' : 'more'}
            </button>
          </div>
        )}
        {view === 'brief' && <Brief />}
        {view === 'today' && <Today />}
        {view === 'week' && <Week />}
        {view === 'tasks' && <Tasks />}
        {view === 'alerts' && <Alerts />}
        {view === 'inbox' && <InboxView />}
        {view === 'docs' && <Docs />}
        {view === 'review' && <Review />}
        {view === 'settings' && <Settings />}
      </main>
      {palette && <CommandPalette onClose={() => setPalette(false)} onUpdateContext={() => setContextOpen(true)} />}
      {contextOpen && <ContextUpdate onClose={() => setContextOpen(false)} />}
      <Toasts />
    </div>
  )
}
