// Commercial contract time (prompt 71). Pure: no DB imports, safe in the browser
// and on the server.
//   current completion = contract_completion_date + approved owner-CO days_added
//   days left          = current completion − today (America/Chicago), calendar days
// Weather-delay days (daily_reports.weather_delay) are a count + printable log only:
// they never move the completion date.
import { todayCentral } from './central-date'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const dateOnly = v => {
  const s = v == null ? '' : String(v).slice(0, 10)
  return DATE_ONLY.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) ? s : null
}

export const DAYS_ADDED_MIN = -3650
export const DAYS_ADDED_MAX = 3650
export const CONTRACT_TIME_MIGRATION = '069'
export const CONTRACT_DATE_NEEDS_069 = 'Contract completion date needs database migration 069, which is not applied yet. The other Details were saved; the completion date was not.'
export const DAYS_ADDED_NEEDS_069 = 'Days added needs database migration 069, which is not applied yet. The change order was saved without its days.'

// 'YYYY-MM-DD' n calendar days after (negative: before) a 'YYYY-MM-DD' date. Null on a bad date.
export function addCalendarDays(yyyyMmDd, n) {
  const s = dateOnly(yyyyMmDd)
  if (!s) return null
  const d = new Date(s + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0))
  return d.toISOString().slice(0, 10)
}

// Calendar days from date a to date b (b − a). Null when either is not a date.
export function calendarDaysBetween(a, b) {
  const x = dateOnly(a), y = dateOnly(b)
  if (!x || !y) return null
  return Math.round((Date.parse(y + 'T12:00:00Z') - Date.parse(x + 'T12:00:00Z')) / 86400000)
}

// Sum of days_added on APPROVED owner COs only (pending / rejected / other = 0).
// A missing column (before 069) reads as undefined → 0.
export function approvedDaysAdded(primeCOs = []) {
  let sum = 0
  for (const co of Array.isArray(primeCOs) ? primeCOs : []) {
    if (!co || co.status !== 'approved') continue
    const n = Number(co.days_added || 0)
    if (Number.isFinite(n)) sum += Math.trunc(n)
  }
  return sum
}

// Original contract completion + approved days. Null when there is no original date.
export function currentCompletionDate(contractCompletionDate, approvedDays = 0) {
  if (!dateOnly(contractCompletionDate)) return null
  return addCalendarDays(contractCompletionDate, approvedDays || 0)
}

// Calendar days from today (Central) to the current completion. Negative = overdue,
// 0 = due today, null = no completion date.
export function daysLeftFromToday(currentCompletion, now = new Date()) {
  if (!dateOnly(currentCompletion)) return null
  return calendarDaysBetween(todayCentral(now), currentCompletion)
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// Dashboard / overview flag when the job is within `window` days of completion (or past it).
export function completionFlag(daysLeft, { window = 14 } = {}) {
  if (daysLeft == null || !Number.isFinite(daysLeft)) return null
  if (daysLeft < 0) return { kind: 'overdue', daysLeft, label: `${plural(-daysLeft, 'day')} overdue` }
  if (daysLeft === 0) return { kind: 'today', daysLeft, label: 'Due today' }
  if (daysLeft <= window) return { kind: 'due', daysLeft, label: `Due in ${plural(daysLeft, 'day')}` }
  return null
}

// Contract-time summary for one job from its row, its owner COs and today.
export function contractTimeSummary(job, primeCOs = [], now = new Date()) {
  const original = dateOnly(job?.contract_completion_date)
  const approvedDays = approvedDaysAdded(primeCOs)
  const current = currentCompletionDate(original, approvedDays)
  const daysLeft = daysLeftFromToday(current, now)
  return { original, approvedDays, current, daysLeft, flag: completionFlag(daysLeft) }
}

// Daily reports flagged as a weather delay (boolean true only).
export function weatherDelayCount(reports = []) {
  return (Array.isArray(reports) ? reports : []).filter(r => r && r.weather_delay === true).length
}

// Weather-delay reports for the printable log: optional inclusive from / to (date-only),
// oldest first.
export function weatherDelayRows(reports = [], { from, to } = {}) {
  const f = dateOnly(from), t = dateOnly(to)
  return (Array.isArray(reports) ? reports : [])
    .filter(r => r && r.weather_delay === true)
    .filter(r => {
      const d = dateOnly(r.report_date)
      if (!d) return !f && !t
      return (!f || d >= f) && (!t || d <= t)
    })
    .sort((a, b) => String(a.report_date || '').localeCompare(String(b.report_date || '')))
}

// Validate a days_added input. '' / null / undefined → 0. Returns { value } or { error }.
export function parseDaysAdded(v) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { value: 0 }
  if (typeof v === 'boolean') return { error: 'Days added must be a whole number.' }
  const n = typeof v === 'string' ? Number(v.trim()) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { error: 'Days added must be a whole number.' }
  if (n < DAYS_ADDED_MIN || n > DAYS_ADDED_MAX) return { error: `Days added must be between ${DAYS_ADDED_MIN} and ${DAYS_ADDED_MAX}.` }
  return { value: n === 0 ? 0 : n }
}

// "+5 days" / "0 days" / "-2 days" for a CO card.
export function formatDaysAdded(n) {
  const v = Math.trunc(Number(n || 0)) || 0
  return `${v > 0 ? '+' : ''}${v} day${Math.abs(v) === 1 ? '' : 's'}`
}
