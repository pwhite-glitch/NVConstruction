import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { isPrincipal } from '../../../../lib/roles'
import { archivePayload } from '../../../../lib/job-lifecycle'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { job_id, archived: true | false } — Owner-only Archive / Unarchive.
// Writes only jobs.archived; status is left as it was.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Only an Owner can archive or unarchive a job.' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const jobId = body?.job_id
  if (!jobId) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (typeof body.archived !== 'boolean') return Response.json({ error: 'archived must be true or false' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('jobs')
    .update(archivePayload(body.archived))
    .eq('id', jobId)
    .select('id, archived, status')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data?.length) return Response.json({ error: 'Job not found.' }, { status: 404 })
  return Response.json({ ok: true, job: data[0] })
}
