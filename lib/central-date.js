// Date-only "today" for the business, in America/Chicago. Works in the browser and
// on the server (Vercel runs in UTC, so the machine's local date is not enough).
// Do not use for full timestamps (created_at, signed_at, expiry): those stay ISO UTC.

const TIME_ZONE = 'America/Chicago'

let formatter = null
const fmt = () => (formatter = formatter || new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}))

// 'YYYY-MM-DD' for the Central calendar date at `now`.
export function todayCentral(now = new Date()) {
  const parts = {}
  for (const p of fmt().formatToParts(now)) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}`
}

// 'YYYY-MM-DD' n calendar days after (or before, if negative) the Central date at `now`.
export function addDaysCentral(n, now = new Date()) {
  const d = new Date(todayCentral(now) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// True when a date-only value (or the date part of a timestamp) is before today in Central.
// A due date of today is not past.
export function isBeforeTodayCentral(date, now = new Date()) {
  if (!date) return false
  return String(date).slice(0, 10) < todayCentral(now)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// ISO UTC instant of midnight (start of day) in Central for a 'YYYY-MM-DD' date.
// Central midnight is 05:00Z (CDT) or 06:00Z (CST); pick the one whose Central
// date is `date` while the instant just before it is the previous day.
export function centralDayStartIso(date) {
  const [y, m, d] = date.split('-').map(Number)
  for (const h of [5, 6]) {
    const t = Date.UTC(y, m - 1, d, h)
    if (todayCentral(new Date(t)) === date && todayCentral(new Date(t - 1)) !== date) return new Date(t).toISOString()
  }
  return new Date(Date.UTC(y, m - 1, d, 6)).toISOString()
}

// Timestamp filter bounds for a from/to date range picked in the UI, inclusive
// of both days in Central: { gte, lt } (either may be null). A date-only `to`
// becomes "before the start of the next Central day", so wins late on the To
// date count. Non-date-only values pass through (gte / lte semantics kept via lte).
export function centralDateRange(from, to) {
  const out = { gte: null, lt: null, lte: null }
  if (from) out.gte = DATE_ONLY.test(from) ? centralDayStartIso(from) : from
  if (to) {
    if (DATE_ONLY.test(to)) out.lt = centralDayStartIso(addDaysCentral(1, new Date(to + 'T12:00:00Z')))
    else out.lte = to
  }
  return out
}
