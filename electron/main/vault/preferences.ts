import { dump, load } from 'js-yaml'
import type { CategoryPref, Preferences } from '@shared/types'
import { TODOS_FILE, WEEKLY_DIR } from '@shared/paths'

/**
 * What a new vault starts with: generic areas that match the starter todo list (Work, Personal) plus Training.
 * Calendar names are placeholders: pick your own in Settings → Areas. Everything personal lives in the vault's
 * own preferences file (`PREFERENCES_FILE` in shared/paths.ts), which takes over from this the moment it exists.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  workingHours: {
    mon: ['08:00', '21:00'],
    tue: ['08:00', '21:00'],
    wed: ['08:00', '21:00'],
    thu: ['08:00', '21:00'],
    fri: ['08:00', '21:00'],
    sat: ['09:00', '19:00'],
    sun: ['09:00', '19:00']
  },
  slotMinutes: 15,
  minChunkMinutes: 30,
  bufferMinutes: 15,
  maxDeepWorkMinutesPerDay: 360,
  dailyMaxMinutes: { weekday: 480, weekend: 240 },
  maxTaskMinutesPerDay: 180,
  maxBlockMinutes: 180,
  deepWorkBufferMinutes: 30,
  trainingBufferMinutes: 30,
  deadlineSlackDays: 1,
  staleOverdueDays: 14,
  completedTaskMinutes: 15,
  strategy: { deadlineWeight: 2, priorityWeight: 1, deadlineGuardDays: 2, spreadDays: 5 },
  // Weekly hours per area are opt-in: switch it on and set the grid in the weekly review.
  allocation: { enabled: false, hours: {} },
  breaks: [
    { label: 'Lunch', window: ['12:00', '14:00'], minutes: 60 },
    { label: 'Dinner', window: ['19:00', '21:00'], minutes: 45 }
  ],
  horizonDays: 14,
  syncDays: 7,
  ignoreCalendars: ['Holidays'],
  protectedCalendars: ['Birthdays', 'Holidays'],
  categories: [
    {
      key: 'work',
      label: 'Work',
      headings: ['Work'],
      calendar: 'Planner',
      containers: [],
      defaultEstimateMinutes: 60,
      deepWork: true,
      window: ['08:00', '19:00'],
      preferredWindows: [['08:00', '12:30']],
      minBlockMinutes: 45,
      weight: 1.2,
      timing: 'asap',
      color: '#6366f1'
    },
    {
      key: 'personal',
      label: 'Personal',
      headings: ['Personal', 'Temporary Inbox'],
      calendar: 'Planner',
      containers: [],
      defaultEstimateMinutes: 30,
      window: ['09:00', '20:00'],
      preferredWindows: [['17:00', '20:00']],
      minBlockMinutes: 30,
      weight: 0.8,
      timing: 'asap',
      color: '#10b981'
    },
    {
      key: 'training',
      label: 'Training',
      headings: ['Training'],
      calendar: 'Planner',
      containers: [],
      defaultEstimateMinutes: 60,
      window: ['07:00', '21:30'],
      preferredWindows: [
        ['18:00', '21:00'],
        ['07:00', '09:00']
      ],
      minBlockMinutes: 30,
      weight: 1,
      timing: 'asap',
      wholeTasks: true,
      color: '#ef4444'
    },
    {
      key: 'other',
      label: 'Other',
      headings: [],
      calendar: 'Planner',
      containers: [],
      defaultEstimateMinutes: 30,
      color: '#94a3b8'
    }
  ],
  // Off until the user turns it on: shows the shape of a rule in Settings.
  dayRules: [{ id: 'half-day', label: 'Lighter half-day', enabled: false, when: 'pick', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], areas: [], maxMinutes: 0, from: '13:00' }],
  training: { category: 'training' }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parsePreferences(text: string): Preferences {
  const m = text.match(FRONTMATTER_RE)
  if (!m) return DEFAULT_PREFERENCES
  const data = (load(m[1]) ?? {}) as Partial<Preferences>
  return {
    ...DEFAULT_PREFERENCES,
    ...data,
    workingHours: { ...DEFAULT_PREFERENCES.workingHours, ...(data.workingHours ?? {}) },
    dailyMaxMinutes: { ...DEFAULT_PREFERENCES.dailyMaxMinutes, ...(data.dailyMaxMinutes ?? {}) },
    strategy: { ...DEFAULT_PREFERENCES.strategy, ...(data.strategy ?? {}) },
    allocation: { ...DEFAULT_PREFERENCES.allocation, ...(data.allocation ?? {}) },
    training: { category: data.training?.category ?? DEFAULT_PREFERENCES.training.category },
    dayRules: Array.isArray(data.dayRules) ? data.dayRules : DEFAULT_PREFERENCES.dayRules,
    categories: data.categories?.length ? data.categories.map((c) => migrateTraining(migrateCategory(c), data.training)) : DEFAULT_PREFERENCES.categories
  }
}

/** Older files planned training from a cycle with its own windows; it's an ordinary area now. */
function migrateTraining(c: CategoryPref, old: Partial<Preferences['training']> | undefined): CategoryPref {
  if (c.key !== (old?.category ?? DEFAULT_PREFERENCES.training.category) || c.window) return c
  const d = DEFAULT_PREFERENCES.categories.find((x) => x.key === 'training')!
  return { ...d, ...c, window: d.window, preferredWindows: c.preferredWindows ?? old?.preferredWindows ?? d.preferredWindows, minBlockMinutes: c.minBlockMinutes ?? d.minBlockMinutes, wholeTasks: c.wholeTasks ?? true }
}

/** Older files have one `preferredWindow`; the planner reads `preferredWindows`. */
function migrateCategory(c: CategoryPref): CategoryPref {
  const { preferredWindow, ...rest } = c
  if (rest.preferredWindows || !preferredWindow) return rest
  return { ...rest, preferredWindows: [preferredWindow] }
}

const BODY = `
# Planner Preferences

Read by the AI Center app to auto-schedule tasks. Edit here or in the app's Settings.

- \`workingHours\`: per weekday window the scheduler may use (\`null\` = day off).
- \`categories\`: how todo headings in \`${TODOS_FILE}\` map to categories. \`headings\` are case-insensitive substrings (deepest heading wins). \`calendar\` is the Google calendar blocks are written to; \`containers\` are existing event titles in that calendar that the planner fills with tasks instead of creating new blocks. \`budget\` sets weekly min/max hours.
- \`dayRules\`: rules for some days. \`when: weekdays\` applies on every listed weekday; \`when: pick\` on one of them per week (the one with the least calendar time; changeable per week in the weekly review). \`maxMinutes: 0\` keeps the listed \`areas\` (empty = all work areas) out between \`from\` and \`to\`; above 0 caps them for the day.
- \`training.category\`: the training area. Its tasks (e.g. under a Training heading, with \`repeat:\` rules) are planned like any other area's, with a gap around them and outside the daily work cap.
- Task lines may carry optional metadata: \`~2h\` estimate, \`due:2026-11-12\` or \`by 12/11\` deadline, \`!urgent\` / \`!high\` / \`!low\` priority.
- Weekly logs (planned vs actual time) live in \`${WEEKLY_DIR}/\`.
`

export function serializePreferences(prefs: Preferences, existing?: string): string {
  const front = `---\n${dump(prefs, { lineWidth: 120, flowLevel: 3 })}---\n`
  if (existing) {
    const m = existing.match(FRONTMATTER_RE)
    if (m) return front + existing.slice(m[0].length)
  }
  return front + BODY
}
