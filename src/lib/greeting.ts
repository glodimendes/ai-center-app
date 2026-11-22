// Home greeting: a time-of-day band plus a line picked from that band's pool. The pick is seeded by the date and band, so it stays put while you look at it and changes tomorrow.
export type Band = 'late-night' | 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'

export function bandOf(hour: number): Band {
  if (hour < 4) return 'late-night'
  if (hour < 7) return 'early'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

const POOLS: Record<Band, string[]> = {
  'late-night': [
    'Still up?', 'The night shift again', 'Past midnight: future you has notes', 'Sleep is also a deadline',
    'Quiet hours, loud ideas', 'Shouldn\'t you be asleep?', 'Night owl mode', 'Even the plan wants you to rest'
  ],
  early: [
    'Early start', 'Up before the coffee', 'Good early morning', 'The day is still empty. Enjoy it',
    'Rise and plan', 'Fresh day, no emails yet'
  ],
  morning: [
    'Good morning', 'Morning', 'Good morning. Coffee first, then the plan', 'A fresh slate', 'Morning, let\'s make it count',
    'Good morning, the day is yours to shape', 'Hello, morning person (or at least morning attendee)'
  ],
  midday: [
    'Good day', 'Midday check-in', 'Halfway through the day: lunch counts as a task', 'Good midday', 'Time to refuel?',
    'Noon: the best moment to re-plan'
  ],
  afternoon: [
    'Good afternoon', 'Afternoon', 'Second wind time', 'The afternoon stretch', 'Still plenty of day left',
    'Good afternoon, the focus hours are yours'
  ],
  evening: [
    'Good evening', 'Evening', 'Winding down, or one more block?', 'Good evening, time to close the loops',
    'The day is nearly done: log what happened', 'Evening, the calendar can rest soon'
  ],
  night: [
    'Good night soon', 'Late evening', 'Last call for tomorrow\'s plan', 'Close the laptop soon', 'Night mode: wrap up and rest',
    'One last look, then sleep'
  ]
}

// Day-specific lines are added to the pool on their weekday (0 = Sunday), so Mondays and Fridays feel different.
const WEEKDAY: Partial<Record<number, string[]>> = {
  1: ['Monday: the week is still unwritten', 'New week, new plan'],
  3: ['Midweek: the hump day'],
  5: ['Friday: nearly there', 'Last stretch of the week'],
  6: ['Saturday, no calendar guilt required'],
  0: ['Sunday: plan lightly, rest properly']
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function greetingFor(now: Date, localDay: string) {
  const band = bandOf(now.getHours())
  const pool = [...POOLS[band], ...(band === 'morning' || band === 'midday' ? WEEKDAY[now.getDay()] ?? [] : [])]
  return pool[hash(`${localDay}|${band}`) % pool.length]
}
