import { createClient } from '@supabase/supabase-js'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { getSubAccess, getCompanyName } from '../../../lib/sub-access'
import { insertNumberedRfi } from '../../../lib/rfi-number'
import { notifyRfiSubmitted } from '../../../lib/rfi-notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Sub portal RFIs. The caller is the session user; any sub_id in the body is
// ignored. Job visibility follows getSubAccess (lib/sub-access.js).

// GET → the caller's own RFIs, newest first
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isSub(auth.role)) return Response.json({ error: 'Sub portal only' }, { status: 403 })
  const { data, error } = await adminSupabase
    .from('rfis')
    .select('id, job_id, number, title, description, status, response, responded_at, created_at, jobs(job_number, project_name)')
    .eq('sub_id', auth.userId)
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data || [] })
}

// POST { job_id, title, description } → creates an open RFI on a job the caller sees
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isSub(auth.role)) return Response.json({ error: 'Sub portal only' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const job_id = typeof body?.job_id === 'string' ? body.job_id : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (!job_id || !title || !description) {
    return Response.json({ error: 'Project, subject and question are all required.' }, { status: 400 })
  }

  const { profile, jobs } = await getSubAccess(auth.userId, auth.email)
  if (!profile || !jobs.some(j => j.id === job_id)) {
    return Response.json({ error: 'You do not have access to this project.' }, { status: 403 })
  }

  const { data: rfi, error } = await insertNumberedRfi(adminSupabase, {
    job_id,
    sub_id: auth.userId,
    title,
    description,
    status: 'open',
  })
  if (error) return Response.json({ error: `Could not save RFI: ${error.message}` }, { status: 500 })

  const company = (await getCompanyName(profile.company_id)) || profile.company_name
  const person = profile.full_name || auth.email || 'Subcontractor'
  await notifyRfiSubmitted({
    job_id,
    title,
    description,
    submitter_name: company && company !== person ? `${person} (${company})` : person,
  })

  return Response.json({ ok: true, rfi })
}
