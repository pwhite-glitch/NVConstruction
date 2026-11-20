// Who may do what with a PO invoice (prompt 99). SERVER ONLY — every check uses the
// session user's stored role (lib/server-auth requireAuth → profiles.role) and stored job
// membership, never a role or job the client sends.
//
//   add / edit / delete an unapproved invoice: Owner, admin, or PM/APM/super ON the job
//                                              (denyUnlessOnJob, same as the PO routes)
//   approve (→ Ready to pay), mark "paid by owner":
//                                              Owner (principal), or PM/APM ON the job.
//                                              Admin and super can NOT approve.
//   mark paid (record a check):                Owner, or a role with po.mark_paid
//                                              (role_permissions; admin on by default)
//   send back (reason required):               anyone who may approve OR mark paid
import { isOnJob, denyUnlessOnJob, isPrincipal } from './roles'
import { hasPermissionOr } from './permissions'
import { PO_MARK_PAID_PERMISSION } from './po-invoices'

export const APPROVER_ROLES = new Set(['principal', 'pm', 'apm'])
export const NOT_APPROVER_MESSAGE = "Only this job's PM / APM or an Owner can approve PO invoices."
export const NOT_PAYER_MESSAGE = 'You do not have permission to mark PO invoices paid (po.mark_paid).'

// Default when role_permissions has no po.mark_paid row for the role yet (082 seed not applied).
export const markPaidDefault = role => role === 'admin'

/** Null when allowed, else a Response. */
export async function denyUnlessApprover(db, auth, jobId) {
  const role = auth?.role
  if (isPrincipal(role)) return null
  if (role !== 'pm' && role !== 'apm') return Response.json({ error: NOT_APPROVER_MESSAGE }, { status: 403 })
  if (!jobId) return Response.json({ error: 'Job not found.' }, { status: 404 })
  const r = await isOnJob(db, auth, jobId)
  if (r.error) return Response.json({ error: r.error.message || 'Could not check job access.' }, { status: 500 })
  return r.ok ? null : Response.json({ error: NOT_APPROVER_MESSAGE }, { status: 403 })
}

export async function canMarkPOPaid(role) {
  if (isPrincipal(role)) return true
  if (!role) return false
  return hasPermissionOr(role, PO_MARK_PAID_PERMISSION, markPaidDefault(role))
}

/** Null when allowed, else a Response. Payers see every job (the admin list is company-wide). */
export async function denyUnlessPayer(auth) {
  return (await canMarkPOPaid(auth?.role)) ? null : Response.json({ error: NOT_PAYER_MESSAGE }, { status: 403 })
}

/** Send back: an approver on the job, or a payer. */
export async function denyUnlessSendBack(db, auth, jobId) {
  if (await canMarkPOPaid(auth?.role)) return null
  return denyUnlessApprover(db, auth, jobId)
}

/** Add / edit / delete / view a job's invoices: same rule as the PO routes. */
export const denyUnlessOnPOJob = (db, auth, jobId) => denyUnlessOnJob(db, auth, jobId)

/** { approve, mark_paid } for the UI — the server still re-checks every action. */
export async function invoiceCapabilities(db, auth, jobId) {
  const approve = !(await denyUnlessApprover(db, auth, jobId))
  const mark_paid = await canMarkPOPaid(auth?.role)
  return { approve, mark_paid }
}
