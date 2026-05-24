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
  if (!job_id) return Response.json({ releases: [] })
  const { data, error } = await adminSupabase
    .from('retainage_releases')
    .select('*')
    .eq('job_id', job_id)
    .order('released_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ releases: data || [] })
}

export async function POST(request) {
  const { job_id, subcontract_id, sub_id, company_name, amount, released_by, notes } = await request.json()
  if (!job_id || !amount || !company_name) {
    return Response.json({ error: 'job_id, amount, and company_name required' }, { status: 400 })
  }
  const { data: release, error } = await adminSupabase
    .from('retainage_releases')
    .insert({ job_id, subcontract_id: subcontract_id || null, sub_id: sub_id || null, company_name, amount, released_by: released_by || null, notes: notes || null })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify sub if they have an account
  if (sub_id) {
    const { data: profile } = await adminSupabase.from('profiles').select('email').eq('id', sub_id).single()
    const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', job_id).single()
    if (profile?.email) {
      const fmt = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: profile.email,
        subject: `Retainage released — #${jobRow?.job_number} ${jobRow?.project_name}`,
        html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
          <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 8px">✓ Retainage released</p>
          <p style="color:#aaa;margin:0 0 4px">Your retainage for <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong> has been released.</p>
          <p style="font-size:28px;font-weight:800;color:#4ade80;margin:16px 0">${fmt(amount)}</p>
          ${notes ? `<p style="color:#666;font-size:13px">Note: ${notes}</p>` : ''}
        </div>`,
      }).catch(() => {})
    }
  }
  return Response.json({ release })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('retainage_releases').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
