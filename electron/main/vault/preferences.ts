import { dump, load } from 'js-yaml'
import type { Preferences } from '@shared/types'

export const PREFERENCES_FILE = '05_Tasks/planner/preferences.md'

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
  strategy: { deadlineWeight: 2, priorityWeight: 1, deadlineGuardDays: 2, spreadDays: 5 },
  allocation: {
    enabled: true,
    hours: {
      thesis: { mon: 4, tue: 2, wed: 4, thu: 2, fri: 4, sat: 2 },
      courses: { mon: 2, tue: 3, wed: 1, thu: 3, fri: 1 },
      outside: { mon: 1, tue: 1, wed: 2, thu: 1, fri: 2, sat: 1 },
      personal: { mon: 0.5, tue: 0.5, wed: 0.5, thu: 0.5, fri: 0.5, sat: 1, sun: 1 }
    }
  },
  breaks: [
    { label: 'Lunch', window: ['12:00', '14:00'], minutes: 60 },
    { label: 'Dinner', window: ['19:00', '21:00'], minutes: 45 }
  ],
  horizonDays: 14,
  syncDays: 7,
  ignoreCalendars: ['Holidays in Switzerland', 'Feriados no Brasil'],
  protectedCalendars: ['Birthdays', 'ETH Classes', 'ETH Tests', 'Family'],
  categories: [
    {
      key: 'thesis',
      label: 'Thesis',
      headings: ['Thesis'],
      calendar: 'Study Schedule',
      containers: ['Thesis Deep Work'],
      defaultEstimateMinutes: 90,
      deepWork: true,
      window: ['08:00', '19:00'],
      budget: { minHours: 18, maxHours: 22 },
      preferredWindow: ['08:00', '12:30'],
      minBlockMinutes: 60,
      weight: 1.5,
      timing: 'asap',
      reserveQuota: true,
      color: '#6366f1'
    },
    {
      key: 'courses',
      label: 'Courses',
      headings: ['AI in Education', 'RTAI', 'DMS'],
      calendar: 'Study Schedule',
      containers: ['Course Consolidation'],
      defaultEstimateMinutes: 60,
      deepWork: true,
      window: ['08:00', '20:00'],
      preferredWindow: ['13:30', '17:30'],
      minBlockMinutes: 45,
      weight: 1.2,
      timing: 'asap',
      reserveQuota: false,
      color: '#0ea5e9'
    },
    {
      key: 'outside',
      label: 'Outside work',
      headings: ['Work', 'Mentoria', 'BRASA', 'Tamanduá', 'Masters'],
      calendar: 'Study Schedule',
      containers: ['Outside Work'],
      defaultEstimateMinutes: 30,
      window: ['08:00', '21:00'],
      budget: { maxHours: 12 },
      preferredWindow: ['14:00', '19:00'],
      minBlockMinutes: 30,
      weight: 1,
      timing: 'asap',
      reserveQuota: false,
      color: '#f59e0b'
    },
    {
      key: 'personal',
      label: 'Personal',
      headings: ['Personal', 'Temporary Inbox'],
      calendar: 'Personal',
      containers: [],
      defaultEstimateMinutes: 15,
      window: ['09:00', '20:00'],
      preferredWindow: ['17:00', '20:00'],
      minBlockMinutes: 30,
      weight: 0.8,
      timing: 'asap',
      reserveQuota: false,
      color: '#10b981'
    },
    {
      key: 'training',
      label: 'Training',
      headings: ['Training'],
      calendar: 'Sports',
      containers: ['Sport', 'Running'],
      defaultEstimateMinutes: 60,
      color: '#ef4444'
    },
    {
      key: 'other',
      label: 'Other',
      headings: [],
      calendar: 'Personal',
      containers: [],
      defaultEstimateMinutes: 30,
      color: '#94a3b8'
    }
  ],
  training: {
    category: 'training',
    cycleStart: '2026-11-02',
    preferredWindows: [
      ['18:00', '21:00'],
      ['07:00', '09:00']
    ]
  }
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
    training: { ...DEFAULT_PREFERENCES.training, ...(data.training ?? {}) },
    categories: data.categories?.length ? data.categories : DEFAULT_PREFERENCES.categories
  }
}

const BODY = `
# Planner Preferences

Read by the AI Center Planner app to auto-schedule tasks. Edit here or in the app's Settings.

- \`workingHours\`: per weekday window the scheduler may use (\`null\` = day off).
- \`categories\`: how todo headings in \`05_Tasks/daily-todos.md\` map to categories. \`headings\` are case-insensitive substrings (deepest heading wins). \`calendar\` is the Google calendar blocks are written to; \`containers\` are existing event titles in that calendar that the planner fills with tasks instead of creating new blocks. \`budget\` sets weekly min/max hours.
- \`training\`: \`cycleStart\` is a date that was Day 1 of the 7-day cycle in \`02_Projects/hybrid-training.md\` and week 1 of the Day 7 rotation.
- Task lines may carry optional metadata: \`~2h\` estimate, \`due:2026-11-12\` or \`by 12/11\` deadline, \`!high\` / \`!low\` priority.
- Weekly logs (planned vs actual time) live in \`05_Tasks/weekly/\`.
`

export function serializePreferences(prefs: Preferences, existing?: string): string {
  const front = `---\n${dump(prefs, { lineWidth: 120, flowLevel: 3 })}---\n`
  if (existing) {
    const m = existing.match(FRONTMATTER_RE)
    if (m) return front + existing.slice(m[0].length)
  }
  return front + BODY
}
