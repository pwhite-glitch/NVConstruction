import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { logChange } from '../../../lib/change-log'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { notify } from '../../../lib/notify'
import { PM_INSERT_FIELDS, SUB_INSERT_FIELDS, PM_PATCH_FIELDS, SUB_PATCH_FIELDS, pickFields, withoutNew032, billingDeleteBlock, billingDrawLockError } from '../../../lib/billing-fields'
import { drawTargetError } from '../../../lib/draw-guards'
import { planBillingPayment, netBelowPaidError } from '../../../lib/billing-payment'
import { escapeHtml, emailWrap } from '../../../lib/email'
import { siteUrl } from '../../../lib/site-url'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)


// Valid status transitions
const ALLOWED_TRANSITIONS = {
  pm: {
    pending: ['approved', 'rejected'],
    approved: ['pending'], // correction reopen
    rejected: ['pending'],
  },
  sub: {
    pending: [], // subs cannot change status
  },
}

// Who to email about a billing decision: the address saved on the submission,
// else the sub's login email. Returns null when there is none.
async function billingRecipient(current) {
  if (current.sub_email?.trim()) return current.sub_email.trim()
  if (!current.sub_id) return null
  const { data } = await adminSupabase.auth.admin.getUserById(current.sub_id)
  return data?.user?.email || null
}

async function emailBillingDecision(current, status, reason) {
  const to = await billingRecipient(current)
  if (!to) return 'No email on file for this sub.'
  const { data: job } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', current.job_id).maybeSingle()
  const approved = status === 'approved'
  const color = approved ? '#16a34a' : '#dc2626'
  const amt = '$' + Number(current.amount_billed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const jobLabel = `#${escapeHtml(job?.job_number || '')} — ${escapeHtml(job?.project_name || '')}`
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to,
      subject: `Billing ${status} — ${job?.project_name || 'your job'}`,
      html: emailWrap(`
        <h2 style="color:${color};margin:0 0 1rem">Billing ${status}</h2>
        <p style="color:#aaa">Your billing submission of <strong style="color:#f1f1f1">${amt}</strong> for <strong style="color:#f1f1f1">${jobLabel}</strong> has been <strong style="color:${color}">${status}</strong>.</p>
        ${!approved && reason ? `<div style="background:#1a0a0a;border:1px solid #3a1a1a;border-radius:8px;padding:14px 16px;margin-top:1rem"><p style="color:#888;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">Reason</p><p style="color:#ff6b6b;margin:0;font-size:14px;line-height:1.6">${escapeHtml(reason)}</p></div>` : ''}
        ${!approved && !reason ? `<p style="color:#888;font-size:13px">Contact NV Construction if you have questions.</p>` : ''}
      `),
    })
    return error ? (error.message || 'Email failed') : null
  } catch (e) {
    return e.message || 'Email failed'
  }
}

