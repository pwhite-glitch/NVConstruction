// Per-target authorization for direct-upload issuance (prompt 78). SERVER ONLY.
// Each guard mirrors the business route that will later record the file, using the row
// stored in the database (never a job / order / vehicle id the client claims for an existing
// row). Returns { ctx } (the receipt context) or { error: Response }. The business routes
// repeat their own guards at record time; a receipt never bypasses them.
import { denyJob, denyUnlessOnJob, jobAccessError } from './roles'
import { dcBilledLinkError } from './dc-guards'
import { billingContext } from './sub-access'
import { isMb, canWorkMbOrder, ALL_DOC_CATEGORIES, MB_FORM_CATEGORIES, CLIENT_FORM_EXTS, SUPPLIER_FORM_EXTS } from './mb-orders'
import { isSubcontractSigned } from './signing'
import { isUuid } from './generated-contract'
import { AI_PARSE_MAX_BYTES, AI_PARSE_TYPES, AI_PARSE_LIMIT_PRECHECK_MESSAGE, AI_PARSE_TYPE_MESSAGE } from './ai-parse-limits'

const PM_ROLES = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
const SUB_ROLES = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
export const SALES_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
export const PO_CLOSED_MESSAGE = 'This purchase order is closed and cannot be edited.'

const no = (error, status) => ({ error: Response.json({ error }, { status }) })
const forbidden = () => no('Forbidden', 403)
const idOf = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function loadRow(db, table, cols, id, label = 'Not found.') {
  if (!id) return no(`${table === 'jobs' ? 'job_id' : 'record_id'} required`, 400)
  const { data, error } = await db.from(table).select(cols).eq('id', id).maybeSingle()
  if (error) return no(error.message, 500)
  if (!data) return no(label, 404)
  return { row: data }
}

// Existing row: its stored job wins; a different job_id in the body is refused outright.
function jobMismatch(body, row) {
  if (body.job_id !== undefined && body.job_id !== null && String(body.job_id) !== String(row.job_id)) {
    return no('That record is on a different job.', 400)
  }
  return null
}

// Create on a job: the job must exist and pass `deny` (denyJob or the stricter denyUnlessOnJob).
async function newOnJob(db, auth, body, deny = denyJob) {
  const jobId = idOf(body.job_id)
  if (!jobId) return no('job_id required', 400)
  const denied = await deny(db, auth, jobId)
  if (denied) return { error: denied }
  const j = await loadRow(db, 'jobs', 'id', jobId, 'Job not found.')
  if (j.error) return j
  return { ctx: { job: j.row.id } }
}

// Existing row on a job: load it, refuse a mismatched job_id, run `deny` on the stored job.
async function existingOnJob(db, auth, body, table, cols, deny = denyJob, label) {
  const r = await loadRow(db, table, cols, idOf(body.record_id), label)
  if (r.error) return r
  const mismatch = jobMismatch(body, r.row)
  if (mismatch) return mismatch
  const denied = await deny(db, auth, r.row.job_id)
  if (denied) return { error: denied }
  return { row: r.row, ctx: { job: r.row.job_id, rec: r.row.id } }
}

// Direct-cost resubmit: field supers must be on the job (denyUnlessOnJob); office roles use the
// direct-cost job check (jobAccessError). Shared with /api/dc-review resubmit.
export async function dcResubmitJobDenied(db, auth, jobId) {
  if (auth.role === 'super') return denyUnlessOnJob(db, auth, jobId)
  const err = await jobAccessError(db, auth, jobId)
  return err ? Response.json({ error: err.error }, { status: err.status }) : null
}

