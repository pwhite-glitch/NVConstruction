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
  const sub_id = searchParams.get('sub_id')
  if (!job_id) return Response.json({ items: [] })
  let q = adminSupabase.from('punch_list_items').select('*').eq('job_id', job_id).order('created_at')
  if (sub_id) q = q.eq('assigned_sub_id', sub_id)
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ items: data || [] })
}

export async function POST(request) {
  const { job_id, title, description, assigned_sub_id, assigned_company, due_date, created_by } = await request.json()
  if (!job_id || !title) return Response.json({ error: 'job_id and title required' }, { status: 400 })
  const { data: item, error } = await adminSupabase
    .from('punch_list_items')
    .insert({ job_id, title, description: description || null, assigned_sub_id: assigned_sub_id || null, assigned_company: assigned_company || null, due_date: due_date || null, created_by: created_by || null })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify assigned sub
  if (assigned_sub_id) {
    const { data: profile } = await adminSupabase.from('profiles').select('email').eq('id', assigned_sub_id).single()
    const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', job_id).single()
    if (profile?.email) {
      const portalUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://nv-construction-doym.vercel.app') + '/submit'
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: profile.email,
        subject: `Punch list item assigned — #${jobRow?.job_number} ${jobRow?.project_name}`,
        html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
          <p style="color:#e8590c;font-size:16px;font-weight:700;margin:0 0 8px">Punch list item</p>
          <p style="color:#aaa;margin:0 0 16px">A new punch list item has been assigned to you on <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong>.</p>
          <p style="font-size:18px;font-weight:700;color:#f1f1f1;margin:0 0 8px">${title}</p>
          ${description ? `<p style="color:#888;font-size:13px;margin:0 0 8px">${description}</p>` : ''}
          ${due_date ? `<p style="color:#facc15;font-size:13px">Due: ${new Date(due_date + 'T00:00:00').toLocaleDateString()}</p>` : ''}
          <table cellpadding="0" cellspacing="0" style="margin:20px 0 0">
            <tr><td style="background:#e8590c;border-radius:8px">
              <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">View Punch List</a>
            </td></tr>
          </table>
        </div>`,
      }).catch(() => {})
    }
  }
  return Response.json({ item })
}

export async function PATCH(request) {
  const { id, status, pm_notes, title, description, assigned_sub_id, assigned_company, due_date } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const updates = {}
  if (status !== undefined) {
    updates.status = status
    if (status === 'sub_complete') updates.completed_at = new Date().toISOString()
    if (status === 'approved') updates.pm_approved_at = new Date().toISOString()
  }
  if (pm_notes !== undefined) updates.pm_notes = pm_notes
  if (title !== undefined) updates.title = title
  if (description !== undefined) updates.description = description
  if (assigned_sub_id !== undefined) updates.assigned_sub_id = assigned_sub_id
  if (assigned_company !== undefined) updates.assigned_company = assigned_company
  if (due_date !== undefined) updates.due_date = due_date
  const { error } = await adminSupabase.from('punch_list_items').update(updates).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('punch_list_items').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
