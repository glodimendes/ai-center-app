import { isoDate } from '@shared/time'

/** The planning day rolls over at 04:00, so a late evening doesn't trigger tomorrow's re-plan. */
export const planningDay = (now: Date) => isoDate(new Date(now.getTime() - 4 * 3_600_000))

/**
 * The plan stays put during the day: a full re-plan only on demand, on the first plan of a planning
 * day, or when preferences changed. Everything else is incremental (blocks keep their place).
 */
export function needsFullPlan(o: { forced: boolean; hasPlan: boolean; lastFullDay: string; lastPrefsHash: string; now: Date; prefsHash: string }) {
  return o.forced || !o.hasPlan || o.lastFullDay !== planningDay(o.now) || o.lastPrefsHash !== o.prefsHash
}
