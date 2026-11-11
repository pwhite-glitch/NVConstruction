import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { DC_APPROVER_ROLES, buildApprovalQueue, budgetLinesByJob } from '../../../lib/direct-cost-queue'
import { jobAccessError, budgetLineError, accessibleJobIds, dcBilledLinkError } from '../../../lib/dc-guards'
import { isJobLimited, denyJob, denyJobs, denyJobOf } from '../../../lib/roles'
import { normalizePoId, poLinkError, isInvalidIdError } from '../../../lib/po-cash'
import { writeWithMissingColumnRetry, poLinkDropped } from '../../../lib/missing-column-retry'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'

// Columns from migration 022 that may be missing. Only stripped as a group when a schema
// error doesn't name its column.
const NEW_022_COLS = ['vendor', 'rejection_reason', 'rejected_at', 'rejected_by', 'review_cycle', 'reviewed_by', 'reviewed_at', 'notif_sent_at']
// The only columns a missing-column retry may drop: the 022 columns plus purchase_order_id (067),
// which is dropped only when the error names it (never by the group strip). Any other named
// column (is_credit, amount, job_id, status …) returns the original error.
const OPTIONAL_COLS = [...NEW_022_COLS, 'purchase_order_id']

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Pending costs across every job the caller can see (dashboard "Costs to Approve").
// Principal/admin see all jobs; PM/APM only the jobs they are on (pm_job_assignments or pm_email).
// Also returns each job's budget lines (one query, keyed by job_id) for the line picker,
// and marks each cost can_approve (admins: always; PM/APM: only on jobs they are on, same as jobAccessError).
async function pendingQueue(auth) {
  let q = adminSupabase.from('direct_costs').select('*').eq('status', 'pending')
  const { ids: assigned, error: accessErr } = await accessibleJobIds(adminSupabase, auth)
  if (accessErr) return { error: accessErr }
  if (assigned) {
    if (isJobLimited(auth.role)) {
      if (assigned.size === 0) return { data: [], budgetLines: {} }
      q = q.in('job_id', [...assigned])
    }
  }
  const { data: costs, error } = await q
  if (error) return { error }
  if (!costs?.length) return { data: [], budgetLines: {} }

  const uniq = key => [...new Set(costs.map(c => c[key]).filter(Boolean))]
  const jobIds = uniq('job_id'), userIds = uniq('submitted_by')
  const [jobsRes, biRes, profRes] = await Promise.all([
    adminSupabase.from('jobs').select('id, job_number, project_name').in('id', jobIds),
    adminSupabase.from('budget_items').select('id, job_id, cost_code, description').in('job_id', jobIds),
    userIds.length ? adminSupabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
  ])
  if (biRes.error) return { error: biRes.error }
  const budgetItems = biRes.data || []
  const data = buildApprovalQueue(costs, { jobs: jobsRes.data || [], budgetItems, profiles: profRes.data || [] })
    .map(c => ({ ...c, can_approve: assigned === null || assigned.has(c.job_id) }))
  return { data, budgetLines: budgetLinesByJob(budgetItems) }
}

