import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { notifyRfiSubmitted, notifyRfiAnswered, sendRfiMail as mail, wrapRfiEmail as wrap } from '../../../lib/rfi-notify'

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
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied

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
    if (body.rfi_id) {
      const deniedRfi = await denyJobOf(adminSupabase, auth, 'rfis', body.rfi_id)
      if (deniedRfi) return deniedRfi
    }
    if (body.job_id || !body.rfi_id) {
      const denied = await denyJob(adminSupabase, auth, body.job_id)
      if (denied) return denied
    }

    if (body.action === 'submitted') {
      const result = await notifyRfiSubmitted({ job_id: body.job_id, title: body.title, description: body.description, submitter_name: body.super_name })
      return Response.json(result)
    }

    if (body.action === 'responded') {
      // Prefer the stored RFI (super_id + sub_id) over what the browser sent
      let rfi = null
      if (body.rfi_id) {
        const { data } = await adminSupabase.from('rfis').select('*').eq('id', body.rfi_id).maybeSingle()
        rfi = data
      }
      if (!rfi) rfi = { id: body.rfi_id || null, job_id: body.job_id || null, title: body.title, super_id: body.super_id || null }
      const result = await notifyRfiAnswered(rfi, body.response ?? rfi.response ?? '')
      return Response.json(result)
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
