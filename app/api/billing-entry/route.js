import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

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
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let doc_url = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')
      if (file && file.size > 0) {
        doc_url = await uploadBillingDoc(file, row.job_id)
      }
    } else {
      row = await request.json()
    }

    // Validate sub_id against auth.users — stale UUIDs (deleted/re-invited subs) would violate the FK
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
  try {
    const contentType = request.headers.get('content-type') || ''
    let id = null
    let fields = {}
    let doc_url = undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      const parsed = JSON.parse(formData.get('data') || '{}')
      id = parsed.id
      const { id: _id, ...rest } = parsed
      fields = rest
      if (file && file.size > 0) {
        doc_url = await uploadBillingDoc(file, fields.job_id)
      }
    } else {
      const body = await request.json()
      id = body.id
      const { id: _id, ...rest } = body
      fields = rest
    }

    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    // Only lock amount_billed on approved submissions — pending/rejected allow PM correction
    const { data: current } = await adminSupabase.from('billing_submissions').select('status').eq('id', id).single()
    if (current?.status === 'approved') delete fields.amount_billed
    const update = doc_url !== undefined ? { ...fields, doc_url } : fields
    const { error } = await adminSupabase
      .from('billing_submissions')
      .update(update)
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Send email to admin when PM marks ready to pay
    if (fields.ready_to_pay === true) {
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
          const adminUrl = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/admin` : 'https://app.nvim.co/admin'
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
              <a href="${adminUrl}" style="display:inline-block;background:#e8590c;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Admin Portal →</a>
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
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { error } = await adminSupabase
      .from('billing_submissions')
      .delete()
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
