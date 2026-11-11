import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { Resend } from 'resend'
import { DC_APPROVER_ROLES as APPROVER_ROLES } from '../../../lib/direct-cost-queue'
import { jobAccessError, budgetLineError, dcBilledLinkError } from '../../../lib/dc-guards'
import { normalizePoId, poLinkError, isInvalidIdError } from '../../../lib/po-cash'
import { writeWithMissingColumnRetry, poLinkDropped } from '../../../lib/missing-column-retry'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'
import { dcResubmitJobDenied } from '../../../lib/upload-guards'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// Columns added in migration 022 — may not exist yet (live has no vendor / review columns).
// Only stripped as a group when a schema error doesn't name its column; otherwise just the
// named column is dropped, and only if it is on OPTIONAL_COLS (lib/missing-column-retry.js).
// purchase_order_id (067) is droppable by name only, never group-stripped.
const NEW_022_COLS = ['vendor', 'rejection_reason', 'rejected_at', 'rejected_by', 'review_cycle', 'reviewed_by', 'reviewed_at', 'notif_sent_at']
const OPTIONAL_COLS = [...NEW_022_COLS, 'purchase_order_id']
const retryOpts = { fallbackCols: OPTIONAL_COLS }

// Try the update; if Supabase reports a missing column, drop it and retry so
// pre-migration databases keep working.
async function dcUpdate(updates, id) {
  const { error } = await writeWithMissingColumnRetry(u => adminSupabase.from('direct_costs').update(u).eq('id', id), updates, retryOpts)
  return error || null
}

// Approve only if the row is still pending on the same job, saving the budget line in the
// same statement. Returns { error } or { rows } (rows empty = someone else got there first).
async function dcApproveIfPending(updates, cost) {
  const run = u => adminSupabase.from('direct_costs').update(u)
    .eq('id', cost.id).eq('status', 'pending').eq('job_id', cost.job_id)
    .select('id')
  const { data, error } = await writeWithMissingColumnRetry(run, updates, retryOpts)
  if (error) return { error }
  return { rows: data || [] }
}

// Status / money change that only lands if the row is still exactly what we checked:
// same status, same job, and still on no draw request and no pay app. Returns
// { error } or { rows, poLinkDropped } (rows empty = it changed under us; nothing was written).
// poLinkDropped: a PO link was asked for but the column is missing (067 not applied).
async function dcUpdateIfUnchanged(updates, cost) {
  const run = u => adminSupabase.from('direct_costs').update(u)
    .eq('id', cost.id).eq('status', cost.status).eq('job_id', cost.job_id)
    .is('draw_request_id', null).is('drawn_application_id', null)
    .select('id')
  const { data, error, dropped } = await writeWithMissingColumnRetry(run, updates, retryOpts)
  if (error) return { error }
  return { rows: data || [], poLinkDropped: poLinkDropped(updates, dropped) }
}

const STALE = 'This cost changed (status or draw / pay app link) since you loaded it. Nothing was saved. Refresh and try again.'