// Sales docs: same order / MB checks as /api/sales-order-docs.
export async function loadSalesOrder(db, orderId) {
  if (!orderId || typeof orderId !== 'string') return no('order_id required', 400)
  const { data, error } = await db.from('sales_orders').select('id, division, salesperson_id, ops_owner_id').eq('id', orderId).maybeSingle()
  if (error) return no(error.message, 500)
  if (!data) return no('Order not found', 404)
  return { order: data }
}
export async function salesMbDenied(db, auth, order) {
  if (!isMb(order)) return null
  const { data: attribution, error } = await db.from('sales_attribution').select('salesperson_id').eq('order_id', order.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!canWorkMbOrder(auth, order, attribution || [])) return Response.json({ error: 'You are not on this order.' }, { status: 403 })
  return null
}
// Category + extension rules for a sales doc (MB forms). Returns an error message or null.
export function salesDocRuleError(order, category, fileName) {
  if (!ALL_DOC_CATEGORIES.includes(category)) return 'Unknown document category.'
  const mb = isMb(order)
  if (MB_FORM_CATEGORIES.includes(category) && !mb) return 'Order forms are only for metal-building orders.'
  if (mb) {
    const ext = String(fileName || '').split('.').pop().toLowerCase()
    if (category === 'client_order_form' && !CLIENT_FORM_EXTS.has(ext)) return 'Upload the client order form as a PDF (it is what the customer signs).'
    if (category === 'supplier_order_form' && !SUPPLIER_FORM_EXTS.has(ext)) return "The supplier's order form must be a PDF, image, Word or Excel file."
  }
  return null
}

// Sub billing doc: create needs billing on for this job (billingContext + can_bill + a billable
// contract, as /api/sub-portal/billing); an edit needs their OWN pending submission + job access.
export async function subBillingGuard(db, auth, { jobId, billing = null }) {
  if (billing) {
    if (billing.sub_id !== auth.userId) return forbidden()
    if (billing.status !== 'pending') return no('Cannot edit a submission that is not pending', 422)
    const ctx = await billingContext(auth, billing.job_id)
    if (ctx.error) return { error: ctx.error }
    return {}
  }
  const ctx = await billingContext(auth, jobId)
  if (ctx.error) return { error: ctx.error }
  if (!ctx.job.can_bill) return no('Billing is not enabled for you on this project.', 403)
  if (!ctx.contracts?.length) return no('No subcontract on file for this project.', 400)
  return {}
}

