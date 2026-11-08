// Meeting AI parser helpers (/api/parse-meeting, MeetingsTab, My Work).
// No imports beyond central-date so the browser and the route share them.
import { todayCentral } from './central-date'

// The route accepts and analyzes the same amount of text (no silent cut-off).
export const MEETING_TRANSCRIPT_MAX = 100000
// Room for a long OAC's action items without the JSON being cut off.
export const MEETING_PARSE_MAX_TOKENS = 16000
// A parsed due date outside [meeting − 30 days, meeting + 1 year] is treated as a
// misread (wrong year, a date from an old email quoted in the minutes, …).
export const DUE_DAYS_BEFORE = 30
export const DUE_DAYS_AFTER = 365

export const TRUNCATED_REPLY_MESSAGE = 'The AI reply hit its length limit before it finished (too many items in one transcript), so nothing was imported. Split the transcript into two parts and parse each one.'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isRealDate(s) {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The meeting date sent by the form, else today in America/Chicago.
export function meetingAnchorDate(meetingDate, now = new Date()) {
  return isRealDate(meetingDate) ? meetingDate : todayCentral(now)
}

// { due_date, due_date_flag?, due_date_raw? } for one parsed action item.
export function normalizeDueDate(raw, anchor) {
  if (raw == null || raw === '') return { due_date: null }
  const s = String(raw).trim()
  if (!isRealDate(s)) return { due_date: null, due_date_flag: 'unreadable', due_date_raw: s.slice(0, 40) }
  if (s < addDays(anchor, -DUE_DAYS_BEFORE) || s > addDays(anchor, DUE_DAYS_AFTER)) {
    return { due_date: null, due_date_flag: 'out_of_range', due_date_raw: s }
  }
  return { due_date: s }
}

export function dueFlagText(item) {
  if (!item?.due_date_flag) return ''
  if (item.due_date_flag === 'out_of_range') return `AI read the due date as ${item.due_date_raw}, too far from the meeting date — left blank, check it.`
  return `AI gave an unreadable due date${item.due_date_raw ? ` ("${item.due_date_raw}")` : ''} — left blank, check it.`
}

// "Nov 14", or "Nov 14, 2027" when the date is not in the current (Central) year.
export function formatDuePill(date, now = new Date()) {
  if (!date) return ''
  const s = String(date).slice(0, 10)
  if (!isRealDate(s)) return String(date)
  const sameYear = s.slice(0, 4) === todayCentral(now).slice(0, 4)
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export function buildMeetingPrompt(transcript, anchor, today) {
  return `You are a construction project management assistant. Analyze this meeting transcript or meeting minutes from a construction/design-build project and extract structured information.

The meeting was held on ${anchor} (YYYY-MM-DD). Today is ${today}.
Resolve relative deadlines ("next Friday", "by the 14th", "end of month", "two weeks") against the MEETING date, and always give the full YYYY-MM-DD with the correct year. If a deadline cannot be pinned to a specific date, use null — do not guess.

Return a single valid JSON object with exactly these four keys:

"action_items": array of objects with:
  - "description": what needs to be done (string, required)
  - "assigned_to": who is responsible — a person's name or company name (string or null)
  - "due_date": deadline in YYYY-MM-DD format if mentioned, otherwise null

"decisions": array of objects with:
  - "description": what was decided or confirmed (string, required)

"contacts": array of objects with:
  - "name": full name (string, required)
  - "company": company or firm name (string or null)
  - "role": their role on the project e.g. "Architect", "Owner", "Engineer" (string or null)
  - "phone": phone number if mentioned (string or null)
  - "email": email if mentioned (string or null)

"topics": array of strings — the main subjects discussed (e.g. "Structural system", "MEP coordination", "Permit timeline")

Rules:
- Only include contacts if they are actual people mentioned with a name; not just roles
- Only include action items for things explicitly assigned or committed to
- Only include decisions for things explicitly agreed upon or resolved
- Return ONLY valid JSON, no markdown fences, no explanation

Transcript:
${transcript}`
}
