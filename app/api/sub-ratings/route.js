import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, accessibleJobIds, isJobLimited } from '../../../lib/roles'
import { ratingScoresError, subIsOnJob } from '../../../lib/sub-ratings'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const sub_id = searchParams.get('sub_id')
  const job_id = searchParams.get('job_id')
  if (job_id) {
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
  }
  let q = adminSupabase.from('sub_ratings').select('*, jobs(job_number, project_name)')
  if (sub_id) q = q.eq('sub_id', sub_id)
  if (job_id) q = q.eq('job_id', job_id)
  else if (isJobLimited(auth.role)) {
    const { ids, error: accErr } = await accessibleJobIds(adminSupabase, auth)
    if (accErr) return Response.json({ error: accErr.message }, { status: 500 })
    if (ids.size === 0) return Response.json({ ratings: [] })
    q = q.in('job_id', [...ids])
  }
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ratings: data || [] })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  // rated_by in the body is ignored: the rater is always the signed-in user.
  const { sub_id, job_id, quality, timeliness, communication, notes } = body || {}
  if (!sub_id || !job_id) {
    return Response.json({ error: 'sub_id and job_id required' }, { status: 400 })
  }
  const scoreErr = ratingScoresError({ quality, timeliness, communication })
  if (scoreErr) return Response.json({ error: scoreErr }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied
  const onJob = await subIsOnJob(adminSupabase, sub_id, job_id)
  if (onJob.error) return Response.json({ error: onJob.error.message }, { status: 500 })
  if (!onJob.ok) return Response.json({ error: 'That sub is not on this job.' }, { status: 400 })
  const { data: rating, error } = await adminSupabase
    .from('sub_ratings')
    .upsert({
      sub_id, job_id, rated_by: auth.userId, quality, timeliness, communication,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 2000) : null,
    }, { onConflict: 'sub_id,job_id' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rating })
}
