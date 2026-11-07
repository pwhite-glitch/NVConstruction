// Job lifecycle rules: Archive / Unarchive, which dashboard list a job is in,
// and what financial history blocks "Delete permanently".
// No server imports: the dashboard, job page, API routes and tests all use it.
import { billingDeleteBlock } from './billing-fields'
import { isAiaLocked } from './aia-lock'
import { isSubcontractSigned } from './signing'

// ── Archive ──────────────────────────────────────────────────────────────────
// Archive / Unarchive only ever writes `archived`. Status is left as it was, so
// an archived Complete job is still Complete (and an Active one comes back
// Active on Unarchive). The dashboard hides archived jobs by the flag itself.
export function archivePayload(archived) {
  return { archived: !!archived }
}

// Saving Details with Status changed TO Active clears the archive flag, so a
// job can't be "Archived" and freshly set Active at the same time. A save that
// leaves Status as it was does not unarchive (otherwise any edit would).
export function statusSaveClearsArchived(job, nextStatus) {
  return !!job?.archived && nextStatus === 'active' && job?.status !== 'active'
}

// Dashboard buckets. Active = not archived and not complete (Active lists and
// Active Contract Sum). The Completed tab also shows archived jobs, badged.
export const isArchivedJob = j => !!j?.archived
export const inActiveJobList = j => !isArchivedJob(j) && j?.status !== 'complete'
export const inCompletedJobList = j => isArchivedJob(j) || j?.status === 'complete'
// For the places that count only status 'active' jobs (calendar, reports).
export const isActiveStatusJob = j => !isArchivedJob(j) && j?.status === 'active'

// ── Delete permanently ──────────────────────────────────────────────────────
// `h` is the job's rows, as read by /api/jobs/delete:
//   billings (billing_submissions), draws (draw_requests), aiaApps
//   (aia_applications), subcontracts, directCosts, purchaseOrders,
//   generalConditions, reimbInvoices (owner_reimb_invoices).
// Returns a list of reasons the job may not be deleted (empty = may delete).
// Delete never removes billings: pending ones must be deleted from Billing first
// (DELETE /api/billing-entry, which runs billingDeleteBlock on each).
export function jobDeleteBlockers(h = {}) {
  const reasons = []
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`
  const billings = h.billings || []
  const protectedBillings = billings.filter(b => billingDeleteBlock(b))
  if (protectedBillings.length) reasons.push(`${n(protectedBillings.length, 'sub billing is', 'sub billings are')} approved, on a draw, or paid.`)
  const pendingBillings = billings.length - protectedBillings.length
  if (pendingBillings) reasons.push(`${n(pendingBillings, 'other sub billing exists', 'other sub billings exist')}. Delete or reject them from the Billing tab first — this never deletes billings.`)
  const closedDraws = (h.draws || []).filter(d => d.status === 'closed')
  if (closedDraws.length) reasons.push(`${n(closedDraws.length, 'draw request is', 'draw requests are')} closed.`)
  const lockedAia = (h.aiaApps || []).filter(isAiaLocked)
  if (lockedAia.length) reasons.push(`${n(lockedAia.length, 'owner pay app is', 'owner pay apps are')} submitted, certified, or paid.`)
  const signed = (h.subcontracts || []).filter(isSubcontractSigned)
  if (signed.length) reasons.push(`${n(signed.length, 'subcontract is', 'subcontracts are')} signed.`)
  const drawnOrPaidDc = (h.directCosts || []).filter(d => d.draw_request_id || d.nv_paid)
  if (drawnOrPaidDc.length) reasons.push(`${n(drawnOrPaidDc.length, 'direct cost is', 'direct costs are')} on a draw or paid.`)
  const drawnPo = (h.purchaseOrders || []).filter(p => p.draw_request_id)
  if (drawnPo.length) reasons.push(`${n(drawnPo.length, 'purchase order is', 'purchase orders are')} on a draw.`)
  const drawnGc = (h.generalConditions || []).filter(g => g.draw_request_id)
  if (drawnGc.length) reasons.push(`${n(drawnGc.length, 'general conditions entry is', 'general conditions entries are')} on a draw.`)
  const invoices = (h.reimbInvoices || []).filter(i => i.status && i.status !== 'draft')
  if (invoices.length) reasons.push(`${n(invoices.length, 'owner reimbursement invoice has', 'owner reimbursement invoices have')} been issued.`)
  return reasons
}
