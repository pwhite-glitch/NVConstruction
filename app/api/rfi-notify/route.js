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

async function mail(to, subject, html) {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to, subject, html,
  })
  return { data, error }
}

// GET ?job_id=xxx — test: shows pm_email on the job and sends a test email
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'Pass ?job_id=xxx' }, { status: 400 })

  const { data: job } = await adminSupabase
    .from('jobs').select('project_name, job_number, pm_email').eq('id', job_id).single()

  if (!job?.pm_email) return Response.json({ job, error: 'No pm_email on this job' })

  const { data: emailData, error: emailErr } = await mail(
    job.pm_email,
    `Test RFI notification — #${job.job_number}`,
    wrap(`<h2 style="color:#f1f1f1;margin:0 0 1rem">Test email</h2><p style="color:#aaa">RFI notifications for <strong style="color:#f1f1f1">#${job.job_number} — ${job.project_name}</strong> are configured and working.</p>`)
  )

  return Response.json({ job, emailData, emailError: emailErr?.message || null })
}

export async function POST(request) {
  try {
    const body = await request.json()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''

    if (body.action === 'submitted') {
      const { data: job } = await adminSupabase
        .from('jobs').select('project_name, job_number, pm_email').eq('id', body.job_id).single()

      if (!job?.pm_email) return Response.json({ ok: false, reason: 'no pm_email on job' })

      const jobLabel = `#${job.job_number} — ${job.project_name}`
      const { error: emailErr } = await mail(job.pm_email, `New RFI: ${body.title} — ${jobLabel}`, wrap(`
        <h2 style="color:#f1f1f1;margin:0 0 1rem">New RFI Submitted</h2>
        <p style="color:#aaa"><strong style="color:#f1f1f1">${body.super_name}</strong> submitted an RFI on <strong style="color:#f1f1f1">${jobLabel}</strong>.</p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0">
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Subject</p>
          <p style="color:#f1f1f1;font-weight:700;margin:0 0 ${body.description ? '12px' : '0'}">${body.title}</p>
          ${body.description ? `<p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Description</p><p style="color:#aaa;font-size:13px;line-height:1.6;margin:0">${body.description}</p>` : ''}
        </div>
        <a href="${siteUrl}/jobdetail?id=${body.job_id}&tab=field" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">View RFI &amp; Respond</a>
      `))
      return Response.json({ ok: !emailErr, emailError: emailErr?.message || null, sentTo: job.pm_email })
    }

    if (body.action === 'responded') {
      // profiles has no email column — look up via auth.users
      const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
      const authUser = users?.find(u => u.id === body.super_id)
      if (!authUser?.email) return Response.json({ ok: false, reason: 'no email for superintendent' })

      const { error: emailErr } = await mail(authUser.email, `RFI Answered: ${body.title}`, wrap(`
        <h2 style="color:#4ade80;margin:0 0 1rem">Your RFI Has Been Answered</h2>
        <p style="color:#aaa">A response has been posted for your RFI: <strong style="color:#f1f1f1">${body.title}</strong></p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0">
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Response</p>
          <p style="color:#f1f1f1;font-size:14px;line-height:1.6;margin:0">${body.response}</p>
        </div>
        <a href="${siteUrl}/field" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">View in Field Portal</a>
      `))
      return Response.json({ ok: !emailErr, emailError: emailErr?.message || null })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
