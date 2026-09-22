import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

// Fields a PM may set on a new submission (POST)
const PM_INSERT_FIELDS = new Set(['job_id', 'sub_id', 'company_name', 'amount_billed', 'retainage_held', 'status', 'notes', 'billing_period', 'doc_url', 'lien_waiver_signed_at'])
// Fields a sub may set on their own new submission
const SUB_INSERT_FIELDS = new Set(['job_id', 'amount_billed', 'retainage_held', 'notes', 'billing_period', 'doc_url'])

// Fields a PM may PATCH
const PM_PATCH_FIELDS = new Set(['status', 'amount_billed', 'retainage_held', 'notes', 'ready_to_pay', 'lien_waiver_signed_at', 'paid_at', 'doc_url', 'billing_period', 'payment_amount', 'payment_method', 'check_number', 'payment_notes', 'nv_cuts_check', 'invoice_number', 'work_description'])
// Sub may only update their own pending submission's safe fields
const SUB_PATCH_FIELDS = new Set(['notes', 'billing_period', 'doc_url'])

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

function pickFields(obj, allowed) {
  const result = {}
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const contentType = request.headers.get('content-type') || ''
    let raw = {}
    let doc_url = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      raw = JSON.parse(formData.get('data') || '{}')
      if (file && file.size > 0) doc_url = await uploadBillingDoc(file, raw.job_id)
    } else {
      raw = await request.json()
    }

    // Derive sub_id from session — never trust it from the request body
    let row
    if (isPM(auth.role)) {
      row = pickFields(raw, PM_INSERT_FIELDS)
    } else if (isSub(auth.role)) {
      row = pickFields(raw, SUB_INSERT_FIELDS)
      row.sub_id = auth.userId  // always derive from session
      row.status = 'pending'    // subs always submit as pending
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate sub_id auth account still exists
    if (row.sub_id) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(row.sub_id)
      if (!authUser?.user) row.sub_id = null
    }

    const { error } = await adminSupabase
      .from('billing_submissions')
      .insert({ ...row, doc_url })

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
    let doc_url = undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      const parsed = JSON.parse(formData.get('data') || '{}')
      id = parsed.id
      const { id: _id, ...rest } = parsed
      rawFields = rest
      if (file && file.size > 0) doc_url = await uploadBillingDoc(file, rawFields.job_id)
    } else {
      const body = await request.json()
      id = body.id
      const { id: _id, ...rest } = body
      rawFields = rest
    }

    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { data: current } = await adminSupabase
      .from('billing_submissions')
      .select('status, sub_id')
      .eq('id', id)
      .single()

    if (!current) return Response.json({ error: 'Not found' }, { status: 404 })

    let fields
    if (isPM(auth.role)) {
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
    } else if (isSub(auth.role)) {
      // Subs can only edit their own pending submissions
      if (current.sub_id !== auth.userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (current.status !== 'pending') return Response.json({ error: 'Cannot edit a submission that is not pending' }, { status: 422 })
      fields = pickFields(rawFields, SUB_PATCH_FIELDS)
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const update = doc_url !== undefined ? { ...fields, doc_url } : fields
    const { error } = await adminSupabase.from('billing_submissions').update(update).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

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
          const adminUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard` : 'https://app.nvim.co/dashboard'
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

    return Response.json({ ok: true })
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

    const { error } = await adminSupabase.from('billing_submissions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
