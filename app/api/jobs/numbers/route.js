import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { JOB_NUMBER_ROLES } from '../../../../lib/job-numbers'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PAGE = 1000

// GET — every existing job number (active, completed, archived, preview) with
// its job type, so new-job screens can suggest the next number and warn about
// duplicates. Only the roles that create jobs may call it, and it returns only
// the distinct (job_number, job_type) pairs: no ids, names, people or money.
// Reads in pages so it is not cut off at the API's default 1000-row limit.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!JOB_NUMBER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const seen = new Set()
  const jobs = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await adminSupabase
      .from('jobs')
      .select('id, job_number, job_type')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    for (const j of data || []) {
      const num = j.job_number == null ? '' : String(j.job_number).trim()
      if (!num) continue
      const type = j.job_type === 'residential' ? 'residential' : 'commercial'
      const key = `${type}\u0000${num}`
      if (seen.has(key)) continue
      seen.add(key)
      jobs.push({ job_number: num, job_type: type })
    }
    if (!data || data.length < PAGE) break
  }
  return Response.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
}
