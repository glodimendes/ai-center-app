import { AlertTriangle, Check, Circle, Wrench, X } from 'lucide-react'
import type { AppState } from '@shared/api'
import type { SetupCheck } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button } from './ui'

type SettingsPage = 'general' | 'calendar' | 'engines' | 'areas'

/** Opens Settings on a subpage (Settings remembers its page per device). */
export function useOpenSettings() {
  const go = useStore((s) => s.go)
  return (page: SettingsPage) => {
    try {
      localStorage.setItem('settings-page', page)
    } catch {
      /* opens on its last page instead */
    }
    go('settings')
  }
}

/** Identifies one check result, so a dismissed result stays hidden until it changes (another file goes missing). */
export const setupSignature = (c: SetupCheck) => (c.missing.length ? JSON.stringify(c.missing) : '')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The framework check with its action: Settings → General and the Setup dialog. */
export function SetupStatus({ compact = false }: { compact?: boolean }) {
  const c = useStore((st) => st.state)!.setup.check
  if (c.otherLayout)
    return (
      <p className="text-[12px] text-warn flex gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        This folder uses another layout (numbered folders such as <code>05_Tasks</code>). AI Center doesn't map other layouts yet, so nothing was added; rename the folders to the layout in the README to use it.
      </p>
    )
  return (
    <div className="space-y-2 text-[12.5px]">
      {c.added.length > 0 && <p className="text-ok">Added {plural(c.added.length, 'framework file')}: {c.added.join(', ')}. Your own files were left as they were.</p>}
      {!c.missing.length && !c.added.length && <p className="text-muted">{compact ? 'This folder already has everything AI Center needs.' : 'Everything AI Center needs is in this vault.'}</p>}
      {c.missing.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="flex-1 min-w-0">
            Missing: <span className="text-muted">{c.missing.join(', ')}</span>
          </span>
          <Button onClick={() => act(api.applySetup(), 'Framework files added')}>Add {plural(c.missing.length, 'file')}</Button>
        </div>
      )}
    </div>
  )
}

interface Step {
  key: string
  label: string
  done: boolean
  hint: string
  action?: { label: string; run: () => void }
}

export function checklistSteps(s: AppState, openSettings: (p: SettingsPage) => void, go: (v: 'today' | 'agents') => void): Step[] {
  const c = s.setup.check
  return [
    {
      key: 'vault',
      label: 'Vault framework',
      done: !c.missing.length && !c.otherLayout,
      hint: c.otherLayout ? 'This vault uses another layout, which isn’t supported yet.' : 'The entry point, the rules AI follows, and your context and task files.',
      action: c.missing.length ? { label: 'Add missing files', run: () => void act(api.applySetup(), 'Framework files added') } : undefined
    },
    { key: 'ai', label: 'An AI tool', done: s.agents.cli.some((x) => x.version), hint: 'Claude Code, Codex, Antigravity or Ollama, logged in.', action: { label: 'Engines & accounts', run: () => openSettings('engines') } },
    { key: 'calendar', label: 'Calendar connected', done: s.calendar.connected, hint: 'So the planner sees your free time.', action: { label: 'Connect', run: () => openSettings('calendar') } },
    { key: 'areas', label: 'Areas set', done: s.vault.preferencesFileExists, hint: 'Map your todo headings to areas and save your preferences.', action: { label: 'Set areas', run: () => openSettings('areas') } },
    { key: 'sync', label: 'First sync', done: s.setup.synced, hint: 'Put the planned blocks into your calendar (you confirm every change).', action: { label: 'Open Today', run: () => go('today') } },
    { key: 'agent', label: 'Your first agent', done: s.agents.agents.some((a) => !a.builtin), hint: 'Add a sample or write your own.', action: { label: 'Agents', run: () => go('agents') } }
  ]
}

/** Home: what's left to set up. Disappears when everything is done, or when dismissed. */
export function SetupChecklist() {
  const s = useStore((st) => st.state)!
  const go = useStore((st) => st.go)
  const openSettings = useOpenSettings()
  if (s.settings.checklistDismissed) return null
  const steps = checklistSteps(s, openSettings, go)
  const left = steps.filter((x) => !x.done).length
  if (!left) return null
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 @max-3xl:p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-accent-soft text-accent">
          <Wrench size={14} />
        </span>
        <h2 className="flex-1 text-[14px] font-semibold">
          Get set up <span className="text-faint font-normal">· {steps.length - left} of {steps.length} done</span>
        </h2>
        <Button kind="ghost" onClick={() => act(api.saveSettings({ checklistDismissed: true }))} title="Hide this checklist (Settings → General shows the vault check)">
          <X size={13} />
        </Button>
      </div>
      <ul className="space-y-1.5">
        {steps.map((x) => (
          <li key={x.key} className="flex items-center gap-2 text-[12.5px]">
            <span className={cx('shrink-0', x.done ? 'text-ok' : 'text-faint')}>{x.done ? <Check size={14} /> : <Circle size={14} />}</span>
            <span className={cx('font-medium', x.done && 'text-muted line-through')}>{x.label}</span>
            {!x.done && <span className="flex-1 min-w-0 truncate text-muted">{x.hint}</span>}
            {!x.done && x.action && (
              <Button kind="ghost" onClick={x.action.run} className="text-accent">
                {x.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Home: the setup check (run at every start, so after every update) when the checklist is hidden. Dismissed per result. */
export function SetupNotice() {
  const s = useStore((st) => st.state)!
  const openSettings = useOpenSettings()
  const c = s.setup.check
  const sig = setupSignature(c)
  if (!sig || sig === s.settings.setupCheckDismissed || !s.settings.checklistDismissed) return null
  return (
    <div className="rounded-lg bg-accent-soft px-4 py-2.5 text-[12.5px] flex items-center gap-2 flex-wrap">
      <Wrench size={14} className="text-accent shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="font-medium">Setup check:</span> {plural(c.missing.length, 'framework file')} missing ({c.missing.join(', ')}).
      </span>
      <Button onClick={() => act(api.applySetup(), 'Framework files added')}>Add</Button>
      <Button kind="ghost" onClick={() => openSettings('general')}>
        Review
      </Button>
      <Button kind="ghost" onClick={() => act(api.saveSettings({ setupCheckDismissed: sig }))} title="Hide until the result changes">
        <X size={13} />
      </Button>
    </div>
  )
}
