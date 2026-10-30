// jest.config.js sets TZ=America/Chicago, so the evening cases cross midnight UTC.
import { describe, it, expect } from '@jest/globals'
import { localToday, mondayOf } from '../lib/lookahead-dates'

describe('localToday', () => {
  it('is the local date, not the UTC date, in the evening (Central)', () => {
    // Mon 2026-11-02 8:30 PM CST = Tue 2026-11-03 02:30 UTC
    const evening = new Date(2026, 10, 2, 20, 30)
    expect(evening.toISOString().slice(0, 10)).toBe('2026-11-03')
    expect(localToday(evening)).toBe('2026-11-02')
    expect(mondayOf(localToday(evening))).toBe('2026-11-02')
  })

  it('Sunday evening stays in the week before', () => {
    // Sun 2026-11-08 9 PM CST = Mon 2026-11-09 03:00 UTC
    const sunday = new Date(2026, 10, 8, 21, 0)
    expect(localToday(sunday)).toBe('2026-11-08')
    expect(mondayOf(localToday(sunday))).toBe('2026-11-02')
  })

  it('pads month and day and defaults to now', () => {
    expect(localToday(new Date(2026, 0, 5, 9))).toBe('2026-01-05')
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