export const ISSUE_GUARDS = {
  async 'direct-cost-receipt'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    return newOnJob(db, auth, body)
  },

  async 'dc-resubmit-receipt'(db, auth, body) {
    const r = await loadRow(db, 'direct_costs', 'id, job_id, status, submitted_by, draw_request_id, drawn_application_id', idOf(body.record_id), 'Cost not found')
    if (r.error) return r
    const cost = r.row
    if (cost.submitted_by !== auth.userId) return no('Forbidden — only the original submitter can resubmit', 403)
    if (cost.status !== 'rejected') return no('Only rejected costs can be resubmitted', 422)
    const billed = await dcBilledLinkError(db, cost)
    if (billed) return no(billed.error, billed.status)
    const denied = await dcResubmitJobDenied(db, auth, cost.job_id)
    if (denied) return { error: denied }
    return { ctx: { job: cost.job_id, rec: cost.id } }
  },

  async 'gc-doc'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    if (!body.record_id) return newOnJob(db, auth, body)
    // doc_url is not a draw-locked field; the PUT re-checks the draw tag compare-and-set.
    return existingOnJob(db, auth, body, 'general_conditions', 'id, job_id, draw_request_id')
  },

  async 'submittal-doc'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    if (!body.record_id) return newOnJob(db, auth, body)
    return existingOnJob(db, auth, body, 'submittals', 'id, job_id')
  },

  async 'po-attachment'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    if (!body.record_id) return newOnJob(db, auth, body, denyUnlessOnJob)
    const r = await existingOnJob(db, auth, body, 'purchase_orders', 'id, job_id, status', denyUnlessOnJob, 'Purchase order not found.')
    if (r.error) return r
    if (r.row.status === 'closed') return no(PO_CLOSED_MESSAGE, 409)
    return r
  },

  async 'billing-doc'(db, auth, body) {
    if (PM_ROLES.has(auth.role)) {
      if (!body.record_id) return newOnJob(db, auth, body)
      return existingOnJob(db, auth, body, 'billing_submissions', 'id, job_id', denyJob, 'Not found')
    }
    if (!SUB_ROLES.has(auth.role)) return forbidden()
    if (!body.record_id) {
      const jobId = idOf(body.job_id)
      if (!jobId) return no('job_id required', 400)
      const g = await subBillingGuard(db, auth, { jobId })
      if (g.error) return g
      return { ctx: { job: jobId } }
    }
    const r = await loadRow(db, 'billing_submissions', 'id, job_id, sub_id, status', idOf(body.record_id), 'Not found')
    if (r.error) return r
    const mismatch = jobMismatch(body, r.row)
    if (mismatch) return mismatch
    const g = await subBillingGuard(db, auth, { billing: r.row })
    if (g.error) return g
    return { ctx: { job: r.row.job_id, rec: r.row.id } }
  },

  async 'vehicle-photo'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    const r = await loadRow(db, 'vehicles', 'id', idOf(body.vehicle_id), 'Vehicle not found.')
    if (r.error) return r.error.status === 400 ? no('vehicle_id required', 400) : r
    return { ctx: { vehicle: r.row.id } }
  },

  async 'sales-doc'(db, auth, body, meta) {
    if (!SALES_ROLES.has(auth.role)) return forbidden()
    const category = body.category || 'general'
    if (typeof category !== 'string' || !ALL_DOC_CATEGORIES.includes(category)) return no('Unknown document category.', 400)
    const o = await loadSalesOrder(db, idOf(body.order_id))
    if (o.error) return o
    const rule = salesDocRuleError(o.order, category, meta.fileName)
    if (rule) return no(rule, 400)
    const denied = await salesMbDenied(db, auth, o.order)
    if (denied) return { error: denied }
    return { ctx: { order: o.order.id, cat: category } }
  },

  async 'parse-estimate'(db, auth, body, meta) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    if (!AI_PARSE_TYPES.includes(meta.contentType)) return no(AI_PARSE_TYPE_MESSAGE, 400)
    if (meta.size > AI_PARSE_MAX_BYTES) return { error: Response.json({ error: AI_PARSE_LIMIT_PRECHECK_MESSAGE, code: 'ai_parse_limit' }, { status: 413 }) }
    return { ctx: { user: auth.userId } }
  },

  async 'generated-contract'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    if (!isUuid(body.record_id)) return no('record_id (subcontract id) required', 400)
    const r = await existingOnJob(db, auth, body, 'subcontracts', 'id, job_id', denyJob, 'Subcontract not found')
    if (r.error) return r
    return { ctx: r.ctx }
  },

  async 'signing-html'(db, auth, body) {
    if (!PM_ROLES.has(auth.role)) return forbidden()
    const jobId = idOf(body.job_id)
    if (!jobId) return no('job_id required', 400)
    const denied = await denyJob(db, auth, jobId)
    if (denied) return { error: denied }
    const sc = await signingSubcontractError(db, auth, jobId, body.record_id || null)
    if (sc.error) return sc
    return { ctx: { job: jobId, rec: sc.id || null, user: auth.userId } }
  },
}

// signing-html / POST /api/signing-requests: an optional subcontract must be real, on the same
// job, unsigned, and pass the job check. Returns { id } / {} or { error: Response }.
export async function signingSubcontractError(db, auth, jobId, subcontractId) {
  if (!subcontractId) return {}
  const { data: sc, error } = await db.from('subcontracts').select('id, job_id, status, signed_at, signed_contract_url').eq('id', subcontractId).maybeSingle()
  if (error) return no(error.message, 500)
  if (!sc) return no('Subcontract not found.', 404)
  const denied = await denyJob(db, auth, sc.job_id)
  if (denied) return { error: denied }
  if (sc.job_id !== jobId) return no('That subcontract is on a different job.', 400)
  if (isSubcontractSigned(sc)) return no('This subcontract is already signed.', 409)
  return { id: sc.id }
}
