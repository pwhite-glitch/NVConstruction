import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/change-log?job_id=<uuid>&limit=<1-500>
// Owner/Admin: any job. PM / APM / Super: only jobs they are on (assignment or
// pm_email). The job page's History tab and Overview "Recent Activity" both read
// through here, so job-limited staff never see another job's history.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('job_id')
  if (!jobId) return Response.json({ error: 'job_id required' }, { status: 400 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, jobId)
  if (denied) return denied
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit'), 10) || 500, 1), 500)

  const { data, error } = await adminSupabase
    .from('change_log')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ log: data || [] })
}
