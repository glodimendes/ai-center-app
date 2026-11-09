import type { CategoryPref, Preferences } from '@shared/types'
import { directCategory, resolveCategory } from '@shared/categories'
import { useStore } from '@/store/app'
import { cx } from '@/lib/util'

/**
 * Assign each heading of daily-todos.md to an area by clicking a colour. Sub-headings inherit
 * from their parent unless set. Stored as exact heading names, so nothing has to be typed.
 */
export function HeadingMap({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (p: Preferences) => void }) {
  const sections = useStore((s) => s.state!.vault.sections)
  const areas = prefs.categories.filter((c) => c.key !== 'other')
  const names = [...new Set(sections.map((s) => s.path[s.path.length - 1]))]

  const assign = (heading: string, key: string | null) => {
    // Normalise to exact names: every heading keeps its current direct area, then apply the change.
    const direct = new Map(names.map((n) => [n, directCategory(n, prefs.categories)]))
    direct.set(heading, key)
    const categories: CategoryPref[] = prefs.categories.map((c) => ({
      ...c,
      headings: names.filter((n) => direct.get(n) === c.key)
    }))
    setPrefs({ ...prefs, categories })
  }

  return (
    <div className="flex flex-col">
      {sections.map((sec) => {
        const name = sec.path[sec.path.length - 1]
        const direct = directCategory(name, prefs.categories)
        const resolved = resolveCategory(sec.path, prefs.categories)
        const resolvedCat = prefs.categories.find((c) => c.key === resolved)
        const count = sec.taskIds.length
        return (
          <div key={sec.path.join('>')} className="flex items-center gap-2 py-1 border-b border-line/50 last:border-0">
            <span className={cx('text-[12.5px] w-60 shrink-0 truncate', sec.path.length === 1 && 'font-semibold')} style={{ paddingLeft: (sec.path.length - 1) * 18 }} title={sec.path.join(' › ')}>
              {name}
            </span>
            <span className="text-[10.5px] text-faint w-10">{count ? `${count}` : ''}</span>
            <div className="flex gap-1 flex-wrap">
              {areas.map((c) => {
                const on = direct === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => assign(name, on ? null : c.key)}
                    className={cx('h-6 px-2 rounded-full border text-[11px] flex items-center gap-1.5 transition-colors', on ? 'text-white border-transparent' : 'border-line text-muted hover:text-ink')}
                    style={on ? { background: c.color } : undefined}
                    title={on ? 'Click again to inherit from the parent heading' : `Assign to ${c.label}`}
                  >
                    {!on && <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />}
                    {c.label}
                  </button>
                )
              })}
            </div>
            {!direct && (
              <span className="text-[11px] text-faint ml-1 flex items-center gap-1">
                → <span className="w-2 h-2 rounded-full inline-block" style={{ background: resolvedCat?.color }} /> {resolvedCat?.label ?? 'Other'} {sec.path.length > 1 ? '(inherited)' : '(default)'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Pick container event titles from what's actually in the category's calendar. */
export function ContainerPicker({ cat, onChange }: { cat: CategoryPref; onChange: (containers: string[]) => void }) {
  const events = useStore((s) => s.state!.events)
  const counts = new Map<string, number>()
  for (const e of events) if (e.calendarName === cat.calendar && !e.allDay && !e.plannerBlockId) counts.set(e.title.trim(), (counts.get(e.title.trim()) ?? 0) + 1)
  const titles = [...new Set([...cat.containers, ...[...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t)])].slice(0, 14)
  if (!titles.length) return <span className="text-[11.5px] text-faint">Connect Google Calendar to pick from your “{cat.calendar}” events.</span>
  return (
    <div className="flex gap-1 flex-wrap">
      {titles.map((t) => {
        const on = cat.containers.includes(t)
        return (
          <button
            key={t}
            onClick={() => onChange(on ? cat.containers.filter((x) => x !== t) : [...cat.containers, t])}
            className={cx('h-6 px-2 rounded-md border text-[11px]', on ? 'text-white border-transparent' : 'border-line text-muted hover:text-ink')}
            style={on ? { background: cat.color } : undefined}
          >
            {t}
            {counts.get(t) ? <span className="opacity-60 ml-1">×{counts.get(t)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
