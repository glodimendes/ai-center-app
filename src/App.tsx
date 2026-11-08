import { useEffect, useState } from 'react'
import { CalendarDays, CalendarRange, FileText, Inbox, ListChecks, Settings as Cog, Sparkles, TrendingUp, Wand2 } from 'lucide-react'
import { bootstrap, useStore, type View } from '@/store/app'
import { cx } from '@/lib/util'
import { Toasts } from '@/components/Toasts'
import { CommandPalette } from '@/components/CommandPalette'
import { ContextUpdate } from '@/components/ContextUpdate'
import { Today } from '@/views/Today'
import { Week } from '@/views/Week'
import { Tasks } from '@/views/Tasks'
import { InboxView } from '@/views/Inbox'
import { Docs } from '@/views/Docs'
import { Review } from '@/views/Review'
import { Settings } from '@/views/Settings'

const NAV: { view: View; label: string; icon: typeof CalendarDays; key: string }[] = [
  { view: 'today', label: 'Today', icon: CalendarDays, key: '1' },
  { view: 'week', label: 'Week', icon: CalendarRange, key: '2' },
  { view: 'tasks', label: 'Tasks', icon: ListChecks, key: '3' },
  { view: 'inbox', label: 'Inbox', icon: Inbox, key: '4' },
  { view: 'docs', label: 'Docs', icon: FileText, key: '5' },
  { view: 'review', label: 'Review', icon: TrendingUp, key: '6' }
]

export function App() {
  const { state, view, go } = useStore()
  const [palette, setPalette] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const warnCount = state.plan.warnings.filter((w) => w.kind === 'deadline').length

  return (
    <div className="h-full flex">
      <aside className="w-52 shrink-0 border-r border-line bg-sunken flex flex-col">
        <div className="drag-region h-12" />
        <div className="px-4 pb-3 flex items-center gap-2 text-[13px] font-semibold">
          <Sparkles size={15} className="text-accent" /> AI Center
        </div>
        <nav className="px-2 flex flex-col gap-0.5">
          {NAV.map(({ view: v, label, icon: Icon, key }) => (
            <button
              key={v}
              onClick={() => go(v)}
              className={cx(
                'group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left',
                view === v ? 'bg-panel shadow-sm font-medium' : 'text-muted hover:bg-panel/60 hover:text-ink'
              )}
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {v === 'inbox' && inboxCount > 0 && <span className="text-[11px] text-faint">{inboxCount}</span>}
              {v === 'today' && warnCount > 0 && <span className="text-[11px] text-warn">{warnCount}</span>}
              <span className="text-[10px] text-faint opacity-0 group-hover:opacity-100">⌘{key}</span>
            </button>
          ))}
        </nav>
        <div className="px-2 mt-4">
          <button
            onClick={() => setContextOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md border border-dashed border-line text-[12.5px] text-muted hover:text-ink hover:border-accent hover:bg-panel"
            title="Tell the AI what changed (⌘U)"
          >
            <Wand2 size={14} className="text-accent" />
            <span className="flex-1 text-left">Update context</span>
            <span className="text-[10px] text-faint">⌘U</span>
          </button>
        </div>
        <div className="flex-1" />
        <div className="px-2 pb-3">
          <button
            onClick={() => go('settings')}
            className={cx('w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md', view === 'settings' ? 'bg-panel shadow-sm' : 'text-muted hover:text-ink')}
          >
            <Cog size={15} /> Settings
          </button>
          <div className="px-2.5 pt-2 text-[11px] text-faint leading-snug">
            <div className="truncate" title={state.vault.vaultPath}>
              {state.vault.vaultPath.includes('.dev-vault') ? 'Dev vault (copy)' : 'AI Center vault'}
            </div>
            <div>{state.calendar.connected ? 'Calendar connected' : 'Calendar not connected'}</div>
            <div className="pt-1">⌘K to search</div>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        {state.vault.errors.length > 0 && (
          <div className="bg-warn-soft text-warn px-5 py-2 text-[12px]">{state.vault.errors.join(' · ')}</div>
        )}
        {view === 'today' && <Today />}
        {view === 'week' && <Week />}
        {view === 'tasks' && <Tasks />}
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