// GET: fetch direct costs for a job, or generate a signed receipt URL
// ?job_id=uuid  → list of costs
// ?status=pending (no job_id) → pending costs across visible jobs, oldest first (approvers only)
// ?receipt_path=... → { url } signed URL (valid 5 min)
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const receipt_path = searchParams.get('receipt_path')
    if (receipt_path) {
      const { data, error } = await adminSupabase.storage.from('receipts').createSignedUrl(receipt_path, 300)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }
    const job_id = searchParams.get('job_id')
    if (!job_id && searchParams.get('status') === 'pending') {
      if (!DC_APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { data, budgetLines, error } = await pendingQueue(auth)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ data, budget_lines: budgetLines })
    }
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase
      .from('direct_costs')
      .select('*')
      .eq('job_id', job_id)
      .order('cost_date', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: insert a direct cost (JSON only), optionally with a receipt uploaded directly to Storage.
// Body: a cost object, or an array of cost objects (CSV import).
// A receipt is attachment: { path, uploadReceipt } from POST /api/file-upload (target
// direct-cost-receipt) — allowed on a single cost or a one-row array only. Multipart is refused
// (files never pass through this function), and so is a raw receipt_url.
// If the caller is a super (field), a verified receipt is required for pending costs.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(request)
  if (multipart) return multipart
  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    let receipt_url = null
    let fileAttached = false

    const authRole = auth.role
    // PM/APM: every inserted row must be on one of their jobs
    const denyRows = r => Array.isArray(r) ? denyJobs(adminSupabase, auth, r.map(x => x?.job_id)) : denyJob(adminSupabase, auth, r?.job_id)

    // Bulk insert (CSV import on the job page) sends an array of rows; a single cost sends an object.
    const isBulk = Array.isArray(body)
    const rawRows = isBulk ? body : [body]
    if (!rawRows.length || rawRows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) {
      return Response.json({ error: isBulk ? 'Each imported cost must be an object.' : 'Send a cost object.' }, { status: 400 })
    }
    const inline = inlineFileContentError(rawRows)
    if (inline) return Response.json({ error: inline }, { status: 400 })
    // Every supplied receipt path is checked: a raw receipt_url (even on an imported row) is refused.
    if (rawRows.some(r => r.receipt_url !== undefined && r.receipt_url !== null && r.receipt_url !== '')) {
      return Response.json({ error: 'receipt_url cannot be set directly. Attach the receipt with a direct upload.' }, { status: 400 })
    }
    const attachments = rawRows.map(r => r.attachment).filter(a => a !== undefined && a !== null)
    // One receipt file belongs to one cost.
    if (attachments.length && rawRows.length !== 1) return Response.json({ error: 'A receipt can only be attached to a single cost.' }, { status: 400 })
    const rows = rawRows.map(({ attachment: _a, receipt_url: _r, ...r }) => r)
    const row = isBulk ? rows : rows[0]

    const denied = await denyRows(row)
    if (denied) return denied

    if (attachments.length) {
      const v = await verifyAttachment(adminSupabase, attachments[0], { target: 'direct-cost-receipt', subject: auth.userId, ctx: { job: rows[0].job_id } })
      if (!v.ok) return attachmentErrorResponse(v)
      receipt_url = v.path
      fileAttached = true
    }

    // Enforce receipt for field submissions (super role, status=pending)
    if (authRole === 'super' && !fileAttached && rows.some(r => r.status === 'pending')) {
      return Response.json({ error: 'A receipt photo or PDF is required before submitting.' }, { status: 400 })
    }

    // Strip fields that field workers (super) should not set
    if (authRole === 'super') {
      for (const r of rows) {
        delete r.bill_to_owner
        delete r.owner_auth_ref
        delete r.billing_route
      }
    }

    // Optional link to the PO this cost pays down (migration 067): same job only.
    const poErr = await poLinkCheck(row)
    if (poErr) return Response.json({ error: poErr.error }, { status: poErr.status })

    // Columns from migration 022 (e.g. vendor, missing live) and 067 (purchase_order_id) may not
    // exist yet: retry without ONLY the column the error names, if it is optional
    // (lib/missing-column-retry.js); a bulk insert drops it from every row.
    // Bulk rows carry receipt_url only when the one uploaded receipt applies (a single row).
    const insertRow = isBulk
      ? rows.map(r => (receipt_url && rows.length === 1 ? { ...r, receipt_url } : { ...r }))
      : { ...row, receipt_url }
    const { error, dropped } = await writeWithMissingColumnRetry(
      r => adminSupabase.from('direct_costs').insert(r), insertRow, { fallbackCols: OPTIONAL_COLS })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(poLinkDropped(insertRow, dropped) ? { ok: true, po_link_saved: false } : { ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// purchase_order_id on a new cost (or each row of a bulk insert): '' → null; a set id
// must be a PO on that cost's job. Any PO status / payment_type may be linked.
// Mutates row(s) to normalize the value. Returns null or { status, error }.
async function poLinkCheck(row) {
  const rows = Array.isArray(row) ? row : [row]
  const want = []
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !('purchase_order_id' in r)) continue
    r.purchase_order_id = normalizePoId(r.purchase_order_id)
    if (r.purchase_order_id) want.push(r)
  }
  if (!want.length) return null
  const ids = [...new Set(want.map(r => r.purchase_order_id))]
  const { data: pos, error } = await adminSupabase.from('purchase_orders').select('id, job_id').in('id', ids)
  if (error) {
    if (isInvalidIdError(error)) return { status: 400, error: 'Invalid purchase order: that is not a valid purchase order id.' }
    return { status: 500, error: 'Could not check the purchase order: ' + error.message }
  }
  const byId = Object.fromEntries((pos || []).map(p => [String(p.id), p]))
  for (const r of want) {
    const bad = poLinkError(byId[String(r.purchase_order_id)], r.job_id)
    if (bad) return bad
  }
  return null
}

// A cost that is already billed must not move to another job (that would unlink
// it and silently change the draw / pay app / invoice total). Returns null when
// the move may go ahead, else { status, error } naming the link.
async function moveBlockedBy(cost) {
  if (cost.drawn_application_id) {
    const { data: app } = await adminSupabase.from('aia_applications').select('app_number').eq('id', cost.drawn_application_id).maybeSingle()
    return { status: 409, error: `This cost is drawn on pay app #${app?.app_number ?? '?'}. Take it off the app before moving it.` }
  }
  if (cost.draw_request_id) {
    const { data: draw, error } = await adminSupabase.from('draw_requests').select('draw_number, status').eq('id', cost.draw_request_id).maybeSingle()
    if (error) return { status: 500, error: error.message }
    if (draw && draw.status !== 'open') {
      return { status: 409, error: `This cost is on Draw #${draw.draw_number}, which is ${draw.status || 'not open'}. It can't be moved to another job.` }
    }
  }
  const { data: invLines, error: invErr } = await adminSupabase
    .from('owner_reimb_invoice_lines')
    .select('invoice_id, owner_reimb_invoices!inner(invoice_number, status)')
    .eq('direct_cost_id', cost.id)
    .neq('owner_reimb_invoices.status', 'voided')
    .limit(1)
  if (invErr) return { status: 500, error: 'Could not check owner reimbursement invoices: ' + invErr.message }
  if (invLines?.length) {
    const inv = invLines[0].owner_reimb_invoices
    return { status: 409, error: `This cost is on owner reimbursement invoice ${inv?.invoice_number || ''} (${inv?.status || 'open'}). Remove it from the invoice (or void the invoice) before moving it.` }
  }
  return null
}

// Fields PUT may change. Everything else is refused (400) so raw fields can't skip the
// review guards: status / amount go through /api/dc-review, draw tagging through
// /api/draw-requests (add_dc_ids / remove_dc_ids), pay-app draws through /api/aia-draw.
const DC_PUT_FIELDS = new Set(['job_id', 'budget_item_id'])
const DC_PUT_ROUTED = {
  draw_request_id: 'Add or remove draw requests from the Draws tab (/api/draw-requests).',
  drawn_application_id: 'Draw or undo on the owner pay app (/api/aia-draw).',
  drawn_at: 'Draw or undo on the owner pay app (/api/aia-draw).',
  status: 'Approve / reject / reopen through the review actions (/api/dc-review).',
  amount: 'Edit the amount through Review / Edit (/api/dc-review).',
}

// PUT { id, budget_item_id? , job_id? }
// Used for budget line assignment and job moves only.
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id, ...raw } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    for (const k of Object.keys(raw)) {
      if (DC_PUT_FIELDS.has(k)) continue
      return Response.json({ error: `"${k}" can't be changed here. ${DC_PUT_ROUTED[k] || ''}`.trim() }, { status: 400 })
    }
    const fields = {}
    for (const k of DC_PUT_FIELDS) if (k in raw) fields[k] = raw[k]
    if (!Object.keys(fields).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })

    const { data: cost, error: fetchErr } = await adminSupabase.from('direct_costs')
      .select('id, job_id, budget_item_id, draw_request_id, drawn_application_id, billing_route').eq('id', id).maybeSingle()
    if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
    if (!cost) return Response.json({ error: 'Cost not found' }, { status: 404 })

    const denied = await jobAccessError(adminSupabase, auth, cost.job_id)
    if (denied) return Response.json({ error: denied.error }, { status: denied.status })

    // Job moves (job detail "Move to job") need access to the target job too, and must not
    // carry the old job's budget line along.
    const targetJob = fields.job_id ?? cost.job_id
    const moving = targetJob !== cost.job_id
    if (moving) {
      const deniedTarget = await jobAccessError(adminSupabase, auth, targetJob)
      if (deniedTarget) return Response.json({ error: deniedTarget.error }, { status: deniedTarget.status })
      if (fields.budget_item_id === undefined && cost.budget_item_id) {
        return Response.json({ error: 'Moving a cost to another job must clear or replace its budget line.' }, { status: 422 })
      }
      const moveBlock = await moveBlockedBy(cost)
      if (moveBlock) return Response.json({ error: moveBlock.error }, { status: moveBlock.status })
      // On an open draw of the old job: the move takes it off that draw (unchanged behaviour).
      if (cost.draw_request_id) fields.draw_request_id = null
    } else if ('budget_item_id' in fields && (fields.budget_item_id || null) !== (cost.budget_item_id || null)) {
      // Changing the budget line of a billed cost would move its dollars between G703 lines.
      const billed = await dcBilledLinkError(adminSupabase, cost)
      if (billed) return Response.json({ error: billed.error }, { status: billed.status })
    }
    if (fields.budget_item_id === '') fields.budget_item_id = null
    if (fields.budget_item_id) {
      const badLine = await budgetLineError(adminSupabase, fields.budget_item_id, targetJob)
      if (badLine) return Response.json({ error: badLine.error }, { status: badLine.status })
    }

    // A PO link (067) points at the old job's PO: clear it in the same update. Before 067 the
    // column is missing and the retry drops just that key.
    if (moving) fields.purchase_order_id = null

    // Only lands if the job and draw / pay-app links are still what we checked.
    const run = u => {
      let q = adminSupabase.from('direct_costs').update(u).eq('id', id).eq('job_id', cost.job_id).is('drawn_application_id', null)
      q = cost.draw_request_id ? q.eq('draw_request_id', cost.draw_request_id) : q.is('draw_request_id', null)
      return q.select('id')
    }
    const { data: rows, error } = moving
      ? await writeWithMissingColumnRetry(run, fields, { fallbackCols: ['purchase_order_id'] })
      : await run(fields)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return Response.json({ error: 'This cost changed (job, draw or pay app link) since you loaded it. Nothing was saved. Refresh and try again.' }, { status: 409 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: permanently delete a direct cost by id
// For actual deletions only — rejection now goes through /api/dc-review.
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'direct_costs', id)
    if (denied) return denied
    const { data: cost, error: fetchErr } = await adminSupabase.from('direct_costs')
      .select('id, job_id, draw_request_id, drawn_application_id').eq('id', id).maybeSingle()
    if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
    if (!cost) return Response.json({ error: 'Cost not found' }, { status: 404 })
    // A billed cost can't disappear out of a draw / pay app / invoice total.
    const billed = await dcBilledLinkError(adminSupabase, cost)
    if (billed) return Response.json({ error: billed.error }, { status: billed.status })
    const { data: rows, error } = await adminSupabase.from('direct_costs').delete().eq('id', id)
      .is('draw_request_id', null).is('drawn_application_id', null).select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return Response.json({ error: 'This cost was put on a draw or pay app since you loaded it. Nothing was deleted. Refresh and try again.' }, { status: 409 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
