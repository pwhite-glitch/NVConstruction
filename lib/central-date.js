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