// Every office action: approver role, on the cost's job, and the cost is not billed.
// Returns a Response to send back, or null.
async function officeGuard(auth, cost) {
  if (!APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await jobAccessError(adminSupabase, auth, cost.job_id)
  if (denied) return Response.json({ error: denied.error }, { status: denied.status })
  const billed = await dcBilledLinkError(adminSupabase, cost)
  if (billed) return Response.json({ error: billed.error }, { status: billed.status })
  return null
}

const ALREADY_HANDLED = status =>
  `This cost was already handled${status && status !== 'pending' ? ` (it is now ${status})` : ''}. Refresh the list.`

// POST /api/dc-review
// Handles all status transitions for direct cost entries.
// Body (JSON): { action, id, ...fields }
// resubmit may carry attachment: { path, uploadReceipt } (a replacement receipt uploaded directly
// to Storage via POST /api/file-upload, target dc-resubmit-receipt). Multipart is refused.
//
// Actions:
//   approve   — PM/admin: approve a pending cost
//   unapprove — PM/admin: set approved cost back to pending (undo)
//   reject    — PM/admin: reject with required reason; preserves record, notifies submitter
//   edit      — PM/admin: update allowed fields on any cost
//   resubmit  — Super: correct and resubmit their own rejected cost
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(request)
  if (multipart) return multipart

  let body = {}
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { action, id, attachment, ...fields } = body
  if (!action || !id) return Response.json({ error: 'action and id are required' }, { status: 400 })
  // Only a resubmit can replace the receipt; no other action gains an upload.
  if (attachment !== undefined && attachment !== null && action !== 'resubmit') {
    return Response.json({ error: 'Only a resubmit can attach a new receipt.' }, { status: 400 })
  }
  const inline = inlineFileContentError(fields)
  if (inline) return Response.json({ error: inline }, { status: 400 })

  const { data: cost, error: fetchErr } = await adminSupabase
    .from('direct_costs')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !cost) return Response.json({ error: 'Cost not found' }, { status: 404 })

  // Fetch submitter profile separately (no FK declared from submitted_by to profiles)
  let submitterProfile = null
  if (cost.submitted_by) {
    const { data: p } = await adminSupabase
      .from('profiles')
      .select('id, full_name, invite_email')
      .eq('id', cost.submitted_by)
      .maybeSingle()
    // profiles has invite_email (no email column)
    submitterProfile = p ? { ...p, email: p.invite_email || null } : null
  }

  const { data: jobRow } = await adminSupabase
    .from('jobs')
    .select('job_number, project_name')
    .eq('id', cost.job_id)
    .maybeSingle()

  const now = new Date().toISOString()
  const jobLabel = jobRow ? `#${jobRow.job_number} — ${jobRow.project_name}` : 'your project'

  // ── APPROVE ──────────────────────────────────────────────────────────────────
  if (action === 'approve') {
    if (!APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (cost.status !== 'pending') return Response.json({ error: ALREADY_HANDLED(cost.status) }, { status: 409 })
    const blocked = await officeGuard(auth, cost)
    if (blocked) return blocked

    // Optional budget_item_id picked in the approval queue; otherwise the one already on the cost.
    const lineId = fields.budget_item_id || cost.budget_item_id
    if (!lineId) return Response.json({ error: 'A budget line must be assigned before approving.' }, { status: 422 })
    const badLine = await budgetLineError(adminSupabase, lineId, cost.job_id)
    if (badLine) return Response.json({ error: badLine.error }, { status: badLine.status })

    const { rows, error } = await dcApproveIfPending(
      { status: 'approved', budget_item_id: lineId, reviewed_by: auth.userId, reviewed_at: now }, cost)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows.length) {
      const { data: latest } = await adminSupabase.from('direct_costs').select('status').eq('id', id).maybeSingle()
      return Response.json({ error: ALREADY_HANDLED(latest?.status) }, { status: 409 })
    }
    return Response.json({ ok: true })
  }

  // ── UNAPPROVE ────────────────────────────────────────────────────────────────
  if (action === 'unapprove') {
    const blocked = await officeGuard(auth, cost)
    if (blocked) return blocked
    if (cost.status !== 'approved') return Response.json({ error: 'Only approved costs can be unapproved' }, { status: 422 })
    const { rows, error } = await dcUpdateIfUnchanged({ status: 'pending', reviewed_by: null, reviewed_at: null }, cost)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows.length) return Response.json({ error: STALE }, { status: 409 })
    return Response.json({ ok: true })
  }

  // ── REJECT ───────────────────────────────────────────────────────────────────
  if (action === 'reject') {
    const blocked = await officeGuard(auth, cost)
    if (blocked) return blocked
    if (!['pending', 'approved'].includes(cost.status)) {
      return Response.json({ error: 'Only pending or approved costs can be rejected' }, { status: 422 })
    }

    const rejection_reason = (fields.rejection_reason || '').trim()
    if (!rejection_reason) return Response.json({ error: 'A rejection reason is required' }, { status: 400 })

    const newCycle = (cost.review_cycle || 0) + 1

    // The row is kept (status rejected + reason); nothing is deleted.
    const { rows: rejRows, error: upErr } = await dcUpdateIfUnchanged({
      status: 'rejected',
      rejection_reason,
      rejected_at: now,
      rejected_by: auth.userId,
      review_cycle: newCycle,
      reviewed_by: auth.userId,
      reviewed_at: now,
    }, cost)

    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
    if (!rejRows.length) return Response.json({ error: STALE }, { status: 409 })

    const submitterEmail = submitterProfile?.email
    const submitterName = submitterProfile?.full_name || 'Superintendent'
    const amountStr = `$${Number(cost.amount).toLocaleString()}`
    const dedupKey = `dc_reject_${id}_v${newCycle}`

    // In-app notification (deduped)
    if (cost.submitted_by) {
      const { data: existing } = await adminSupabase
        .from('notifications')
        .select('id')
        .eq('dedup_key', dedupKey)
        .maybeSingle()

      if (!existing) {
        await adminSupabase.from('notifications').insert({
          recipient_id: cost.submitted_by,
          type: 'dc_rejected',
          title: 'Cost entry rejected',
          body: `"${cost.description}" (${amountStr}) on ${jobLabel} was rejected. Reason: ${rejection_reason}`,
          link: `/field?job=${cost.job_id}&tab=costs`,
          job_id: cost.job_id,
          entity_type: 'direct_cost',
          entity_id: id,
          dedup_key: dedupKey,
        })
      }
    }

    // Email (failure is non-fatal — rejection is already committed)
    if (submitterEmail) {
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'NV Construction <noreply@nvim.co>',
          to: submitterEmail,
          subject: `Cost entry rejected — ${jobLabel}`,
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;padding:2rem;border-radius:12px;border:1px solid #222">
              <div style="margin-bottom:1.5rem">
                <span style="font-weight:800;font-size:15px;color:#e8590c;letter-spacing:2px;text-transform:uppercase">NV Construction</span>
              </div>
              <h2 style="color:#ff6b6b;margin:0 0 1rem">Cost entry rejected</h2>
              <p style="color:#aaa">Hi ${submitterName},</p>
              <p style="color:#aaa">Your expense <strong style="color:#f1f1f1">${cost.description}</strong> (${amountStr}) on <strong style="color:#f1f1f1">${jobLabel}</strong> has been rejected.</p>
              ${cost.vendor ? `<p style="color:#aaa;font-size:13px">Vendor: ${cost.vendor}</p>` : ''}
              <div style="background:#1a0a0a;border:1px solid #5a1a1a;border-radius:8px;padding:14px 16px;margin:1rem 0">
                <p style="color:#888;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">Reason</p>
                <p style="color:#ff6b6b;margin:0;font-size:14px;line-height:1.6">${rejection_reason}</p>
              </div>
              <p style="color:#aaa;font-size:13px">Please open the field portal, correct the entry, and resubmit. Your original record is preserved.</p>
              <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #222;font-size:12px;color:#555">NV Construction · Field Portal</div>
            </div>
          `,
        })
        await dcUpdate({ notif_sent_at: now }, id)
      } catch (_) {}
    }

    return Response.json({ ok: true })
  }

  // ── REOPEN (undo reject → pending) ──────────────────────────────────────────
  if (action === 'reopen') {
    const blocked = await officeGuard(auth, cost)
    if (blocked) return blocked
    if (cost.status !== 'rejected') return Response.json({ error: 'Only rejected costs can be reopened' }, { status: 422 })
    const { rows, error } = await dcUpdateIfUnchanged({ status: 'pending', rejection_reason: null, rejected_at: null, rejected_by: null }, cost)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows.length) return Response.json({ error: STALE }, { status: 409 })
    return Response.json({ ok: true })
  }

  // ── EDIT ─────────────────────────────────────────────────────────────────────
  if (action === 'edit') {
    const blocked = await officeGuard(auth, cost)
    if (blocked) return blocked
    if (fields.budget_item_id) {
      const badLine = await budgetLineError(adminSupabase, fields.budget_item_id, cost.job_id)
      if (badLine) return Response.json({ error: badLine.error }, { status: badLine.status })
    }

    // purchase_order_id (migration 067): the PO this cost pays down — same job only; '' / null clears.
    if (fields.purchase_order_id !== undefined) {
      fields.purchase_order_id = normalizePoId(fields.purchase_order_id)
      if (fields.purchase_order_id) {
        const { data: po, error: poErr } = await adminSupabase.from('purchase_orders').select('id, job_id').eq('id', fields.purchase_order_id).maybeSingle()
        if (poErr && isInvalidIdError(poErr)) return Response.json({ error: 'Invalid purchase order: that is not a valid purchase order id.' }, { status: 400 })
        if (poErr) return Response.json({ error: 'Could not check the purchase order: ' + poErr.message }, { status: 500 })
        const bad = poLinkError(po, cost.job_id)
        if (bad) return Response.json({ error: bad.error }, { status: bad.status })
      }
    }

    const EDITABLE = ['cost_date', 'vendor', 'description', 'amount', 'category', 'notes', 'budget_item_id', 'bill_to_owner', 'owner_auth_ref', 'purchase_order_id']
    const UUID_FIELDS = new Set(['budget_item_id', 'purchase_order_id'])
    const updates = { reviewed_by: auth.userId, reviewed_at: now }
    for (const f of EDITABLE) {
      if (fields[f] !== undefined) {
        // Convert empty strings to null for UUID columns (Postgres rejects "")
        updates[f] = (UUID_FIELDS.has(f) && fields[f] === '') ? null : fields[f]
      }
    }
    if (updates.amount !== undefined) {
      const parsed = parseFloat(updates.amount)
      if (isNaN(parsed) || parsed < 0) return Response.json({ error: 'Invalid amount' }, { status: 400 })
      updates.amount = parsed
    }

    const { rows, error, poLinkDropped } = await dcUpdateIfUnchanged(updates, cost)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows.length) return Response.json({ error: STALE }, { status: 409 })
    return Response.json(poLinkDropped ? { ok: true, po_link_saved: false } : { ok: true })
  }

  // ── RESUBMIT ─────────────────────────────────────────────────────────────────
  if (action === 'resubmit') {
    if (cost.submitted_by !== auth.userId) {
      return Response.json({ error: 'Forbidden — only the original submitter can resubmit' }, { status: 403 })
    }
    if (cost.status !== 'rejected') {
      return Response.json({ error: 'Only rejected costs can be resubmitted' }, { status: 422 })
    }
    const billed = await dcBilledLinkError(adminSupabase, cost)
    if (billed) return Response.json({ error: billed.error }, { status: billed.status })

    const EDITABLE = ['cost_date', 'vendor', 'description', 'amount', 'category', 'notes']
    const updates = {
      status: 'pending',
      rejection_reason: null,
      rejected_at: null,
      rejected_by: null,
    }
    for (const f of EDITABLE) {
      if (fields[f] !== undefined && fields[f] !== null && fields[f] !== '') {
        updates[f] = fields[f]
      }
    }
    if (updates.amount !== undefined) {
      const parsed = parseFloat(updates.amount)
      if (isNaN(parsed) || parsed <= 0) return Response.json({ error: 'Amount must be a positive number' }, { status: 400 })
      updates.amount = parsed
    }

    // Replacement receipt (optional; none keeps the existing one): uploaded directly, for THIS
    // cost on its stored job, by this submitter, who must still be on that job.
    if (attachment !== undefined && attachment !== null) {
      const jobDenied = await dcResubmitJobDenied(adminSupabase, auth, cost.job_id)
      if (jobDenied) return jobDenied
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'dc-resubmit-receipt', subject: auth.userId, ctx: { job: cost.job_id, rec: cost.id } })
      if (!v.ok) return attachmentErrorResponse(v)
      updates.receipt_url = v.path
    }

    const { rows, error } = await dcUpdateIfUnchanged(updates, cost)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows.length) return Response.json({ error: STALE }, { status: 409 })
    return Response.json({ ok: true })
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
