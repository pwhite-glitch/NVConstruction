// Columns each role may write on billing_submissions through /api/billing-entry.
// Anything not listed is dropped silently, so a field the job page sends but
// isn't listed here never gets saved (that is how contact info / description
// went missing on PM-entered billings).

// Fields a PM may set on a new submission (POST)
export const PM_INSERT_FIELDS = new Set([
  'job_id', 'sub_id', 'company_name', 'contact_name', 'contact_info',
  'amount_billed', 'retainage_pct', 'retainage_held', 'pct_complete',
  'work_description', 'invoice_number', 'invoice_date',
  'status', 'notes', 'billing_period', 'draw_request_id', 'doc_url',
  'submitted_at', 'reviewed_at', 'lien_waiver_signed_at', 'nv_reimbursement',
])
// Fields a sub may set on their own new submission
export const SUB_INSERT_FIELDS = new Set(['job_id', 'amount_billed', 'retainage_held', 'notes', 'billing_period', 'doc_url'])

// Fields a PM may PATCH
export const PM_PATCH_FIELDS = new Set([
  'status', 'company_name', 'contact_name', 'contact_info',
  'amount_billed', 'retainage_pct', 'retainage_held', 'pct_complete',
  'work_description', 'invoice_number', 'invoice_date',
  'notes', 'ready_to_pay', 'lien_waiver_signed_at', 'paid_at', 'doc_url', 'billing_period',
  'payment_amount', 'payment_method', 'check_number', 'payment_notes', 'nv_cuts_check', 'nv_reimbursement',
  'draw_request_id', 'reviewed_at', 'rejection_reason',
])
// Sub may only update their own pending submission's safe fields
export const SUB_PATCH_FIELDS = new Set(['notes', 'billing_period', 'doc_url'])

// Columns added by migration 032. Until it is applied, writes that include them
// fail with a "schema cache" error and are retried without them.
export const NEW_032_COLS = new Set(['invoice_date'])

export function withoutNew032(row) {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !NEW_032_COLS.has(k)))
}

export function pickFields(obj, allowed) {
  const result = {}
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

// Why a billing can't be deleted (approved, on a draw, or paid), or null.
export function billingDeleteBlock(b) {
  if (!b) return null
  if (b.status === 'approved') return 'This billing is approved. Reopen it (set back to pending) before deleting it.'
  if (b.draw_request_id) return 'This billing is on a draw request. Take it off the draw before deleting it.'
  if (b.paid_at || Number(b.payment_amount || 0) > 0) return 'This billing has a payment recorded and cannot be deleted.'
  return null
}

// ── Draw-tagged billings ─────────────────────────────────────────────────────
// Fields that make up the billed package total (or which period / draw package it rolls
// into). While a billing is on a draw — open or closed — none of these may change; take it
// off the draw first (only possible while the draw is open). Settlement fields (recording a
// payment, check number, ready to pay) stay allowed: they don't change billed dollars.
export const BILLING_FINANCIAL_FIELDS = ['status', 'amount_billed', 'retainage_pct', 'retainage_held', 'nv_reimbursement', 'billing_period']
export const BILLING_SETTLEMENT_FIELDS = new Set(['paid_at', 'payment_amount', 'payment_method', 'check_number', 'payment_notes', 'nv_cuts_check', 'ready_to_pay'])

const centsOf = v => Math.round(Number(v || 0) * 100)
const SAME = {
  status: (a, b) => (a || null) === (b || null),
  amount_billed: (a, b) => centsOf(a) === centsOf(b),
  retainage_held: (a, b) => centsOf(a) === centsOf(b),
  retainage_pct: (a, b) => Math.round(Number(a || 0) * 1000) === Math.round(Number(b || 0) * 1000),
  nv_reimbursement: (a, b) => !!a === !!b,
  billing_period: (a, b) => String(a || '').slice(0, 10) === String(b || '').slice(0, 10),
}

// Financial fields in `fields` whose value differs from `current` (unchanged values that a
// form re-sends are not changes).
export function billingFinancialChanges(current, fields = {}) {
  return BILLING_FINANCIAL_FIELDS.filter(k => k in fields && !SAME[k](current?.[k], fields[k]))
}

// First review of a billing that is on an OPEN draw: pending → approved / rejected.
// Subs must pick the open draw when they submit, so this is how a tagged invoice is
// reviewed. Closed draws and approved → pending stay locked. Shared by the server
// lock below and the commercial edit form (so it sends the status it may change).
export const FIRST_REVIEW_STATUSES = ['approved', 'rejected']
export function isFirstReviewOnOpenDraw(currentStatus, nextStatus, draw) {
  return currentStatus === 'pending' && FIRST_REVIEW_STATUSES.includes(nextStatus) && draw?.status === 'open'
}

// Null when the PATCH may go ahead, else { status, error }.
// `current` is the stored row, `draw` the draw it is on now (null when untagged or not found).
// The only financial change allowed while tagged is the first review on an open draw, and
// only on its own (status + nothing else financial).
export function billingDrawLockError(current, draw, fields = {}) {
  if (!current?.draw_request_id) return null
  const changed = billingFinancialChanges(current, fields)
  if (!changed.length) return null
  if (changed.length === 1 && changed[0] === 'status' && isFirstReviewOnOpenDraw(current.status, fields.status, draw)) return null
  const label = draw ? `Draw #${draw.draw_number}${draw.status === 'closed' ? ' (closed)' : ''}` : 'a draw request'
  const how = draw?.status === 'closed'
    ? 'Reopen the draw and take the billing off it first.'
    : 'Take it off the draw first, then make the change.'
  return { status: 409, error: `This billing is on ${label}, so its ${changed.join(', ').replace(/_/g, ' ')} can't change. ${how} (Recording a payment is still allowed.)` }
}
