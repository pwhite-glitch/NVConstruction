// Purchase-order cash rule shared by the job Cash Flow tab (app/jobdetail) and the
// Owner cash outlook (lib/cash-outlook.js poItems). Pure — no DB imports.
//
// Rule (per PO — never assume all POs are one kind):
//  • Only OPEN POs count: status 'issued' or 'received' (draft / closed do not).
//  • Who pays the vendor comes from lib/po-invoices.js effectivePOPayer(po, job):
//    the PO's payer_override, else the job's po_payer (migration 082), else (before 082)
//    the PO's own payment_type ('reimbursement' = NV pays, anything else = owner).
//  • NV pays → an estimated cash OUT. Owner pays → the client owner writes the check to
//    the vendor: disclosed (count / total), never counted as NV cash out.
//  • What NV already paid on the PO comes off the estimate. Two records can say so:
//    approved direct costs linked to the PO (direct_costs.purchase_order_id, migration 067;
//    credits add back) and checks recorded on the PO's invoices (po_invoices.paid_amount,
//    migration 082). They describe the SAME vendor payment when both are logged, so the
//    LARGER of the two is used — never the sum (no double count). Remaining never < $0.
// Before 067 / 082 neither record exists, so remaining = full amount (legacy behavior).
import { effectivePOPayer } from './po-invoices'

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// `job` is the PO's job row (optional). Without it (and without payer_override) the legacy
// payment_type rule applies, exactly as before prompt 99.
export function isOwnerCheckPO(po, job) {
  return effectivePOPayer(po, job) !== 'nv'
}

export function isOpenPO(po) {
  return po?.status === 'issued' || po?.status === 'received'
}

export function linkedDcSignedAmount(dc) {
  if (!dc || dc.status !== 'approved') return 0
  const amt = Number(dc.amount || 0)
  if (!Number.isFinite(amt)) return 0
  return dc.is_credit ? -amt : amt
}

// invoicePaid: dollars recorded as paid on the PO's invoices (paidInvoiceAmountByPO).
export function poRemainingAmount(po, linkedApprovedDcs = [], invoicePaid = 0) {
  const dcPaid = (linkedApprovedDcs || []).reduce((a, dc) => a + linkedDcSignedAmount(dc), 0)
  const invPaid = Number(invoicePaid) || 0
  const paid = Math.max(dcPaid, invPaid)
  const amt = Number(po?.amount || 0)
  return Math.max(0, round2((Number.isFinite(amt) ? amt : 0) - paid))
}

/** Approved direct costs grouped by purchase_order_id: { [poId]: [dc] }. */
export function linkedDcsByPO(directCosts = []) {
  const out = {}
  for (const dc of directCosts || []) {
    if (!dc?.purchase_order_id || dc.status !== 'approved') continue
    ;(out[dc.purchase_order_id] = out[dc.purchase_order_id] || []).push(dc)
  }
  return out
}

/**
 * Job Cash Flow "POs out": open, NV-paid (reimbursement) POs by issued month (YYYY-MM),
 * amount = remaining after linked approved costs. No +30 days here (the outlook adds it).
 * POs with no issued_date land in 'unknown' (left out of the month rows like other
 * undated cash-flow entries, but still in the total).
 */
export function poCashOutByMonth(pos = [], directCosts = [], { monthKey, job = null, invoicePaidByPO = {} } = {}) {
  const linked = linkedDcsByPO(directCosts)
  const keyOf = monthKey || (po => String(po.issued_date || '').slice(0, 7) || 'unknown')
  const out = {}
  for (const po of pos || []) {
    if (!isOpenPO(po) || isOwnerCheckPO(po, job)) continue
    const amount = poRemainingAmount(po, linked[po.id], invoicePaidByPO[po.id])
    if (amount <= 0) continue
    const key = keyOf(po)
    out[key] = round2((out[key] || 0) + amount)
  }
  return out
}

/** Open owner-check POs: disclosed at full amount, not counted. */
export function summarizeOwnerCheckPOs(pos = [], { job = null } = {}) {
  let count = 0, total = 0
  for (const po of pos || []) {
    if (!isOpenPO(po) || !isOwnerCheckPO(po, job)) continue
    const amt = Number(po.amount || 0)
    count += 1
    total += Number.isFinite(amt) ? amt : 0
  }
  return { count, total: round2(total) }
}

/** '' / undefined / null → null; otherwise the trimmed id string. */
// A lookup by a malformed id (not a uuid) fails in Postgres with 22P02. That is a bad
// request, not a server error.
export function isInvalidIdError(error) {
  if (!error) return false
  return error.code === '22P02' || /invalid input syntax for type uuid/i.test(String(error.message || ''))
}

export function normalizePoId(v) {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s ? s : null
}

/**
 * Pure check of a link: null when ok, else { status, error }.
 * Any PO status may be linked (an invoice can be logged after the PO closes);
 * payment_type is not forced.
 */
export function poLinkError(po, jobId) {
  if (!po) return { status: 400, error: 'That purchase order was not found.' }
  if (String(po.job_id) !== String(jobId)) return { status: 400, error: 'That purchase order belongs to a different job.' }
  return null
}

/** True when a DB error says direct_costs.purchase_order_id does not exist (067 not applied). */
export function isMissingPoLinkColumn(error) {
  if (!error) return false
  const msg = String(error.message || '')
  if (!/purchase_order_id/.test(msg)) return false
  return ['42703', 'PGRST204', 'PGRST202'].includes(error.code) || /schema cache|does not exist|could not find/i.test(msg)
}
