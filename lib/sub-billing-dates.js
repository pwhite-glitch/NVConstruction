// Subcontractor pay-app submission due dates from a job's sub billing settings
// (jobs.sub_billing_start / sub_billing_frequency / sub_billing_due / sub_billing_anchor).
// Pure, no imports beyond the Central-date helper: used by the Exhibit B billing schedule
// (lib/exhibit-b-pdf.js) in the browser and by tests. Dates are 'YYYY-MM-DD' calendar
// dates in America/Chicago; nothing here depends on the machine's time zone.
//
//   sub_billing_frequency  'weekly' | 'biweekly' | 'monthly' (blank → monthly)
//   sub_billing_due        monthly: day of month 1–31; weekly / biweekly: weekday 0 (Sun) – 6 (Sat)
//   sub_billing_start      first billing due date (no date before it is listed)
//   sub_billing_anchor     bi-weekly cycle anchor (falls back to sub_billing_start)

import { todayCentral } from './central-date'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const FREQUENCY_LABELS = { weekly: 'Weekly', biweekly: 'Bi-weekly (every other week)', monthly: 'Monthly' }

const dateOnly = v => {
  const s = String(v ?? '').slice(0, 10)
  if (!DATE_RE.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}
const toUtc = s => new Date(s + 'T00:00:00Z')
const iso = d => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = toUtc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const intOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)))

export function normalizeFrequency(f) {
  const v = String(f || '').trim().toLowerCase().replace(/[\s_-]/g, '')
  return v === 'weekly' ? 'weekly' : v === 'biweekly' ? 'biweekly' : 'monthly'
}

export function ordinal(n) {
  const s = n % 10, h = n % 100
  return n + (h >= 11 && h <= 13 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th')
}

// The settings in one shape: { frequency, dueDay (monthly) | weekday (weekly/bi-weekly), start, anchor }.
// Missing due day / weekday is taken from the start (or anchor) date when there is one.
export function subBillingSettings(job = {}) {
  const frequency = normalizeFrequency(job.sub_billing_frequency)
  const start = dateOnly(job.sub_billing_start)
  const anchor = dateOnly(job.sub_billing_anchor) || start
  const due = intOrNull(job.sub_billing_due)
  const ref = start || anchor
  if (frequency === 'monthly') {
    const dueDay = due !== null && due >= 1 && due <= 31 ? due : ref ? Number(ref.slice(8, 10)) : null
    return { frequency, dueDay, start, anchor }
  }
  const weekday = due !== null && due >= 0 && due <= 6 ? due : ref ? toUtc(ref).getUTCDay() : null
  return { frequency, weekday, start, anchor }
}

// Plain-English cadence, e.g. "The 15th of each month", "Every other Friday".
export function cadenceLabel(settings) {
  const s = settings || {}
  if (s.frequency === 'monthly') return s.dueDay ? `The ${ordinal(s.dueDay)} of each month${s.dueDay > 28 ? ' (or the last day of shorter months)' : ''}` : ''
  if (s.weekday === null || s.weekday === undefined) return ''
  return s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.weekday]}` : `Every other ${WEEKDAYS[s.weekday]}`
}

/**
 * The next `count` submission due dates on or after today (Central) and on or after the
 * first billing date. [] when the settings don't define a schedule.
 */
export function nextSubBillingDueDates(job = {}, { count = 12, now = new Date() } = {}) {
  const s = subBillingSettings(job)
  const n = Math.max(0, Math.min(60, intOrNull(count) ?? 12))
  if (!n) return []
  const today = todayCentral(now)
  const from = s.start && s.start > today ? s.start : today
  const out = []

  if (s.frequency === 'monthly') {
    if (!s.dueDay) return []
    let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1
    for (let guard = 0; out.length < n && guard < n + 2; guard++) {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const d = iso(new Date(Date.UTC(y, m, Math.min(s.dueDay, last))))
      if (d >= from) out.push(d)
      m++; if (m > 11) { m = 0; y++ }
    }
    return out
  }

  if (s.weekday === null || s.weekday === undefined) return []
  const step = s.frequency === 'weekly' ? 7 : 14
  let cur
  if (s.frequency === 'biweekly' && s.anchor) {
    // Stay on the anchor's two-week cycle (moved to the due weekday within its week).
    const shift = (s.weekday - toUtc(s.anchor).getUTCDay() + 7) % 7
    cur = addDays(s.anchor, shift)
    if (cur < from) {
      const behind = Math.round((toUtc(from) - toUtc(cur)) / 86400000)
      cur = addDays(cur, Math.ceil(behind / 14) * 14)
    }
  } else {
    cur = addDays(from, (s.weekday - toUtc(from).getUTCDay() + 7) % 7)
  }
  while (out.length < n) { out.push(cur); cur = addDays(cur, step) }
  return out
}

// 'Fri, Dec 4, 2026' for a 'YYYY-MM-DD' (formatted in UTC so the calendar date never shifts).
export function formatDueDate(d) {
  const s = dateOnly(d)
  if (!s) return ''
  return toUtc(s).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
