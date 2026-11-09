// Purchase-order cash rule shared by the job Cash Flow tab (app/jobdetail) and the
// Owner cash outlook (lib/cash-outlook.js poItems). Pure — no DB imports.
//
// Rule (per PO, from its own payment_type — never assume all POs are one kind):
//  • Only OPEN POs count: status 'issued' or 'received' (draft / closed do not).
//  • payment_type 'reimbursement' → NV pays the vendor: an estimated cash OUT.
//  • anything else ('check', null, unknown) → the client owner writes the check to
//    the vendor: disclosed (count / total), never counted as NV cash out.
//  • A direct cost linked to the PO (direct_costs.purchase_order_id, migration 067)
//    is the invoice paying that PO down: only APPROVED linked costs reduce the PO,
//    credits (is_credit) add back. Remaining never goes below $0.
// Before migration 067 no cost carries purchase_order_id, so remaining = full amount.

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function isOwnerCheckPO(po) {
  return po?.payment_type !== 'reimbursement'
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

export function poRemainingAmount(po, linkedApprovedDcs = []) {
  const paid = (linkedApprovedDcs || []).reduce((a, dc) => a + linkedDcSignedAmount(dc), 0)
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
export function poCashOutByMonth(pos = [], directCosts = [], { monthKey } = {}) {
  const linked = linkedDcsByPO(directCosts)
  const keyOf = monthKey || (po => String(po.issued_date || '').slice(0, 7) || 'unknown')
  const out = {}
  for (const po of pos || []) {
    if (!isOpenPO(po) || isOwnerCheckPO(po)) continue
    const amount = poRemainingAmount(po, linked[po.id])
    if (amount <= 0) continue
    const key = keyOf(po)
    out[key] = round2((out[key] || 0) + amount)
  }
  return out
}

/** Open owner-check POs: disclosed at full amount, not counted. */
export function summarizeOwnerCheckPOs(pos = []) {
  let count = 0, total = 0
  for (const po of pos || []) {
    if (!isOpenPO(po) || !isOwnerCheckPO(po)) continue
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
