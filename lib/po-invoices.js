// Purchase-order invoices and "Ready to pay" (prompt 99). Pure — no DB or server imports,
// so the admin page, the job page, the API route, the cash math and the tests share it.
//
// Who pays a PO's vendor (precedence, highest first):
//   1. purchase_orders.payer_override ('nv' | 'owner') — an explicit per-PO exception.
//   2. jobs.po_payer ('nv' default | 'owner') — Job Details "Who pays vendors (POs)".
//   3. Before migration 082 only (neither column exists): the legacy per-PO payment_type
//      rule — 'reimbursement' = NV pays, anything else ('check') = owner pays.
// purchase_orders.payment_type is kept in step with the effective payer by the PO API.
//
// Invoice payment status (separate from the PO's order status draft/issued/received/closed):
//   NV pays:    needs_approval → (PM/APM on the job, or an Owner, approves) → ready_to_pay
//               → (po.mark_paid: admin) → paid. Partial checks keep it ready_to_pay.
//               Sent back = needs_approval again, with a reason.
//   Owner pays: owner_to_pay → (PM/APM/Owner marks it) → paid_by_owner. Never on the
//               admin check list.
//
// Locked payer (prompt 108): once an invoice has been acted on (approved / ready to pay,
// any NV check recorded, or marked paid by the owner) its own row proves who pays it, and
// that payer wins over the PO/job setting — see lockedInvoicePayer(). Changing "Who pays
// vendors" on a job or PO therefore never rewrites approved/paid invoices; only invoices
// nothing has happened on yet follow the new setting.

export const PO_PAYERS = ['nv', 'owner']
export const PO_PAYER_LABELS = { nv: 'NV pays vendors', owner: 'Owner pays vendors directly' }
export const PO_DUE_DAYS = 30
export const PO_MARK_PAID_PERMISSION = 'po.mark_paid'
export const MIGRATION_082 = '082'
export const MIGRATION_082_MESSAGE = 'PO invoices and Ready to pay need database migration 082 (supabase/migrations/082_po_invoices_ready_to_pay.sql). It has not been applied yet, so nothing was saved.'
export const MIGRATION_082_SHORT = 'Migration 082 needed: PO invoices / Ready to pay are not set up in the database yet.'
export const PO_PAYER_NEEDS_082 = '"Who pays vendors (POs)" was not saved: it needs database migration 082 (supabase/migrations/082_po_invoices_ready_to_pay.sql). Everything else was saved.'

