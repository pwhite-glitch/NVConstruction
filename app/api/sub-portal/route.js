import { createClient } from '@supabase/supabase-js'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { getSubAccess } from '../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET → the signed-in sub user's jobs (with per-job billing state) and the
// billing history they're allowed to see. Runs with the service role so a
// teammate who wasn't assigned by name isn't blocked by RLS on jobs.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isSub(auth.role)) return Response.json({ error: 'Sub portal only' }, { status: 403 })
  try {
    const { profile, members, jobs } = await getSubAccess(auth.userId, auth.email)
    if (!profile) return Response.json({ jobs: [], submissions: [], member_ids: [auth.userId] })

    // Company billing history, limited to jobs this person can see (plus anything they submitted themselves)
    const memberIds = members.map(m => m.id)
    const jobIds = new Set(jobs.map(j => j.id))
    const { data: subs } = await adminSupabase
      .from('billing_submissions')
      .select('*, jobs(job_number, project_name, location, owner_name, owner_company)')
      .in('sub_id', memberIds)
      .order('submitted_at', { ascending: false })
    const submissions = (subs || []).filter(s => s.sub_id === auth.userId || jobIds.has(s.job_id))

    return Response.json({
      jobs,
      submissions,
      member_ids: memberIds,
      job_access: profile.job_access || 'company',
      can_bill: profile.can_bill !== false,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
