// Daily report "Export PDF" / "Email to owner" (prompt 92) — pure helpers shared by the
// export API route (app/api/daily-reports/export) and the job pages. No imports with side
// effects: safe in the browser, on the server and in tests.
//
// Who may export / email: Owner (principal) / admin on any job; PM / APM only on jobs they are
// on (the route checks the job with denyUnlessOnJob). Supers, subs, owner clients: never.
// Only FINAL reports (a missing status counts as final, same as everywhere else).

export const EXPORT_ROLES = new Set(['principal', 'admin', 'pm', 'apm'])
export const canExportReports = role => EXPORT_ROLES.has(role)
export const EXPORT_ROLE_MESSAGE = 'Only an Owner, admin, PM or APM can export or email daily reports.'
export const DRAFT_EXPORT_MESSAGE = "Draft reports can't be exported."

// Range / size limits.
export const MAX_RANGE_DAYS = 31
export const MAX_EXPORT_REPORTS = 31
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024        // a single photo over this is skipped
export const PHOTOS_PER_REPORT = 60
export const PHOTOS_PER_PDF = 150
export const PHOTO_TOTAL_BYTES = 120 * 1024 * 1024    // all photo bytes held for one PDF
export const PHOTO_DOWNLOAD_CONCURRENCY = 6
export const EMAIL_MAX_PDF_BYTES = 38 * 1024 * 1024   // Resend refuses messages over 40 MB

// Recipients — same rule as /api/send-email (which imports these).
export const MAX_RECIPIENTS = 20
export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
export const SUBJECT_MAX = 200
export const NOTE_MAX = 2000
export const OWNER_EMAIL_NOTE = "This address will be saved as the job's owner email."

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function isValidDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day
}
const utc = d => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day) }
// Inclusive day count: 2026-11-10 → 2026-11-16 is 7.
export const rangeDays = (from, to) => Math.round((utc(to) - utc(from)) / 86400000) + 1

// → { ok: true, from, to } | { ok: false, error }
export function validateRange(from, to) {
  if (!isValidDate(from) || !isValidDate(to)) return { ok: false, error: 'From and To must be valid dates (YYYY-MM-DD).' }
  if (from > to) return { ok: false, error: 'From must be on or before To.' }
  if (rangeDays(from, to) > MAX_RANGE_DAYS) return { ok: false, error: `Pick a range of ${MAX_RANGE_DAYS} days or fewer.` }
  return { ok: true, from, to }
}

