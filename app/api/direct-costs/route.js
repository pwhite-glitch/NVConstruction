import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { DC_APPROVER_ROLES, buildApprovalQueue, budgetLinesByJob } from '../../../lib/direct-cost-queue'
import { jobAccessError, budgetLineError, accessibleJobIds } from '../../../lib/dc-guards'
import { isJobLimited, denyJob, denyJobs, denyJobOf } from '../../../lib/roles'

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

// POST: insert a direct cost, optionally uploading a receipt file
// Accepts multipart FormData: file (optional) + "data" JSON string
// OR plain JSON body (no file)
// If the caller is a super (field), a receipt file is required.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let receipt_url = null
    let fileAttached = false

    const authRole = auth.role
    // PM/APM: every inserted row must be on one of their jobs
    const denyRows = r => Array.isArray(r) ? denyJobs(adminSupabase, auth, r.map(x => x?.job_id)) : denyJob(adminSupabase, auth, r?.job_id)

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')
      const denied = await denyRows(row)
      if (denied) return denied

      if (file && file.size > 0) {
        fileAttached = true
        const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')
        const safeExt = isPdf ? 'pdf' : 'jpg'
        const safeMime = isPdf ? 'application/pdf' : 'image/jpeg'
        const path = `${row.job_id}/${Date.now()}.${safeExt}`
        const buffer = Buffer.from(await file.arrayBuffer())
        const { error: uploadError } = await adminSupabase.storage
          .from('receipts')
          .upload(path, buffer, { contentType: safeMime })
        if (uploadError) return Response.json({ error: 'Receipt upload failed: ' + uploadError.message }, { status: 500 })
        receipt_url = path
      }
    } else {
      row = await request.json()
      const denied = await denyRows(row)
      if (denied) return denied
    }

    // Enforce receipt for field submissions (super role, status=pending)
    if (authRole === 'super' && !fileAttached && row.status === 'pending') {
      return Response.json({ error: 'A receipt photo or PDF is required before submitting.' }, { status: 400 })
    }

    // Strip fields that field workers (super) should not set
    if (authRole === 'super') {
      delete row.bill_to_owner
      delete row.owner_auth_ref
      delete row.billing_route
    }

    // Columns from migration 022 may not exist yet — retry without them on schema cache error
    const NEW_022_COLS = new Set(['vendor', 'rejection_reason', 'rejected_at', 'rejected_by', 'review_cycle', 'reviewed_by', 'reviewed_at', 'notif_sent_at', 'is_credit'])
    let insertRow = { ...row, receipt_url }
    let { error } = await adminSupabase.from('direct_costs').insert(insertRow)
    if (error && error.message && error.message.includes('schema cache')) {
      insertRow = Object.fromEntries(Object.entries(insertRow).filter(([k]) => !NEW_022_COLS.has(k)))
      const retry = await adminSupabase.from('direct_costs').insert(insertRow)
      error = retry.error
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
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

// PUT: update a direct cost by id
// Used for budget line assignment, job moves, and draw application linkage.
// Status transitions (approve/reject/resubmit) should go through /api/dc-review.
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id, ...fields } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { data: cost, error: fetchErr } = await adminSupabase.from('direct_costs')
      .select('id, job_id, budget_item_id, draw_request_id, drawn_application_id, billing_route').eq('id', id).maybeSingle()
    if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
    if (!cost) return Response.json({ error: 'Cost not found' }, { status: 404 })

    const denied = await jobAccessError(adminSupabase, auth, cost.job_id)
    if (denied) return Response.json({ error: denied.error }, { status: denied.status })

    // Job moves (job detail "Move to job") need access to the target job too, and must not
    // carry the old job's budget line along.
    const targetJob = fields.job_id ?? cost.job_id
    if (targetJob !== cost.job_id) {
      const deniedTarget = await jobAccessError(adminSupabase, auth, targetJob)
      if (deniedTarget) return Response.json({ error: deniedTarget.error }, { status: deniedTarget.status })
      if (fields.budget_item_id === undefined && cost.budget_item_id) {
        return Response.json({ error: 'Moving a cost to another job must clear or replace its budget line.' }, { status: 422 })
      }
      const moveBlock = await moveBlockedBy(cost)
      if (moveBlock) return Response.json({ error: moveBlock.error }, { status: moveBlock.status })
      // On an open draw of the old job: the move takes it off that draw.
      if (cost.draw_request_id) fields.draw_request_id = null
    }
    if (fields.budget_item_id === '') fields.budget_item_id = null
    if (fields.budget_item_id) {
      const badLine = await budgetLineError(adminSupabase, fields.budget_item_id, targetJob)
      if (badLine) return Response.json({ error: badLine.error }, { status: badLine.status })
    }

    const { error } = await adminSupabase.from('direct_costs').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
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
    const { error } = await adminSupabase.from('direct_costs').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
