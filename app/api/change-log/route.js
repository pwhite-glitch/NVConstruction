import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/change-log?job_id=<uuid>
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('job_id')
  if (!jobId) return Response.json({ error: 'job_id required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('change_log')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ log: data || [] })
}
