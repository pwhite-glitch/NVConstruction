import { createClient } from '@supabase/supabase-js'
import { notify } from '../../../lib/notify'
import { requirePM } from '../../../lib/server-auth'
import { notifyRfiSubmitted, sendRfiMail as mail, wrapRfiEmail as wrap } from '../../../lib/rfi-notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id=xxx — test: shows pm_email on the job and sends a test email
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'Pass ?job_id=xxx' }, { status: 400 })

  const { data: job, error: jobErr } = await adminSupabase
    .from('jobs').select('project_name, job_number, pm_email').eq('id', job_id).single()

  if (jobErr || !job?.pm_email) return Response.json({ job, jobError: jobErr?.message, error: 'No pm_email on this job' })

  const { data: emailData, error: emailErr } = await mail(
    job.pm_email,
    `Test RFI notification — #${job.job_number}`,
    wrap(`<h2 style="color:#f1f1f1;margin:0 0 1rem">Test email</h2><p style="color:#aaa">RFI notifications for <strong style="color:#f1f1f1">#${job.job_number} — ${job.project_name}</strong> are configured and working.</p>`)
  )

  return Response.json({ job, emailData, emailError: emailErr?.message || null })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''

    if (body.action === 'submitted') {
      const result = await notifyRfiSubmitted({ job_id: body.job_id, title: body.title, description: body.description, submitter_name: body.super_name })
      return Response.json(result)
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
      notify({
        recipient_id: body.super_id,
        type:         'rfi_answered',
        title:        `RFI answered: ${body.title}`,
        body:         body.response ? body.response.slice(0, 120) : null,
        link:         'rfis',
        job_id:       body.job_id || null,
        entity_type:  'rfi',
        entity_id:    body.rfi_id || null,
        dedup_key:    body.rfi_id ? `rfi:answered:${body.rfi_id}` : null,
      })
      return Response.json({ ok: !emailErr, emailError: emailErr?.message || null })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
