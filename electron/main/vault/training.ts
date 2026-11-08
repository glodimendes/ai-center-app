import type { TrainingPlan, TrainingSession } from '@shared/types'

export const TRAINING_FILE = '02_Projects/hybrid-training.md'

/** Upper bound of "60-70 min" / "25-30 min" / "40 min" style lengths. */
function minutesOf(text: string): number {
  const nums = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) : 60
}

/**
 * Reads the "Weekly Plan (7-day structure)" table and the "Day 7 three-week rotation"
 * list from the hybrid-training project brief.
 */
export function parseTrainingPlan(text: string): TrainingPlan | null {
  const lines = text.split(/\r?\n/)
  const days: TrainingSession[] = []
  let header: string[] | null = null
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (days.length) header = null
      continue
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (!header) {
      if (cells[0]?.toLowerCase() === 'day' && cells.some((c) => /session/i.test(c))) header = cells.map((c) => c.toLowerCase())
      continue
    }
    if (/^-+$/.test(cells[0].replace(/:/g, ''))) continue
    const day = Number(cells[0])
    if (!day) continue
    const get = (name: string) => cells[header!.indexOf(name)] ?? ''
    days.push({ day, session: get('session'), focus: get('focus'), minutes: minutesOf(get('length')) })
  }
  if (!days.length) return null

  const rotation: TrainingPlan['day7Rotation'] = []
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*Week\s*(\d)\s*:\s*(.+)$/i)
    if (!m) continue
    const label = m[2].trim()
    const rest = /full rest|^rest/i.test(label)
    const mins = label.match(/(\d+)\s*-\s*(\d+)\s*min/)
    rotation[Number(m[1]) - 1] = {
      label: label.split(/\s[—–-]\s/)[0],
      minutes: mins ? Number(mins[2]) : rest ? 0 : 60,
      rest
    }
  }
  return { days, day7Rotation: rotation.filter(Boolean) }
}

/** Session for a date given the cycle start (Day 1, rotation week 1). */
export function sessionFor(plan: TrainingPlan, cycleStart: string, date: Date): TrainingSession | null {
  const [y, m, d] = cycleStart.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const day0 = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((day0.getTime() - start.getTime()) / 86_400_000)
  const mod = (a: number, n: number) => ((a % n) + n) % n
  const dayNum = mod(diff, 7) + 1
  const base = plan.days.find((s) => s.day === dayNum)
  if (!base) return null
  if (dayNum === 7 && plan.day7Rotation.length) {
    const week = mod(Math.floor(diff / 7), plan.day7Rotation.length)
    const rot = plan.day7Rotation[week]
    if (rot.rest) return { ...base, session: 'Rest', focus: rot.label, minutes: 0, rest: true }
    return { ...base, session: rot.label, minutes: rot.minutes }
  }
  return base
}
