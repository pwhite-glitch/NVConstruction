import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ orders: [] })
  const { data, error } = await adminSupabase
    .from('warranty_orders')
    .select('*')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ orders: data || [] })
}

export async function POST(request) {
  const { job_id, title, description, due_date, assigned_employee_id, assigned_employee_name, assigned_sub_id, assigned_company } = await request.json()
  if (!job_id || !title) return Response.json({ error: 'job_id and title required' }, { status: 400 })
  const { data: order, error } = await adminSupabase
    .from('warranty_orders')
    .insert({
      job_id, title,
      description: description || null,
      due_date: due_date || null,
      assigned_employee_id: assigned_employee_id || null,
      assigned_employee_name: assigned_employee_name || null,
      assigned_sub_id: assigned_sub_id || null,
      assigned_company: assigned_company || null,
    })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ order })
}

export async function PATCH(request) {
  const { id, status, is_billable, billable_amount, resolution_notes, photos, assigned_employee_id, assigned_employee_name, assigned_sub_id, assigned_company, due_date, title, description } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const updates = {}
  if (status !== undefined) {
    updates.status = status
    if (status === 'resolved') updates.resolved_at = new Date().toISOString()
  }
  if (is_billable !== undefined) updates.is_billable = is_billable
  if (billable_amount !== undefined) updates.billable_amount = billable_amount
  if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes
  if (photos !== undefined) updates.photos = photos
  if (assigned_employee_id !== undefined) updates.assigned_employee_id = assigned_employee_id
  if (assigned_employee_name !== undefined) updates.assigned_employee_name = assigned_employee_name
  if (assigned_sub_id !== undefined) updates.assigned_sub_id = assigned_sub_id
  if (assigned_company !== undefined) updates.assigned_company = assigned_company
  if (due_date !== undefined) updates.due_date = due_date
  if (title !== undefined) updates.title = title
  if (description !== undefined) updates.description = description

  const { error } = await adminSupabase.from('warranty_orders').update(updates).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Email owner's rep on resolution
  if (status === 'resolved') {
    const { data: order } = await adminSupabase
      .from('warranty_orders')
      .select('*, jobs(job_number, project_name, id)')
      .eq('id', id)
      .single()
    const jobId = order?.jobs?.id
    if (jobId) {
      const { data: contacts } = await adminSupabase
        .from('job_contacts')
        .select('*')
        .eq('job_id', jobId)
        .ilike('role', '%owner%')
      const ownersRep = contacts?.[0]
      if (ownersRep?.email) {
        const job = order.jobs
        const photoCount = photos?.length || 0
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
          to: ownersRep.email,
          subject: `Warranty work completed — #${job.job_number} ${job.project_name}`,
          html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
            <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 8px">Warranty Item Resolved</p>
            <p style="color:#aaa;margin:0 0 16px">The following warranty item has been completed on <strong style="color:#f1f1f1">#${job.job_number} — ${job.project_name}</strong>.</p>
            <div style="background:#111;border:1px solid #222;border-radius:8px;padding:14px 16px;margin:0 0 16px">
              <p style="color:#f1f1f1;font-size:16px;font-weight:700;margin:0 0 6px">${order.title}</p>
              ${resolution_notes ? `<p style="color:#aaa;font-size:13px;margin:0;line-height:1.6">${resolution_notes}</p>` : ''}
            </div>
            ${is_billable ? `<p style="color:#facc15;font-size:13px;margin:0 0 12px">⚠ This item has been flagged as billable${billable_amount ? ` — $${Number(billable_amount).toLocaleString()}` : ''}.</p>` : ''}
            ${photoCount > 0 ? `<p style="color:#60a5fa;font-size:13px;margin:0 0 16px">${photoCount} completion photo${photoCount !== 1 ? 's' : ''} on file.</p>` : ''}
            <p style="color:#555;font-size:12px;margin:0">Completed ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — NV Construction</p>
          </div>`,
        }).catch(() => {})
      }
    }
  }

  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('warranty_orders').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
