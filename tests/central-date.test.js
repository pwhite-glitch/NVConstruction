// todayCentral uses an explicit America/Chicago time zone, so these hold no matter
// what TZ the process runs in (Vercel servers run in UTC).
import { describe, it, expect } from '@jest/globals'
import { todayCentral, addDaysCentral, isBeforeTodayCentral } from '../lib/central-date'
import { localToday } from '../lib/lookahead-dates'

const at = iso => new Date(iso)

describe('todayCentral', () => {
  it('5:30 PM CST is still the same day', () => {
    expect(todayCentral(at('2026-11-04T23:30:00Z'))).toBe('2026-11-04')
  })

  it('11:30 PM CST stays on the Central date even though UTC is tomorrow', () => {
    const now = at('2026-11-05T05:30:00Z')
    expect(now.toISOString().slice(0, 10)).toBe('2026-11-05')
    expect(todayCentral(now)).toBe('2026-11-04')
  })

  it('rolls over at Central midnight (12:30 AM CST)', () => {
    expect(todayCentral(at('2026-11-05T06:30:00Z'))).toBe('2026-11-05')
  })

  it('uses CDT (UTC-5) during daylight saving time', () => {
    // 11:30 PM CDT Jul 14 = 04:30 UTC Jul 15
    expect(todayCentral(at('2026-07-15T04:30:00Z'))).toBe('2026-07-14')
    // 12:30 AM CDT Jul 15 = 05:30 UTC (would still be Jul 14 if CST were assumed)
    expect(todayCentral(at('2026-07-15T05:30:00Z'))).toBe('2026-07-15')
  })

  it('handles the fall-back and spring-forward days', () => {
    // Nov 1 2026: 1:30 AM CDT (06:30Z) and 1:30 AM CST (07:30Z) are both Nov 1
    expect(todayCentral(at('2026-11-01T06:30:00Z'))).toBe('2026-11-01')
    expect(todayCentral(at('2026-11-01T07:30:00Z'))).toBe('2026-11-01')
    // 11:30 PM CST Nov 1 = 05:30Z Nov 2
    expect(todayCentral(at('2026-11-02T05:30:00Z'))).toBe('2026-11-01')
    // Mar 8 2026: 11:30 PM CDT = 04:30Z Mar 9
    expect(todayCentral(at('2026-03-09T04:30:00Z'))).toBe('2026-03-08')
  })

  it('crosses year boundaries and defaults to now', () => {
    expect(todayCentral(at('2027-01-01T05:59:00Z'))).toBe('2026-12-31')
    expect(todayCentral(at('2027-01-01T06:00:00Z'))).toBe('2027-01-01')
    expect(todayCentral()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('localToday is the same value', () => {
    for (const iso of ['2026-11-04T23:30:00Z', '2026-11-05T05:30:00Z', '2026-11-05T06:30:00Z', '2026-07-15T04:30:00Z']) {
      expect(localToday(at(iso))).toBe(todayCentral(at(iso)))
    }
  })
})

describe('addDaysCentral', () => {
  it('counts from the Central date, not the UTC date', () => {
    const evening = at('2026-11-05T05:30:00Z') // Nov 4 11:30 PM CST
    expect(addDaysCentral(0, evening)).toBe('2026-11-04')
    expect(addDaysCentral(14, evening)).toBe('2026-11-18')
    expect(addDaysCentral(-4, evening)).toBe('2026-10-31')
  })
})

describe('isBeforeTodayCentral', () => {
  const evening = at('2026-11-05T05:30:00Z') // Nov 4 11:30 PM CST
  it('a due date of today is not overdue, even late in the evening', () => {
    expect(isBeforeTodayCentral('2026-11-04', evening)).toBe(false)
    expect(isBeforeTodayCentral('2026-11-05', evening)).toBe(false)
    expect(isBeforeTodayCentral('2026-11-03', evening)).toBe(true)
  })
  it('ignores empty values and the time part of timestamps', () => {
    expect(isBeforeTodayCentral(null, evening)).toBe(false)
    expect(isBeforeTodayCentral('', evening)).toBe(false)
    expect(isBeforeTodayCentral('2026-11-04T01:00:00Z', evening)).toBe(false)
  })
})
