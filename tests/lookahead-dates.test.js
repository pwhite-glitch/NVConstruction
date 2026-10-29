import { describe, it, expect } from '@jest/globals'
import {
  addDays, mondayOf, lookaheadDays, activityOnDay, activitiesForDay, activitiesInDays, workingDaysOf,
  workingDaysBetween, addWorkingDays, shiftActivity, moveActivityTo, rangeLabel, dayOfRange, planCopyForward,
} from '../lib/lookahead-dates'

// Mon 2026-11-02 .. Fri 2026-11-13
const MON = '2026-11-02'

describe('working days', () => {
  it('lookaheadDays is the 10 weekdays from the Monday', () => {
    const days = lookaheadDays(MON)
    expect(days).toHaveLength(10)
    expect(days[0]).toBe('2026-11-02')
    expect(days[4]).toBe('2026-11-06')
    expect(days[5]).toBe('2026-11-09')
    expect(days[9]).toBe('2026-11-13')
  })

  it('mondayOf', () => {
    expect(mondayOf('2026-11-04')).toBe(MON)
    expect(mondayOf('2026-11-08')).toBe(MON) // Sunday belongs to the week before
    expect(mondayOf(MON)).toBe(MON)
  })

  it('addWorkingDays skips weekends both ways', () => {
    expect(addWorkingDays('2026-11-06', 1)).toBe('2026-11-09')
    expect(addWorkingDays('2026-11-09', -1)).toBe('2026-11-06')
    expect(addWorkingDays('2026-11-04', 0)).toBe('2026-11-04')
  })

  it('workingDaysBetween', () => {
    expect(workingDaysBetween('2026-11-05', '2026-11-10')).toBe(3)
    expect(workingDaysBetween('2026-11-10', '2026-11-05')).toBe(-3)
    expect(workingDaysBetween(MON, MON)).toBe(0)
  })
})

describe('multi-day activities', () => {
  const single = { id: 's', planned_date: '2026-11-04', end_date: null }
  const multi = { id: 'm', planned_date: '2026-11-05', end_date: '2026-11-10' } // Thu..Tue across a weekend

  it('a single-day activity (end = start or null) shows on one day', () => {
    expect(workingDaysOf(single)).toEqual(['2026-11-04'])
    expect(workingDaysOf({ ...single, end_date: '2026-11-04' })).toEqual(['2026-11-04'])
    expect(rangeLabel(single)).toBeNull()
  })

  it('shows on every working day in its range, not the weekend', () => {
    expect(workingDaysOf(multi)).toEqual(['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'])
    expect(activityOnDay(multi, '2026-11-07')).toBe(false)
    expect(activitiesForDay([single, multi], '2026-11-09').map(a => a.id)).toEqual(['m'])
    expect(activitiesForDay([single, multi], '2026-11-04').map(a => a.id)).toEqual(['s'])
  })

  it('counts each activity once per week', () => {
    const days = lookaheadDays(MON)
    expect(activitiesInDays([single, multi], days.slice(0, 5)).map(a => a.id)).toEqual(['s', 'm'])
    expect(activitiesInDays([single, multi], days.slice(5)).map(a => a.id)).toEqual(['m'])
  })

  it('labels', () => {
    expect(rangeLabel(multi)).toMatch(/4 days$/)
    expect(dayOfRange(multi, '2026-11-09')).toBe('Day 3 of 4')
    expect(dayOfRange(single, '2026-11-04')).toBeNull()
  })

  it('drag: dropping day 1 of a range one day later moves the whole range', () => {
    expect(shiftActivity(multi, '2026-11-05', '2026-11-06')).toEqual({ planned_date: '2026-11-06', end_date: '2026-11-11' })
  })

  it('drag: dropping the Monday card back to Friday moves by one working day', () => {
    expect(shiftActivity(multi, '2026-11-09', '2026-11-06')).toEqual({ planned_date: '2026-11-04', end_date: '2026-11-09' })
  })

  it('drag a single-day activity', () => {
    expect(shiftActivity(single, '2026-11-04', '2026-11-12')).toEqual({ planned_date: '2026-11-12', end_date: null })
  })

  it('Move to day keeps the working-day length', () => {
    expect(moveActivityTo(multi, '2026-11-11')).toEqual({ planned_date: '2026-11-11', end_date: '2026-11-16' })
    expect(moveActivityTo(single, '2026-11-09')).toEqual({ planned_date: '2026-11-09', end_date: null })
  })
})

describe('planCopyForward (Copy from last week)', () => {
  const THIS = '2026-11-09'
  const base = { description: 'Frame walls', responsible_type: 'own_crew', manpower: 4, lookahead_id: 'prev' }
  const prev = [
    { ...base, id: 'p1', planned_date: '2026-11-03', status: 'in_progress' }, // Tue last week -> Tue this week
    { ...base, id: 'p2', description: 'Pour slab', planned_date: '2026-11-04', status: 'done' }, // finished: skipped
    { ...base, id: 'p3', description: 'Set steel', planned_date: '2026-11-10', status: 'not_started' }, // already this week: kept
    { ...base, id: 'p4', description: 'Grade lot', planned_date: '2026-11-05', end_date: '2026-11-11', status: 'delayed' }, // spans into this week
    { ...base, id: 'p5', description: 'Old item', planned_date: '2026-11-06' }, // no status (before migration 035)
  ]

  it('carries unfinished work to the matching days', () => {
    const rows = planCopyForward(prev, [], THIS)
    expect(rows.map(r => [r.carried_from_id, r.planned_date, r.end_date, r.status])).toEqual([
      ['p1', '2026-11-10', null, 'in_progress'],
      ['p3', '2026-11-10', null, 'not_started'],
      ['p4', '2026-11-09', '2026-11-11', 'delayed'],
      ['p5', '2026-11-13', null, 'not_started'],
    ])
  })

  it('copies the work details but not the id or old lookahead', () => {
    const [row] = planCopyForward(prev, [], THIS)
    expect(row).toMatchObject({ description: 'Frame walls', responsible_type: 'own_crew', manpower: 4 })
    expect(row).not.toHaveProperty('id')
    expect(row).not.toHaveProperty('lookahead_id')
  })

  it('moves a multi-day activity entirely in last week by one week', () => {
    const rows = planCopyForward([{ ...base, id: 'x', planned_date: '2026-11-02', end_date: '2026-11-04' }], [], THIS)
    expect(rows[0]).toMatchObject({ planned_date: '2026-11-09', end_date: '2026-11-11' })
  })

  it('pressing it twice copies nothing new', () => {
    const first = planCopyForward(prev, [], THIS).map((r, i) => ({ ...r, id: `n${i}` }))
    expect(planCopyForward(prev, first, THIS)).toEqual([])
  })

  it('before migration 035 (no carried_from_id) it still skips same description on same day', () => {
    const existing = planCopyForward(prev, [], THIS).map(({ carried_from_id, ...r }) => r)
    expect(planCopyForward(prev, existing, THIS)).toEqual([])
  })

  it('skips blank descriptions', () => {
    expect(planCopyForward([{ ...base, id: 'b', description: '  ', planned_date: '2026-11-03' }], [], THIS)).toEqual([])
  })
})

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})
