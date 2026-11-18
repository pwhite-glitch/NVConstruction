// Owner pay apps (AIA G702/G703): billing period + DRAFT label rules (prompt 93).
// Pure, no imports: used by the job page, /api/aia-status and tests.
//
//  • DRAFT is decided by status only. A blank/null status is a draft (apps are
//    inserted without one); submitted / certified / approved / paid / sent (any
//    other status) is never labeled DRAFT, whatever period_to holds.
//  • Period: "Mon D, YYYY – Mon D, YYYY" when both dates exist, the end date alone
//    when only period_to exists, "Not set" when period_to is empty.
//  • An app cannot leave draft (submitted / sent / certified …) without period_to.
//    Saving a draft is never blocked, and existing rows are never rewritten.

export const AIA_PERIOD_REQUIRED_MESSAGE = 'Set the billing period end date before submitting this application.'
export const AIA_PERIOD_NOT_SET = 'Not set'
export const AIA_DRAFT_PERIOD_NOTE = 'Billing period not set'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/
const YM_RE = /^(\d{4})-(\d{2})$/

const statusOf = app => String(app?.status ?? '').trim().toLowerCase()

// Draft = status 'draft' or blank. Every other status is a sent / final app.
export function isAiaDraft(app) {
  const s = statusOf(app)
  return s === '' || s === 'draft'
}

// A target status that leaves draft (submitted, certified, sent, …).
export const isFinalAiaStatus = status => !isAiaDraft({ status })

const hasDate = v => typeof v === 'string' ? DATE_RE.test(v.trim()) : false

// May this app be submitted / sent / certified? Needs a billing period end date.
export function canFinalizeAia(app) {
  return !!app && hasDate(app.period_to)
}

// Error message when moving `app` to `newStatus` is not allowed (else null).
// Moving to (or staying in) draft is never blocked.
export function aiaFinalizeError(app, newStatus) {
  if (!isFinalAiaStatus(newStatus)) return null
  return canFinalizeAia(app) ? null : AIA_PERIOD_REQUIRED_MESSAGE
}

// 'YYYY-MM-DD' → 'Nov 1, 2026' (no time zone involved: the date is a calendar date).
export function formatAiaDate(value) {
  const m = DATE_RE.exec(String(value ?? '').trim())
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return ''
  return `${month} ${Number(m[3])}, ${m[1]}`
}

// Period text without the "Period:" prefix.
export function aiaPeriodLabel(app) {
  const to = formatAiaDate(app?.period_to)
  if (!to) return AIA_PERIOD_NOT_SET
  const from = formatAiaDate(app?.period_from)
  return from ? `${from} – ${to}` : to
}

// "Application No. 3 — DRAFT" suffix: drafts only.
export const aiaTitleSuffix = app => (isAiaDraft(app) ? ' — DRAFT' : '')

// Soft note for a draft that has no period end date yet (null otherwise).
export const aiaDraftPeriodNote = app => (isAiaDraft(app) && !canFinalizeAia(app) ? AIA_DRAFT_PERIOD_NOTE : null)

// First and last day of a 'YYYY-MM' month → { period_from, period_to } (null if malformed).
export function monthPeriod(ym) {
  const m = YM_RE.exec(String(ym ?? '').trim())
  if (!m) return null
  const year = Number(m[1]), month = Number(m[2])
  if (month < 1 || month > 12) return null
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { period_from: `${m[1]}-${mm}-01`, period_to: `${m[1]}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

// Period to insert with a new prime app (createAiaApplication).
//   form.period_to: 'YYYY-MM' (monthly picker) or 'YYYY-MM-DD' (date inputs)
//   today: Central 'YYYY-MM-DD' (todayCentral())
// Draw-request jobs default to the current Central month when a date is left blank.
// Returns { period_from, period_to } or { error }.
export function aiaCreatePeriod({ isDrawType = false, form = {}, today } = {}) {
  const from = String(form.period_from || '').trim()
  const to = String(form.period_to || '').trim()
  if (isDrawType) {
    const def = monthPeriod(String(today || '').slice(0, 7))
    const toMonth = YM_RE.test(to) ? monthPeriod(to) : null
    const period_from = from || toMonth?.period_from || def?.period_from || null
    const period_to = (hasDate(to) ? to.slice(0, 10) : toMonth?.period_to) || def?.period_to || null
    if (!period_to) return { error: 'Billing period end date is required.' }
    if (period_from && period_from > period_to) return { error: 'Period from must be on or before period to.' }
    return { period_from, period_to }
  }
  if (!to) return { error: 'Billing period is required.' }
  if (from) {
    if (!hasDate(to)) return { error: 'Billing period end date is required.' }
    if (from > to) return { error: 'Period from must be on or before period to.' }
    return { period_from: from, period_to: to.slice(0, 10) }
  }
  if (hasDate(to)) return { period_from: null, period_to: to.slice(0, 10) }
  const mp = monthPeriod(to)
  return mp || { error: 'Billing period is required.' }
}
