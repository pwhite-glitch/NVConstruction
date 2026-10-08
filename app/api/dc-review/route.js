import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const APPROVER_ROLES = new Set(['pm', 'apm', 'admin'])

// POST /api/dc-review
// Handles all status transitions for direct cost entries.
// Body (JSON): { action, id, ...fields }
// Body (multipart, resubmit only): data field = JSON above, file field = new receipt
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

  const contentType = request.headers.get('content-type') || ''
  let body = {}
  let newFile = null

  if (contentType.includes('multipart/form-data')) {
    const fd = await request.formData()
    try { body = JSON.parse(fd.get('data') || '{}') } catch {
      return Response.json({ error: 'Invalid data field — expected JSON' }, { status: 400 })
    }
    newFile = fd.get('file') || null
  } else {
    try { body = await request.json() } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  const { action, id, ...fields } = body
  if (!action || !id) return Response.json({ error: 'action and id are required' }, { status: 400 })

  const { data: cost, error: fetchErr } = await adminSupabase
    .from('direct_costs')
    .select('*, profiles:submitted_by(id, full_name, email)')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !cost) return Response.json({ error: 'Cost not found' }, { status: 404 })

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
    if (cost.status !== 'pending') return Response.json({ error: 'Only pending costs can be approved' }, { status: 422 })
    const { error } = await adminSupabase
      .from('direct_costs')
      .update({ status: 'approved', reviewed_by: auth.userId, reviewed_at: now })
      .eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // ── UNAPPROVE ────────────────────────────────────────────────────────────────
  if (action === 'unapprove') {
    if (!APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (cost.status !== 'approved') return Response.json({ error: 'Only approved costs can be unapproved' }, { status: 422 })
    const { error } = await adminSupabase
      .from('direct_costs')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
      .eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // ── REJECT ───────────────────────────────────────────────────────────────────
  if (action === 'reject') {
    if (!APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (!['pending', 'approved'].includes(cost.status)) {
      return Response.json({ error: 'Only pending or approved costs can be rejected' }, { status: 422 })
    }

    const rejection_reason = (fields.rejection_reason || '').trim()
    if (!rejection_reason) return Response.json({ error: 'A rejection reason is required' }, { status: 400 })

    const newCycle = (cost.review_cycle || 0) + 1

    const { error: upErr } = await adminSupabase
      .from('direct_costs')
      .update({
        status: 'rejected',
        rejection_reason,
        rejected_at: now,
        rejected_by: auth.userId,
        review_cycle: newCycle,
        reviewed_by: auth.userId,
        reviewed_at: now,
      })
      .eq('id', id)

    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

    const submitterEmail = cost.profiles?.email
    const submitterName = cost.profiles?.full_name || 'Superintendent'
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
        await adminSupabase.from('direct_costs').update({ notif_sent_at: now }).eq('id', id)
      } catch (_) {}
    }

    return Response.json({ ok: true })
  }

  // ── EDIT ─────────────────────────────────────────────────────────────────────
  if (action === 'edit') {
    if (!APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const EDITABLE = ['cost_date', 'vendor', 'description', 'amount', 'category', 'notes', 'budget_item_id', 'bill_to_owner', 'owner_auth_ref']
    const updates = { reviewed_by: auth.userId, reviewed_at: now }
    for (const f of EDITABLE) {
      if (fields[f] !== undefined) updates[f] = fields[f]
    }
    // amount must be a valid number
    if (updates.amount !== undefined) {
      const parsed = parseFloat(updates.amount)
      if (isNaN(parsed) || parsed < 0) return Response.json({ error: 'Invalid amount' }, { status: 400 })
      updates.amount = parsed
    }

    const { error } = await adminSupabase.from('direct_costs').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // ── RESUBMIT ─────────────────────────────────────────────────────────────────
  if (action === 'resubmit') {
    if (cost.submitted_by !== auth.userId) {
      return Response.json({ error: 'Forbidden — only the original submitter can resubmit' }, { status: 403 })
    }
    if (cost.status !== 'rejected') {
      return Response.json({ error: 'Only rejected costs can be resubmitted' }, { status: 422 })
    }

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

    // New receipt upload (optional)
    if (newFile && newFile.size > 0) {
      const isPdf = newFile.type === 'application/pdf' || newFile.name?.toLowerCase().endsWith('.pdf')
      const safeExt = isPdf ? 'pdf' : 'jpg'
      const safeMime = isPdf ? 'application/pdf' : 'image/jpeg'
      const path = `${cost.job_id}/${Date.now()}_r.${safeExt}`
      const buffer = Buffer.from(await newFile.arrayBuffer())
      const { error: uploadErr } = await adminSupabase.storage
        .from('receipts')
        .upload(path, buffer, { contentType: safeMime })
      if (uploadErr) return Response.json({ error: 'Receipt upload failed: ' + uploadErr.message }, { status: 500 })
      updates.receipt_url = path
    }

    const { error } = await adminSupabase.from('direct_costs').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