export const STATUS_LABELS = {
  no_invoice: 'No invoice',
  needs_approval: 'Needs approval',
  ready_to_pay: 'Ready to pay',
  paid: 'Paid',
  owner_to_pay: 'Owner pays',
  paid_by_owner: 'Paid by owner',
}
export const STATUS_COLORS = {
  no_invoice:     { color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
  needs_approval: { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  ready_to_pay:   { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
  paid:           { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  owner_to_pay:   { color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
  paid_by_owner:  { color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
}

const CENT = 0.005
export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const isPayer = v => v === 'nv' || v === 'owner'

// ── Payer ────────────────────────────────────────────────────────────────────
/** The job's PO payer, or null when the job row has no po_payer (migration 082 not applied). */
export function jobPOPayer(job) {
  return isPayer(job?.po_payer) ? job.po_payer : null
}

/** 'nv' | 'owner' — see the precedence at the top of this file. */
export function effectivePOPayer(po, job) {
  if (isPayer(po?.payer_override)) return po.payer_override
  const jp = jobPOPayer(job)
  if (jp) return jp
  return po?.payment_type === 'reimbursement' ? 'nv' : 'owner'
}

/** Where the effective payer came from: 'override' | 'job' | 'legacy'. */
export function poPayerSource(po, job) {
  if (isPayer(po?.payer_override)) return 'override'
  if (jobPOPayer(job)) return 'job'
  return 'legacy'
}

/** The legacy payment_type value that means the same as a payer. */
export const paymentTypeForPayer = payer => (payer === 'nv' ? 'reimbursement' : 'check')

/** Normalize a payer_override from a form/body: 'nv' | 'owner' | null; undefined = not sent. */
export function normalizePayerOverride(v) {
  if (v === undefined) return undefined
  if (v === null || v === '' || v === 'job') return null
  return isPayer(v) ? v : 'invalid'
}

// ── Locked invoice payer (prompt 108) ──────────────────────────────────────────
// Invariant (verified against migrations 082/083 and every write in app/api/po-invoices):
//   - paid_by_owner = true is only set by mark_paid_by_owner (owner payer) or the 083
//     backfill for owner POs                                                   => 'owner'
//   - approved_at / ready_to_pay are only set by approve, allowed only when payer = 'nv'
//   - paid_amount > 0 / paid_at are only set by mark_paid, allowed only when payer = 'nv'
//     (083 backfill NV rows also land here)                                    => 'nv'
// paid_by_owner is checked FIRST: 083 owner rows also carry approved_at / paid_amount.
// Any future flow that approves or records money on an owner-pays invoice (or sets
// paid_by_owner on an NV one) MUST revisit this function, or the lock will misreport the payer.

/** The payer an acted-on invoice is locked to: 'owner' | 'nv', or null while unlocked. */
export function lockedInvoicePayer(inv) {
  if (inv?.paid_by_owner) return 'owner'
  if (inv?.approved_at || inv?.ready_to_pay || num(inv?.paid_amount) > 0 || inv?.paid_at) return 'nv'
  return null
}

/** True once an invoice was approved, paid (any amount) or marked paid by the owner. */
export const isInvoiceLocked = inv => lockedInvoicePayer(inv) !== null

/** Who pays this invoice: its locked payer, else the PO/job effective payer. */
export function invoicePayer(inv, po, job) {
  return lockedInvoicePayer(inv) ?? effectivePOPayer(po, job)
}

export const PAYER_APPLY_NEW_ONLY = 'new_only'

/**
 * What a payer change to `newPayer` does to these invoices. The caller passes only invoices
 * of POs whose effective payer actually changes, so every unlocked one moves.
 * → { locked_keep, open_move, locked_total }
 */
export function payerChangeImpact(invoices = [], newPayer) {
  let locked_keep = 0, open_move = 0, locked_total = 0
  for (const inv of invoices || []) {
    const lp = lockedInvoicePayer(inv)
    if (lp === null) { open_move += 1; continue }
    locked_total += 1
    if (lp !== newPayer) locked_keep += 1
  }
  return { locked_keep, open_move, locked_total }
}

/** The confirm text for a payer change that leaves approved/paid invoices on their payer. */
export function payerChangeMessage(impact, newPayer, scope) {
  const n = num(impact?.locked_keep)
  const m = num(impact?.open_move)
  const label = PO_PAYER_LABELS[newPayer]
  return `${n} approved or paid invoice${n === 1 ? '' : 's'} on this ${scope === 'job' ? 'job' : 'PO'} will keep ${n === 1 ? 'its' : 'their'} current payer. ` +
    `"${label}" will apply to new invoices` + (m ? ` and ${m} not-yet-approved invoice${m === 1 ? '' : 's'}` : '') + `. Apply to new invoices only?`
}

// ── Dates ────────────────────────────────────────────────────────────────────
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isDateOnly(s) {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3]
}
export function addDaysDate(date, n) {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Default due date: invoice date + 30 days. */
export const defaultDueDate = invoiceDate => (isDateOnly(invoiceDate) ? addDaysDate(invoiceDate, PO_DUE_DAYS) : null)
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000)
const dateOf = v => (v ? String(v).slice(0, 10) : null)

// ── Amounts / status ─────────────────────────────────────────────────────────
export const invoicePaid = inv => r2(num(inv?.paid_amount))
export const invoiceRemaining = inv => Math.max(0, r2(num(inv?.amount) - num(inv?.paid_amount)))
export const isSettled = inv => !!inv?.paid_at || (num(inv?.amount) > 0 && invoiceRemaining(inv) <= CENT)

/** Status key of one invoice, given its PO's effective payer (a locked invoice keeps its own). */
export function invoiceStatus(inv, payer) {
  const p = lockedInvoicePayer(inv) || payer
  if (p === 'owner') return inv?.paid_by_owner || inv?.paid_at ? 'paid_by_owner' : 'owner_to_pay'
  if (isSettled(inv)) return 'paid'
  if (inv?.ready_to_pay && inv?.approved_at) return 'ready_to_pay'
  return 'needs_approval'
}

const STATUS_RANK = ['needs_approval', 'ready_to_pay', 'owner_to_pay', 'paid', 'paid_by_owner']
/** One badge for a PO from all its invoices (the least-finished one wins). */
export function poPaymentStatus(invoices = [], payer) {
  if (!invoices?.length) return 'no_invoice'
  const keys = invoices.map(i => invoiceStatus(i, payer))
  return STATUS_RANK.find(k => keys.includes(k)) || 'no_invoice'
}

/** Sum of invoice amounts on a PO, optionally leaving one invoice out (the one being edited). */
export function invoicesTotal(invoices = [], excludeId = null) {
  return r2((invoices || []).filter(i => !excludeId || i.id !== excludeId).reduce((a, i) => a + num(i.amount), 0))
}

/** Would `amount` (new or edited invoice) take the PO's invoices over the PO amount? */
export function overPOAmount(po, invoices = [], amount, excludeId = null) {
  const total = r2(invoicesTotal(invoices, excludeId) + num(amount))
  const poAmount = r2(num(po?.amount))
  return { over: total > poAmount + CENT, total, poAmount, by: r2(total - poAmount) }
}

/** True when some invoice on the PO carries an Owner over-amount override. */
export const hasOwnerOverride = (invoices = []) => (invoices || []).some(i => i.over_po_override_by && String(i.over_po_override_note || '').trim())

// ── Input validation ─────────────────────────────────────────────────────────
export const MAX_TEXT = 200
export const MAX_NOTE = 1000
const money = v => {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return NaN
  const n = Number(typeof v === 'string' ? v.replace(/[$,\s]/g, '') : v)
  return Number.isFinite(n) ? r2(n) : NaN
}

/**
 * Invoice fields → { fields: { invoice_number, invoice_date, amount, due_date } } or { error }.
 * A blank / missing due date defaults to invoice date + 30 days. (Edits merge the stored row
 * with the sent fields first, then call this.)
 */
export function validateInvoiceInput(body = {}) {
  const invoice_number = String(body.invoice_number ?? '').trim()
  if (!invoice_number) return { error: 'Invoice # is required.' }
  if (invoice_number.length > MAX_TEXT) return { error: 'Invoice # is too long.' }
  if (!isDateOnly(body.invoice_date)) return { error: 'Invoice date must be a date (YYYY-MM-DD).' }
  const amount = money(body.amount)
  if (!(amount > 0)) return { error: 'Invoice amount must be more than $0.' }
  if (amount > 99999999.99) return { error: 'Invoice amount is too large.' }
  let due_date
  if (body.due_date === undefined || body.due_date === null || body.due_date === '') due_date = defaultDueDate(body.invoice_date)
  else if (!isDateOnly(body.due_date)) return { error: 'Due date must be a date (YYYY-MM-DD).' }
  else due_date = body.due_date
  if (due_date < body.invoice_date) return { error: 'Due date cannot be before the invoice date.' }
  return { fields: { invoice_number, invoice_date: body.invoice_date, amount, due_date } }
}

/**
 * Validate one payment against the stored invoice.
 * Returns { error } or { amount, date, check_number, notes, newPaid, settles }.
 */
export function validatePayment(inv, body = {}, today) {
  if (!inv) return { error: 'Invoice not found.' }
  if (isSettled(inv)) return { error: 'This invoice is already paid in full.' }
  if (!inv.ready_to_pay || !inv.approved_at) return { error: 'This invoice is not approved / ready to pay.' }
  const check = String(body.check_number ?? '').trim()
  if (!check) return { error: 'Check # is required.' }
  if (check.length > 60) return { error: 'Check # is too long.' }
  const date = body.paid_on === undefined || body.paid_on === '' || body.paid_on === null ? today : body.paid_on
  if (!isDateOnly(date)) return { error: 'Payment date must be a date (YYYY-MM-DD).' }
  const remaining = invoiceRemaining(inv)
  const amount = body.amount === undefined || body.amount === '' || body.amount === null ? remaining : money(body.amount)
  if (!(amount > 0)) return { error: 'Payment amount must be more than $0.' }
  if (amount > remaining + CENT) return { error: `Payment is more than the $${remaining.toFixed(2)} still owed on this invoice.` }
  const notes = String(body.payment_notes ?? '').trim().slice(0, MAX_NOTE)
  const newPaid = r2(invoicePaid(inv) + amount)
  return { amount, date, check_number: check, notes, newPaid, settles: newPaid >= r2(num(inv.amount)) - CENT }
}

/** Merged check-number list ("1201, 1244"). */
export function appendCheckNumber(existing, check) {
  const list = String(existing || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!list.includes(check)) list.push(check)
  return list.join(', ')
}

// ── Lists ────────────────────────────────────────────────────────────────────
/** Days an invoice has been waiting: since approval when ready to pay, else since it was logged. */
export function daysWaiting(inv, today) {
  const from = dateOf(inv?.ready_to_pay && inv?.approved_at ? inv.approved_at : inv?.created_at)
  if (!from || !isDateOnly(from) || !isDateOnly(today)) return null
  return Math.max(0, daysBetween(from, today))
}
export const isOverdue = (inv, today) => !isSettled(inv) && !!inv?.due_date && isDateOnly(today) && String(inv.due_date) < today

/**
 * Rows for the admin Ready to pay list. Owner-pays invoices get status owner_to_pay /
 * paid_by_owner (never ready_to_pay), so they stay off the check list.
 * Sorted by due date (earliest first; no due date last).
 */
export function buildInvoiceRows(invoices = [], posById = {}, jobsById = {}, today) {
  const rows = []
  for (const inv of invoices || []) {
    const po = posById[inv.po_id]
    if (!po) continue
    const job = jobsById[po.job_id] || null
    const payer = invoicePayer(inv, po, job)
    const locked = isInvoiceLocked(inv)
    rows.push({
      ...inv,
      status: invoiceStatus(inv, payer),
      payer,
      payer_source: locked ? 'invoice' : poPayerSource(po, job),
      payer_kept: locked && payer !== effectivePOPayer(po, job),
      remaining: invoiceRemaining(inv),
      overdue: isOverdue(inv, today),
      days_waiting: daysWaiting(inv, today),
      has_attachment: !!inv.file_url,
      po: { id: po.id, po_number: po.po_number, vendor_name: po.vendor_name, amount: po.amount, status: po.status, job_id: po.job_id },
      job: job ? { id: job.id, job_number: job.job_number, project_name: job.project_name } : null,
    })
  }
  return rows.sort((a, b) => String(a.due_date || '9999-99-99').localeCompare(String(b.due_date || '9999-99-99')) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

/** Chip counts and totals. Ready to pay totals the REMAINING amount (partial checks count). */
export function summarizeInvoiceRows(rows = []) {
  const out = {}
  for (const k of ['needs_approval', 'ready_to_pay', 'paid', 'owner_to_pay', 'paid_by_owner']) out[k] = { count: 0, total: 0, overdue: 0 }
  for (const r of rows) {
    const b = out[r.status]
    if (!b) continue
    b.count += 1
    b.total = r2(b.total + (r.status === 'ready_to_pay' || r.status === 'needs_approval' || r.status === 'owner_to_pay' ? invoiceRemaining(r) : num(r.amount)))
    if (r.overdue) b.overdue += 1
  }
  return out
}

/**
 * NV money already paid against each PO through PO invoices: { [poId]: dollars }.
 * Only invoices NV pays (invoicePayer 'nv' — a locked invoice keeps its own payer after a
 * PO/job payer change); owner-paid invoices are not NV cash.
 */
export function paidInvoiceAmountByPO(invoices = [], posById = {}, jobsById = {}) {
  const out = {}
  for (const inv of invoices || []) {
    const po = posById[inv.po_id]
    if (!po) continue
    if (invoicePayer(inv, po, jobsById[po.job_id]) !== 'nv') continue
    const paid = invoicePaid(inv)
    if (paid <= 0) continue
    out[inv.po_id] = r2((out[inv.po_id] || 0) + paid)
  }
  return out
}
