import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Routine } from '@shared/agents'
import { parseDays, parseTime } from '@shared/routines'

export { describeRoutine } from '@shared/routines'

/** The fields of a proposal, checked; throws a readable reason. */
export function checkRoutine(p: Record<string, unknown>): Pick<Routine, 'title' | 'prompt' | 'time' | 'days'> {
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim() : '')
  const [title, prompt, time, days] = [str('title'), str('prompt'), str('time'), str('days') || 'daily']
  if (!prompt) throw new Error('The routine has no prompt.')
  if (!parseTime(time)) throw new Error(`"${time}" is not a time like 07:30.`)
  if (!parseDays(days)) throw new Error(`"${days}" is not a day rule (daily, weekdays, weekends or e.g. mon,thu).`)
  return { title: title || prompt.slice(0, 60), prompt, time: time.padStart(5, '0'), days }
}

/**
 * Routines whose slot today has come and that haven't run since. A slot missed while the app was closed runs once
 * on the next tick (catch-up, today's only); a routine never fires for a slot before it was created.
 */
export function dueRoutines(list: Routine[], now: Date): Routine[] {
  return list.filter((r) => {
    const t = parseTime(r.time)
    if (r.paused || !t || !parseDays(r.days)?.includes(now.getDay())) return false
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.hour, t.minute).getTime()
    const last = Math.max(Date.parse(r.lastRun ?? '') || 0, Date.parse(r.createdAt) || 0)
    return now.getTime() >= slot && last < slot
  })
}

/** The routines file in app data. */
export class RoutineStore {
  private items: Routine[] = []
  constructor(private file: string) {
    try {
      if (existsSync(file)) this.items = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      /* unreadable: start empty */
    }
  }
  list = () => this.items
  add(r: Routine) {
    this.items.push(r)
    this.save()
  }
  update(id: string, patch: Partial<Routine>) {
    const r = this.items.find((x) => x.id === id)
    if (r) Object.assign(r, patch)
    this.save()
  }
  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id)
    this.save()
  }
  /** An agent was deleted: its routines go with it. */
  removeAgent(agentId: string) {
    this.items = this.items.filter((x) => x.agentId !== agentId)
    this.save()
  }
  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.items, null, 1))
    } catch {
      /* kept in memory */
    }
  }
}
