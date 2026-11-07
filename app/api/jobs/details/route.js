import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { denyJob, isPrincipal, normEmail } from '../../../../lib/roles'
import { residentialDetailsUpdate } from '../../../../lib/job-details'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WRITER_ROLES = new Set(['principal', 'pm', 'apm', 'admin'])
const PM_PICK_ROLES = new Set(['principal', 'pm', 'apm'])

// POST { id, fields } — residential job Details. Only the allow-listed fields in
// lib/job-details.js are written, after checks. Archive is never written here
// except the Owner's deliberate "status → Active" unarchive. PM changes do not
// touch pm_job_assignments.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!WRITER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { id, fields } = body || {}
  if (!id || !fields || typeof fields !== 'object') return Response.json({ error: 'id and fields required' }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, id)
  if (denied) return denied

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', id).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })

  const r = residentialDetailsUpdate(fields, job, { isOwner: isPrincipal(auth.role) })
  if (r.error) return Response.json({ error: r.error }, { status: 400 })
  const update = r.fields

  // PM must be a staff login (Owner / PM / APM), like the picker offers.
  if (update.pm_email && normEmail(update.pm_email) !== normEmail(job.pm_email)) {
    const { data: list } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    const user = (list?.users || []).find(u => normEmail(u.email) === update.pm_email)
    if (!user) return Response.json({ error: 'That PM is not a team login.' }, { status: 400 })
    const { data: prof, error: pErr } = await adminSupabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 })
    if (!PM_PICK_ROLES.has(prof?.role)) return Response.json({ error: 'The PM must be an Owner, PM or APM.' }, { status: 400 })
  }

  if (!Object.keys(update).length) return Response.json({ ok: true, job })
  const { data, error } = await adminSupabase.from('jobs').update(update).eq('id', id).select('*')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data?.length) return Response.json({ error: 'Job not found.' }, { status: 404 })
  return Response.json({ ok: true, job: data[0], unarchived: update.archived === false })
}
