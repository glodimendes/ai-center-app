import { describe, expect, it } from 'vitest'
import { bandOf, greetingFor } from '../src/lib/greeting'

describe('greeting', () => {
  it('separates late night from the rest of the day', () => {
    expect([0, 3, 5, 9, 12, 15, 19, 23].map(bandOf)).toEqual(['late-night', 'late-night', 'early', 'morning', 'midday', 'afternoon', 'evening', 'night'])
  })
  it('is stable within a day and band', () => {
    const a = new Date(2026, 10, 23, 9, 0), b = new Date(2026, 10, 23, 10, 30)
    expect(greetingFor(a, '2026-11-23')).toBe(greetingFor(b, '2026-11-23'))
  })
  it('varies across days', () => {
    const lines = new Set(Array.from({ length: 14 }, (_, i) => greetingFor(new Date(2026, 10, 1 + i, 2, 0), `2026-11-${i + 1}`)))
    expect(lines.size).toBeGreaterThan(3)
  })
})
