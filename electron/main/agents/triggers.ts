import type { AgentDef } from '@shared/agents'

/** What an agent's `triggers:` strings mean. Pure: the app owns the timer and the watcher. */
export type Trigger = { kind: 'manual' } | { kind: 'schedule'; hour: number; minute: number } | { kind: 'on-open' } | { kind: 'file-watch'; glob: string }

/** Day boundary of the planning day, like scheduler/cadence.ts (04:00): an "on-open" agent runs once per planning day. */
const DAY_START_HOUR = 4

export function parseTrigger(text: string): Trigger | null {
  const t = text.trim()
  if (t === 'manual') return { kind: 'manual' }
  if (t === 'on-open') return { kind: 'on-open' }
  const sched = t.match(/^schedule:\s*(\d{1,2}):(\d{2})$/)
  if (sched) {
    const [hour, minute] = [Number(sched[1]), Number(sched[2])]
    return hour < 24 && minute < 60 ? { kind: 'schedule', hour, minute } : null
  }
  const watch = t.match(/^file-watch:\s*(\S.*)$/)
  if (watch) return { kind: 'file-watch', glob: watch[1].trim() }
  return null
}

export const triggersOf = (a: AgentDef): Trigger[] => a.triggers.map(parseTrigger).filter((t): t is Trigger => t !== null)

/** Start of the planning day containing `d`. */
export function planningDayStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR)
  return d < s ? new Date(s.getTime() - 86_400_000) : s
}

export type TickEvent = 'tick' | 'open'

/**
 * Agents whose schedule or on-open trigger is due. `lastFired` is when each agent was last started by a trigger or by
 * hand (ms). A schedule that was missed while the app was closed runs once on the next tick (catch-up), never more.
 */
export function dueAgents(defs: AgentDef[], lastFired: Record<string, number>, now: Date, event: TickEvent): string[] {
  const out: string[] = []
  for (const a of defs) {
    const last = lastFired[a.id] ?? 0
    for (const t of triggersOf(a)) {
      if (t.kind === 'schedule') {
        const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute)
        if (now >= slot && last < slot.getTime()) out.push(a.id)
      } else if (t.kind === 'on-open' && event === 'open' && last < planningDayStart(now).getTime()) out.push(a.id)
      if (out.includes(a.id)) break
    }
  }
  return out
}

/** Glob with `*` (not across folders), `**` (across folders) and `?`, matched against a vault-relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Agents with a file-watch glob matching the changed path. Paths the app and agents write themselves never match. */
export function watchMatches(defs: AgentDef[], relPath: string, ignore: (p: string) => boolean): string[] {
  if (ignore(relPath)) return []
  return defs.filter((a) => triggersOf(a).some((t) => t.kind === 'file-watch' && globToRegExp(t.glob).test(relPath))).map((a) => a.id)
}
