// Date logic for the 2-week lookahead: working days, multi-day activities,
// moving/shifting, and Copy from last week. Dates are 'YYYY-MM-DD' strings;
// all math is done at UTC noon so time zones never move a day.
import { cleanActivity, copyableActivity } from './lookahead-fields'

const toDate = s => new Date(s + 'T12:00:00Z')
const iso = d => d.toISOString().slice(0, 10)

export function addDays(s, n) {
  const d = toDate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

export function isWorkingDay(s) {
  const dow = toDate(s).getUTCDay()
  return dow !== 0 && dow !== 6
}

// Monday of the week containing s.
export function mondayOf(s) {
  const dow = toDate(s).getUTCDay()
  return addDays(s, dow === 0 ? -6 : 1 - dow)
}

// The lookahead's 10 working days starting at weekStart (a Monday).
export function lookaheadDays(weekStart) {
  const days = []
  for (let i = 0; days.length < 10 && i < 20; i++) {
    const d = addDays(weekStart, i)
    if (isWorkingDay(d)) days.push(d)
  }
  return days
}

export const activityEnd = act => (act.end_date && act.end_date > act.planned_date ? act.end_date : act.planned_date)

export const activityOnDay = (act, day) => isWorkingDay(day) && day >= act.planned_date && day <= activityEnd(act)

export const activitiesForDay = (acts, day) => (acts || []).filter(a => activityOnDay(a, day))

// Activities with at least one working day inside days (each counted once).
export function activitiesInDays(acts, days) {
  const set = new Set(days)
  return (acts || []).filter(a => workingDaysOf(a).some(d => set.has(d)))
}

// Every working day an activity covers.
export function workingDaysOf(act) {
  const out = []
  const end = activityEnd(act)
  for (let d = act.planned_date, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
    if (isWorkingDay(d)) out.push(d)
  }
  return out
}

// Signed number of working days to move from a to b (both working days in practice).
export function workingDaysBetween(a, b) {
  if (a === b) return 0
  const step = b > a ? 1 : -1
  let n = 0
  for (let d = a, i = 0; d !== b && i < 400; i++) {
    d = addDays(d, step)
    if (isWorkingDay(d)) n += step
  }
  return n
}

// Move n working days from s (n may be negative). A weekend start lands on the
// next working day in the direction of travel.
export function addWorkingDays(s, n) {
  if (n === 0) return s
  const step = n > 0 ? 1 : -1
  let d = s
  for (let left = Math.abs(n), i = 0; left > 0 && i < 400; i++) {
    d = addDays(d, step)
    if (isWorkingDay(d)) left--
  }
  return d
}

// Drag on the PM grid: the card for day fromDay was dropped on toDay. The whole
// range moves by the same number of working days.
export function shiftActivity(act, fromDay, toDay) {
  const delta = workingDaysBetween(fromDay, toDay)
  return {
    planned_date: addWorkingDays(act.planned_date, delta),
    end_date: act.end_date && act.end_date > act.planned_date ? addWorkingDays(act.end_date, delta) : null,
  }
}

// "Move to day" in the field app: start on newStart, keep the working-day length.
export function moveActivityTo(act, newStart) {
  const len = workingDaysBetween(act.planned_date, activityEnd(act))
  return { planned_date: newStart, end_date: len > 0 ? addWorkingDays(newStart, len) : null }
}

const shortDate = s => toDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

// "Mon 11/2 – Wed 11/4 · 3 days", or null for a one-day activity.
export function rangeLabel(act) {
  const end = activityEnd(act)
  if (end === act.planned_date) return null
  const n = workingDaysOf(act).length
  return `${shortDate(act.planned_date)} – ${shortDate(end)} · ${n} day${n === 1 ? '' : 's'}`
}

// "Day 2 of 3" for the card shown on one day of a multi-day activity.
export function dayOfRange(act, day) {
  const days = workingDaysOf(act)
  if (days.length < 2) return null
  const i = days.indexOf(day)
  return i < 0 ? null : `Day ${i + 1} of ${days.length}`
}

// Copy from last week. prevActs are last week's lookahead activities, existing
// are the ones already on this week's lookahead (weekStart). Returns rows to insert
// (without lookahead_id):
// - only unfinished work (status not Done)
// - an activity whose dates are still ahead (on or after weekStart) keeps them;
//   one that has started keeps its end and starts on weekStart; one entirely in
//   last week moves to the same weekday this week
// - nothing copied twice: skips items already carried (carried_from_id) and,
//   before migration 035, items with the same description on the same day
export function planCopyForward(prevActs, existing, weekStart) {
  const carried = new Set((existing || []).map(a => a.carried_from_id).filter(Boolean))
  const sig = a => `${(a.description || '').trim().toLowerCase()}|${a.planned_date}`
  const have = new Set((existing || []).map(sig))
  const out = []
  for (const a of prevActs || []) {
    if (a.status === 'done' || carried.has(a.id) || !a.description?.trim()) continue
    const end = activityEnd(a)
    let planned_date, end_date
    if (a.planned_date >= weekStart) {
      planned_date = a.planned_date
      end_date = a.end_date || null
    } else if (end >= weekStart) {
      planned_date = isWorkingDay(weekStart) ? weekStart : addWorkingDays(weekStart, 1)
      end_date = end
    } else {
      planned_date = addDays(a.planned_date, 7)
      end_date = a.end_date ? addDays(a.end_date, 7) : null
    }
    const row = cleanActivity({ ...copyableActivity(a), status: a.status || 'not_started', planned_date, end_date, carried_from_id: a.id })
    if (have.has(sig(row))) continue
    have.add(sig(row))
    out.push(row)
  }
  return out
}
