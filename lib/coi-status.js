// COI on-file status for the Sub Directory (dashboard + admin), from the file and
// its expiration date. A file with no expiration date is "no_date", not "on file".
import { todayCentral, addDaysCentral } from './central-date'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const isCoiDate = s => typeof s === 'string' && DATE_ONLY.test(s.slice(0, 10)) && !Number.isNaN(Date.parse(s.slice(0, 10) + 'T12:00:00Z'))

// 'missing' | 'no_date' | 'expired' | 'expiring' (within 30 days) | 'ok'
export function coiState(entry, now = new Date()) {
  if (!entry?.coi_url) return 'missing'
  const exp = entry.coi_expiration ? String(entry.coi_expiration).slice(0, 10) : ''
  if (!isCoiDate(exp)) return 'no_date'
  const today = todayCentral(now)
  if (exp < today) return 'expired'
  if (exp < addDaysCentral(30, now)) return 'expiring'
  return 'ok'
}

// Should the "Email Reminder" (COI) button show?
export const coiNeedsReminder = (entry, now) => ['missing', 'no_date', 'expired'].includes(coiState(entry, now))

// 'Mar 4, 2027' from a date-only value without a UTC day shift.
export const fmtCoiDate = d => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')

// Office upload / replace of a COI file must carry a valid expiration date.
// Returns null when OK, else an error message.
export function coiUploadError(fields) {
  if (!fields || !('coi_url' in fields) || !fields.coi_url) return null
  return isCoiDate(fields.coi_expiration || '') ? null : 'Enter the new COI expiration date.'
}
