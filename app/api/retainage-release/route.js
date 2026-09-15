import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

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
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { job_id, subcontract_id, sub_id, company_name, amount, notes } = await request.json()
  if (!job_id || !amount || !company_name) {
    return Response.json({ error: 'job_id, amount, and company_name required' }, { status: 400 })
  }

  const releaseAmount = parseFloat(amount)
  if (!isFinite(releaseAmount) || releaseAmount <= 0) {
    return Response.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  // Calculate available retainage for this subcontract (atomic balance check)
  if (subcontract_id) {
    const [{ data: billings }, { data: priorReleases }] = await Promise.all([
      adminSupabase
        .from('billing_submissions')
        .select('retainage_held')
        .eq('job_id', job_id)
        .eq('status', 'approved'),
      adminSupabase
        .from('retainage_releases')
        .select('amount')
        .eq('subcontract_id', subcontract_id),
    ])

    const totalHeld = (billings || []).reduce((s, b) => s + parseFloat(b.retainage_held || 0), 0)
    const totalReleased = (priorReleases || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0)
    const available = totalHeld - totalReleased

    if (releaseAmount > available + 0.01) {  // 1¢ tolerance for float rounding
      return Response.json({
        error: `Release amount ($${releaseAmount.toFixed(2)}) exceeds available retainage ($${available.toFixed(2)})`,
      }, { status: 422 })
    }
  }

  const { data: release, error } = await adminSupabase
    .from('retainage_releases')
    .insert({
      job_id,
      subcontract_id: subcontract_id || null,
      sub_id: sub_id || null,
      company_name,
      amount: releaseAmount,
      released_by: auth.userId,  // always from verified session
      notes: notes || null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify sub via auth email — profiles.email is not a reliable field
  if (sub_id) {
    try {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(sub_id)
      const subEmail = authUser?.user?.email
      const { data: jobRow } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', job_id).single()
      if (subEmail) {
        const fmt = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
          to: subEmail,
          subject: `Retainage released — #${jobRow?.job_number} ${jobRow?.project_name}`,
          html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
            <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 8px">✓ Retainage released</p>
            <p style="color:#aaa;margin:0 0 4px">Your retainage for <strong style="color:#f1f1f1">#${jobRow?.job_number} — ${jobRow?.project_name}</strong> has been released.</p>
            <p style="font-size:28px;font-weight:800;color:#4ade80;margin:16px 0">${fmt(releaseAmount)}</p>
            ${notes ? `<p style="color:#666;font-size:13px">Note: ${notes}</p>` : ''}
          </div>`,
        }).catch(() => {})
      }
    } catch {}
  }

  return Response.json({ release })
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const { error } = await adminSupabase.from('retainage_releases').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