async function uploadBillingDoc(file, jobId) {
  const ext = file.name.split('.').pop()
  const path = `${jobId}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await adminSupabase.storage
    .from('billing-docs')
    .upload(path, buffer, { contentType: file.type })
  if (error) throw new Error('File upload failed: ' + error.message)
  return path
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const contentType = request.headers.get('content-type') || ''
    let raw = {}
    let doc_url = null
    let file = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      raw = JSON.parse(formData.get('data') || '{}')
    } else {
      raw = await request.json()
    }

    // Derive sub_id from session — never trust it from the request body
    let row
    if (isPM(auth.role)) {
      const denied = await denyJob(adminSupabase, auth, raw.job_id)
      if (denied) return denied
      row = pickFields(raw, PM_INSERT_FIELDS)
      // Same rule as sub-portal billing: a draw picked at create must be open and on this job.
      if (row.draw_request_id) {
        const { data: draw, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, status').eq('id', row.draw_request_id).maybeSingle()
        if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
        const bad = drawTargetError(draw, raw.job_id)
        if (bad) return Response.json({ error: bad.error }, { status: bad.status })
      } else {
        row.draw_request_id = null
      }
    } else if (isSub(auth.role)) {
      row = pickFields(raw, SUB_INSERT_FIELDS)
      row.sub_id = auth.userId  // always derive from session
      row.status = 'pending'    // subs always submit as pending
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (file && file.size > 0) doc_url = await uploadBillingDoc(file, raw.job_id)

    // Validate sub_id auth account still exists
    if (row.sub_id) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(row.sub_id)
      if (!authUser?.user) row.sub_id = null
    }

    const insertRow = { ...row, doc_url }
    let { error } = await adminSupabase.from('billing_submissions').insert(insertRow)
    if (error?.message?.includes('schema cache')) {
      ({ error } = await adminSupabase.from('billing_submissions').insert(withoutNew032(insertRow)))
    }

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const contentType = request.headers.get('content-type') || ''
    let id = null
    let rawFields = {}
    let file = null
    // Only set when a new file is uploaded, so saving without one keeps the existing attachment
    let doc_url = undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      const parsed = JSON.parse(formData.get('data') || '{}')
      id = parsed.id
      const { id: _id, ...rest } = parsed
      rawFields = rest
    } else {
      const body = await request.json()
      id = body.id
      const { id: _id, ...rest } = body
      rawFields = rest
    }

    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { data: current, error: curErr } = await adminSupabase
      .from('billing_submissions')
      .select('status, sub_id, sub_email, job_id, amount_billed, company_name, ready_to_pay, draw_request_id, retainage_pct, retainage_held, nv_reimbursement, billing_period, paid_at, payment_amount')
      .eq('id', id)
      .maybeSingle()

    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Not found' }, { status: 404 })
    const emailSub = rawFields.email_sub === true
    const paymentRequested = ['record_payment_amount', 'payment_amount', 'paid_at'].some(k => k in rawFields)
    let paymentPlan = null

    let fields
    if (isPM(auth.role)) {
      const denied = await denyJob(adminSupabase, auth, current.job_id)
      if (denied) return denied
      fields = pickFields(rawFields, PM_PATCH_FIELDS)

      // Validate status transition
      if (fields.status && fields.status !== current.status) {
        const allowed = ALLOWED_TRANSITIONS.pm[current.status] || []
        if (!allowed.includes(fields.status)) {
          return Response.json({ error: `Cannot transition status from '${current.status}' to '${fields.status}'` }, { status: 422 })
        }
      }

      // If status is approved, amount_billed cannot be changed except by first reopening
      if (current.status === 'approved' && 'amount_billed' in fields && !fields.status) {
        delete fields.amount_billed
      }

      const nextStatus = fields.status || current.status
      // Rejecting keeps the billing (status rejected) and needs a reason the sub can act on.
      if (fields.status === 'rejected' && current.status !== 'rejected') {
        const reason = String(rawFields.rejection_reason || '').trim()
        if (!reason) return Response.json({ error: 'A rejection reason is required.' }, { status: 422 })
        fields.rejection_reason = reason
      } else if ('rejection_reason' in fields && nextStatus !== 'rejected') {
        delete fields.rejection_reason
      }
      // Ready to pay only on an approved billing; reopening clears it.
      if (fields.ready_to_pay === true && nextStatus !== 'approved') {
        return Response.json({ error: 'Only an approved billing can be marked ready to pay.' }, { status: 422 })
      }
      if (current.status === 'approved' && nextStatus !== 'approved') fields.ready_to_pay = false

      // Payments: payment_amount is CUMULATIVE paid-to-date; paid_at is the settlement
      // marker, stamped only when paid-to-date reaches net (billed − retainage), computed
      // from the stored row, never from a body "net". A short check stays unpaid.
      if (paymentRequested) {
        if (fields.status && fields.status !== current.status) return Response.json({ error: 'Record a payment separately from a status change.' }, { status: 422 })
        if ('amount_billed' in fields || 'retainage_held' in fields || 'retainage_pct' in fields) {
          return Response.json({ error: 'Record a payment separately from editing the billed amount or retainage.' }, { status: 422 })
        }
        const payInput = {}
        for (const k of ['record_payment_amount', 'payment_amount', 'paid_at']) if (k in rawFields) payInput[k] = rawFields[k]
        const plan = planBillingPayment(current, payInput)
        if (plan.error) return Response.json({ error: plan.error }, { status: plan.status })
        delete fields.paid_at
        delete fields.payment_amount
        Object.assign(fields, plan.patch)
        paymentPlan = plan
      } else {
        const below = netBelowPaidError(current, fields)
        if (below) return Response.json({ error: below }, { status: 422 })
      }

      // On a draw (open or closed): status, amount, retainage and period are locked on EVERY
      // PATCH — even when draw_request_id is unchanged or not sent, and even when the same
      // request also tries to unlink it. Payment recording is not a financial change.
      if (current.draw_request_id) {
        const { data: curDraw, error: curDrawErr } = await adminSupabase.from('draw_requests').select('id, job_id, status, draw_number').eq('id', current.draw_request_id).maybeSingle()
        if (curDrawErr) return Response.json({ error: 'Could not check the draw request: ' + curDrawErr.message }, { status: 500 })
        const locked = billingDrawLockError(current, curDraw, fields)
        if (locked) return Response.json({ error: locked.error }, { status: locked.status })
      }

      // Draw link: must be a draw on this job, and a closed draw can't gain or lose items.
      if ('draw_request_id' in fields && (fields.draw_request_id || null) !== (current.draw_request_id || null)) {
        const ids = [fields.draw_request_id, current.draw_request_id].filter(Boolean)
        const { data: draws, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, status, draw_number').in('id', ids)
        if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
        for (const did of ids) {
          const d = (draws || []).find(x => x.id === did)
          if (!d) return Response.json({ error: 'Draw request not found.' }, { status: 404 })
          if (d.job_id !== current.job_id) return Response.json({ error: 'That draw request is on a different job.' }, { status: 422 })
          if (d.status === 'closed') return Response.json({ error: `Draw #${d.draw_number} is closed. Reopen it first.` }, { status: 409 })
        }
      }
    } else if (isSub(auth.role)) {
      // Subs can only edit their own pending submissions
      if (current.sub_id !== auth.userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (current.status !== 'pending') return Response.json({ error: 'Cannot edit a submission that is not pending' }, { status: 422 })
      fields = pickFields(rawFields, SUB_PATCH_FIELDS)
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (file && file.size > 0) doc_url = await uploadBillingDoc(file, current.job_id)
    const update = doc_url !== undefined ? { ...fields, doc_url } : fields
    if (!Object.keys(update).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    // Status changes only apply to the status we read (no double approve / reject).
    // ...and only while the draw link is still the one we checked (a billing put on a draw
    // meanwhile can't have its money changed around the lock).
    const linkGuard = q => (current.draw_request_id ? q.eq('draw_request_id', current.draw_request_id) : q.is('draw_request_id', null))
    // A payment only lands on the paid-to-date we read and only while still unsettled, so a
    // double submit / second tab can't add the same check twice or overwrite another payment.
    const same = (q, col, v) => (v === null || v === undefined ? q.is(col, null) : q.eq(col, v))
    // ...and only against the billed / retainage / status values the plan computed net
    // from, so a concurrent retainage or billed-amount edit can't make it settle on stale
    // inputs (the row must still be exactly what planBillingPayment saw).
    const payGuard = q => {
      if (!paymentPlan?.patch || !('payment_amount' in paymentPlan.patch)) return q
      let g = same(q.is('paid_at', null), 'payment_amount', current.payment_amount)
      for (const col of ['amount_billed', 'retainage_held', 'retainage_pct', 'status']) g = same(g, col, current[col])
      return g
    }
    // A non-payment edit that can change net only lands on the paid-to-date / settlement we
    // read (and checked net against), so it can't overwrite a concurrent payment or lower
    // net underneath it.
    const changesNet = !paymentPlan && ['amount_billed', 'retainage_held', 'retainage_pct'].some(k => k in update)
    const paidGuard = q => (changesNet ? same(same(q, 'paid_at', current.paid_at), 'payment_amount', current.payment_amount) : q)
    const statusGuard = q => paidGuard(payGuard(linkGuard(fields.status && fields.status !== current.status ? q.eq('status', current.status) : q)))
    let { data: updatedRows, error } = await statusGuard(adminSupabase.from('billing_submissions').update(update).eq('id', id)).select('id')
    if (error?.message?.includes('schema cache')) {
      ({ data: updatedRows, error } = await statusGuard(adminSupabase.from('billing_submissions').update(withoutNew032(update)).eq('id', id)).select('id'))
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!updatedRows?.length) return Response.json({ error: 'This billing was changed by someone else. Refresh and try again.' }, { status: 409 })

    // Log auditable changes
    const fmtAmt = v => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
    if (isPM(auth.role)) {
      if (fields.status && fields.status !== current.status) {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'status', old_value: current.status, new_value: fields.status, changed_by: auth.userId, note: `Billing status changed to "${fields.status}" — ${current.company_name || ''}` })
        if (current.sub_id && (fields.status === 'approved' || fields.status === 'rejected')) {
          const fmtBill = v => '$' + parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          notify({
            recipient_id: current.sub_id,
            type:         `billing_${fields.status}`,
            title:        fields.status === 'approved' ? `Billing approved — ${fmtBill(current.amount_billed)}` : `Billing returned — please review and resubmit`,
            body:         fields.status === 'rejected' ? (rawFields.rejection_reason || 'Check your billing history for the reason.') : null,
            link:         fields.status === 'rejected' ? 'history' : 'history',
            job_id:       current.job_id,
            entity_type:  'billing',
            entity_id:    id,
            dedup_key:    `billing:${fields.status}:${id}`,
          })
        }
      }
      if ('amount_billed' in fields && String(fields.amount_billed) !== String(current.amount_billed)) {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'amount_billed', old_value: fmtAmt(current.amount_billed), new_value: fmtAmt(fields.amount_billed), changed_by: auth.userId, note: `Billing amount updated — ${current.company_name || ''}` })
      }
      if (fields.ready_to_pay === true && (fields.status || current.status) === 'approved') {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'ready_to_pay', old_value: 'false', new_value: 'true', changed_by: auth.userId, note: `Marked ready to pay — ${current.company_name || ''}` })
      }
    }

    // Send ready-to-pay email notification (PM only)
    if (isPM(auth.role) && fields.ready_to_pay === true) {
      try {
        const { data: sub } = await adminSupabase
          .from('billing_submissions')
          .select('company_name, amount_billed, retainage_held, jobs(job_number, project_name)')
          .eq('id', id)
          .single()
        if (sub) {
          const gross = parseFloat(sub.amount_billed || 0)
          const ret = parseFloat(sub.retainage_held || 0)
          const net = gross - ret
          const fmt = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const adminEmail = process.env.PM_EMAIL || 'management@nvim.co'
          const adminUrl = siteUrl('/dashboard')
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
            to: adminEmail,
            subject: `Check ready to pay — ${sub.company_name} · #${sub.jobs?.job_number}`,
            html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:520px;margin:0 auto;border-radius:12px;">
              <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 12px">✓ Check ready to pay</p>
              <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${sub.company_name}</strong> — Job <strong style="color:#f1f1f1">#${sub.jobs?.job_number} ${sub.jobs?.project_name || ''}</strong></p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
                <tr><td style="color:#888;padding:4px 0">Gross billed</td><td style="text-align:right;color:#f1f1f1;font-family:monospace">${fmt(gross)}</td></tr>
                ${ret > 0 ? `<tr><td style="color:#888;padding:4px 0">Retainage held</td><td style="text-align:right;color:#e8590c;font-family:monospace">− ${fmt(ret)}</td></tr>` : ''}
                <tr style="border-top:1px solid #2a2a2a"><td style="color:#f1f1f1;font-weight:700;padding:6px 0">Net check amount</td><td style="text-align:right;color:#4ade80;font-weight:800;font-size:18px;font-family:monospace">${fmt(net)}</td></tr>
              </table>
              <a href="${adminUrl}" style="display:inline-block;background:#e8590c;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Portal →</a>
            </div>`,
          }).catch(() => {})
        }
      } catch {}
    }

    // Email the sub about approve / reject when the screen asks for it (dashboard, job page reject)
    let emailError = null
    if (isPM(auth.role) && emailSub && fields.status && fields.status !== current.status && (fields.status === 'approved' || fields.status === 'rejected')) {
      emailError = await emailBillingDecision(current, fields.status, fields.rejection_reason)
    }

    return Response.json({ ok: true, emailError, ...(paymentPlan?.summary ? { payment: paymentPlan.summary } : {}) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'billing_submissions', id)
    if (denied) return denied

    const { data: row, error: rowErr } = await adminSupabase.from('billing_submissions')
      .select('id, status, draw_request_id, paid_at, payment_amount').eq('id', id).maybeSingle()
    if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 })
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    const block = billingDeleteBlock(row)
    if (block) return Response.json({ error: block }, { status: 409 })

    const { error } = await adminSupabase.from('billing_submissions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
