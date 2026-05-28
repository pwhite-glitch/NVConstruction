import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

function wrap(body) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;padding:2rem;border-radius:12px;border:1px solid #222"><div style="margin-bottom:1.5rem"><span style="font-weight:800;font-size:15px;color:#e8590c;letter-spacing:2px;text-transform:uppercase">NV Construction</span></div>${body}<div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #222;font-size:12px;color:#555">NV Construction · Project Management</div></div>`
}

// POST or GET — called by cron job daily to send same-day delivery alerts to supers
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]

  // Find all PM-logged deliveries expected today that are still pending
  const { data: deliveries, error } = await adminSupabase
    .from('deliveries')
    .select('*, jobs(job_number, project_name)')
    .eq('expected_date', today)
    .eq('status', 'pending')
    .eq('source', 'pm')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!deliveries?.length) return Response.json({ sent: 0, message: 'No deliveries due today' })

  const results = []
  for (const d of deliveries) {
    // Find assigned superintendent(s) for this job
    const { data: assigns } = await adminSupabase
      .from('pm_job_assignments')
      .select('user_id, profiles(email, full_name)')
      .eq('job_id', d.job_id)

    const supers = (assigns || []).filter(a => a.profiles?.email)
    for (const s of supers) {
      const job = d.jobs
      const superEmail = s.profiles.email
      const superName = s.profiles.full_name || superEmail

      const html = wrap(`
        <h2 style="color:#f1f1f1;margin:0 0 0.5rem">Delivery expected today</h2>
        <p style="color:#888;margin:0 0 1.5rem;font-size:14px">#${job?.job_number} — ${job?.project_name}</p>
        <div style="background:#141414;border:1px solid #2a2a2a;border-left:3px solid #e8590c;border-radius:8px;padding:1rem 1.25rem;margin-bottom:1rem">
          <div style="font-size:16px;font-weight:700;color:#f1f1f1;margin-bottom:6px">${d.material}</div>
          ${d.vendor ? `<div style="font-size:13px;color:#888;margin-bottom:4px">Vendor: ${d.vendor}</div>` : ''}
          ${d.quantity ? `<div style="font-size:13px;color:#888;margin-bottom:4px">Quantity: ${d.quantity}</div>` : ''}
          ${d.notes ? `<div style="font-size:13px;color:#aaa;margin-top:8px;padding-top:8px;border-top:1px solid #222">${d.notes}</div>` : ''}
        </div>
        <p style="color:#aaa;font-size:13px">Hi ${superName}, please watch for this delivery on site today and mark it received in the field portal once it arrives.</p>
      `)

      const { error: emailErr } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
        to: superEmail,
        subject: `Delivery today: ${d.material} — Job #${job?.job_number}`,
        html,
      })
      results.push({ to: superEmail, material: d.material, error: emailErr?.message || null })
    }
  }

  return Response.json({ sent: results.length, results })
}