// Central (America/Chicago) calendar date at `now` as YYYY-MM-DD.
function centralToday(now = new Date()) {
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}`
}
const addDays = (d, n) => new Date(utc(d) + n * 86400000).toISOString().slice(0, 10)
// "This week": Monday–Sunday containing today's Central date.
export function thisWeekCentral(now = new Date()) {
  const today = centralToday(now)
  const dow = new Date(utc(today)).getUTCDay() // 0 Sun … 6 Sat
  const from = addDays(today, -((dow + 6) % 7))
  return { from, to: addDays(from, 6) }
}

// Split "a@b.com, c@d.com\n e@f.com" (or an array) into trimmed, de-duplicated addresses.
export function parseRecipients(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/)
  const out = []
  const seen = new Set()
  for (const r of raw) {
    const e = String(r ?? '').trim()
    if (!e) continue
    const k = e.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}
export const isValidRecipient = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e)
// → { ok: true, recipients } | { ok: false, error }
export function validateRecipients(input) {
  if (input != null && !Array.isArray(input) && typeof input !== 'string') return { ok: false, error: 'Recipients must be a list of email addresses.' }
  const recipients = parseRecipients(input)
  if (!recipients.length) return { ok: false, error: 'Add at least one recipient.' }
  if (recipients.length > MAX_RECIPIENTS) return { ok: false, error: `Send to ${MAX_RECIPIENTS} recipients or fewer.` }
  const bad = recipients.find(e => !isValidRecipient(e))
  if (bad) return { ok: false, error: `"${bad.slice(0, 80)}" is not a valid email address.` }
  return { ok: true, recipients }
}

const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
// → { ok: true, subject, note } | { ok: false, error }
export function validateMessage({ subject, note } = {}, fallbackSubject = '') {
  if (subject != null && typeof subject !== 'string') return { ok: false, error: 'Subject must be text.' }
  if (note != null && typeof note !== 'string') return { ok: false, error: 'Note must be text.' }
  const s = oneLine(subject) || oneLine(fallbackSubject)
  if (s.length > SUBJECT_MAX) return { ok: false, error: `Subject must be ${SUBJECT_MAX} characters or fewer.` }
  const n = String(note ?? '').replace(/\r\n?/g, '\n').trim()
  if (n.length > NOTE_MAX) return { ok: false, error: `Note must be ${NOTE_MAX} characters or fewer.` }
  return { ok: true, subject: s.slice(0, SUBJECT_MAX), note: n }
}

// ── Labels ──────────────────────────────────────────────────────────────────
const dateFmt = (d, opts) => (isValidDate(d) ? new Date(utc(d)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts }) : String(d ?? ''))
export const longDate = d => dateFmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
export const mediumDate = d => dateFmt(d, { month: 'short', day: 'numeric', year: 'numeric' })
export const shortDate = d => dateFmt(d, { weekday: 'short', month: 'short', day: 'numeric' })

// Sorted unique report dates → "Nov 18, 2026" or "Nov 10, 2026 – Nov 16, 2026".
export function datesLabel(dates = [], { from, to } = {}) {
  const list = [...new Set((dates || []).filter(Boolean))].sort()
  const a = from || list[0], b = to || list[list.length - 1]
  if (!a) return ''
  return a === b ? mediumDate(a) : `${mediumDate(a)} – ${mediumDate(b)}`
}

export const jobTitle = job => oneLine(job?.project_name || job?.name || '') || 'Project'

export function defaultSubject(job, dates = [], range) {
  return `Daily Report — ${jobTitle(job)} — ${datesLabel(dates, range || {})}`.slice(0, SUBJECT_MAX)
}

// "<job number or project> Daily Report 2026-11-18.pdf" / "… 2026-11-10 to 2026-11-16.pdf"
export function exportFilename(job, dates = [], range) {
  const list = [...new Set((dates || []).filter(Boolean))].sort()
  const a = range?.from || list[0] || '', b = range?.to || list[list.length - 1] || ''
  const who = String(job?.job_number || '').trim() || jobTitle(job)
  const when = a && b && a !== b ? `${a} to ${b}` : (a || b)
  const name = `${who} Daily Report${when ? ` ${when}` : ''}`
    .replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim()
  return `${name || 'Daily Report'}.pdf`
}

// ── Sent log (change_log, no migration) ─────────────────────────────────────
export const SENT_FIELD = 'emailed_to_owner'

// change_log rows (entity_type 'daily_report', field_name SENT_FIELD) → { [reportId]: { to, at, by } }
// for the LATEST successful send of each report. Rows whose new_value can't be read are skipped.
export function latestSends(rows = []) {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.field_name !== SENT_FIELD || !r.entity_id) continue
    let v
    try { v = JSON.parse(r.new_value) } catch { continue }
    if (!v || v.result !== 'sent' || !Array.isArray(v.to) || !v.to.length) continue
    const at = r.created_at || v.at || null
    const prev = out[r.entity_id]
    if (!prev || String(at || '') > String(prev.at || '')) out[r.entity_id] = { to: v.to.map(String), at, by: r.changed_by_name || null }
  }
  return out
}

// "Sent to a@b.com (+1) on Nov 18, 3:40 PM" (Central). Null when there is nothing to show.
export function sentLabel(send) {
  if (!send || !Array.isArray(send.to) || !send.to.length) return null
  const more = send.to.length > 1 ? ` (+${send.to.length - 1})` : ''
  const d = send.at ? new Date(send.at) : null
  const when = d && !Number.isNaN(d.getTime())
    ? ` on ${d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : ''
  return `Sent to ${send.to[0]}${more}${when}`
}
