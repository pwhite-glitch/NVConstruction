import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { insertNumberedRfi } from '../../../../lib/rfi-number'
import { notifyRfiSubmitted } from '../../../../lib/rfi-notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Field app (super) / office RFIs. Same numbered insert as the sub portal's
// /api/rfis: next per-job number (insertNumberedRfi), status 'open', and the
// filer is the session user (super_id) — never taken from the body.
// Job rule: principal/admin any job; pm/apm/super only on their job.
// POST { job_id, title, description } → { ok, rfi }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const job_id = typeof body?.job_id === 'string' ? body.job_id : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (!job_id || !title || !description) {
    return Response.json({ error: 'Project, subject and details are all required.' }, { status: 400 })
  }

  const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
  if (denied) return denied

  const { data: rfi, error } = await insertNumberedRfi(adminSupabase, {
    job_id,
    super_id: auth.userId,
    title,
    description,
    status: 'open',
  })
  if (error) return Response.json({ error: `Could not save RFI: ${error.message}` }, { status: 500 })

  const { data: profile } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
  await notifyRfiSubmitted({ job_id, title, description, submitter_name: profile?.full_name || auth.email || 'Superintendent' })
  return Response.json({ ok: true, rfi })
}
