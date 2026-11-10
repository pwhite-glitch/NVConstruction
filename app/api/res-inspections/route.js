import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob, denyUnlessOnJob, atLeastPM } from '../../../lib/roles'
import { inspectionFields, inspectionOut, INSPECTION_SELECT, INSPECTION_SELECT_PRE064, isMissing064Column, withoutInspection064 } from '../../../lib/res-inspections'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Job inspections (table res_inspections, every job type since prompt67d) through the
// service role. Migration 046's browser policy is office-only, so supers go through here.
//   Owner (principal) / admin: every job.
//   PM / APM: their jobs (assignment or pm_email) — denyJob.
//   Super: only jobs they are assigned to — denyUnlessOnJob.
//   Everyone else (subs, client owners, reps): 403.
// Delete matches the office page (Owner / PM only, on their job).
// Migration 064 adds agency + lookahead_activity_id; before it, reads and writes retry
// with the pre-064 column list (has064: false → the UI hides Agency / the lookahead link).
const INSPECTION_ROLES = new Set(['principal', 'admin', 'pm', 'apm', 'super'])

const bad = (error, status = 400) => Response.json({ error }, { status })

// Null when the caller may use this job's inspections, else a Response.
async function jobDenied(auth, jobId) {
  if (!INSPECTION_ROLES.has(auth?.role)) return bad('Forbidden', 403)
  if (!jobId) return bad('Job not found.', 404)
  const denied = auth.role === 'super'
    ? await denyUnlessOnJob(adminSupabase, auth, jobId)
    : await denyJob(adminSupabase, auth, jobId)
  if (denied) return denied
  const { data: job, error } = await adminSupabase.from('jobs').select('id, job_type').eq('id', jobId).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!job) return bad('Job not found.', 404)
  return null
}

// Run a res_inspections query with the full column list; if a 064 column is missing,
// run it again with the pre-064 list. build(select, pre064) → query promise.
async function with064Fallback(build) {
  const first = await build(INSPECTION_SELECT, false)
  if (!first.error || !isMissing064Column(first.error)) return { ...first, has064: !first.error }
  const second = await build(INSPECTION_SELECT_PRE064, true)
  return { ...second, has064: false }
}

// Load one inspection, then check the caller against ITS job (never a job id from the body).
async function loadForCaller(auth, id) {
  if (!INSPECTION_ROLES.has(auth?.role)) return { res: bad('Forbidden', 403) }
  if (!id) return { res: bad('id required') }
  const { data, error, has064 } = await with064Fallback(sel => adminSupabase.from('res_inspections').select(sel).eq('id', id).maybeSingle())
  if (error) return { res: bad(error.message, 500) }
  if (!data) return { res: bad('Inspection not found.', 404) }
  const denied = await jobDenied(auth, data.job_id)
  if (denied) return { res: denied }
  return { row: data, has064 }
}

// A lookahead activity may only be linked when its lookahead belongs to the same job.
async function linkDenied(jobId, activityId) {
  if (!activityId) return null
  const { data: act, error } = await adminSupabase.from('lookahead_activities').select('id, lookahead_id').eq('id', activityId).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!act?.lookahead_id) return bad('That lookahead activity is not on this job.')
  const { data: la, error: laErr } = await adminSupabase.from('lookaheads').select('id, job_id').eq('id', act.lookahead_id).maybeSingle()
  if (laErr) return bad(laErr.message, 500)
  if (!la || String(la.job_id) !== String(jobId)) return bad('That lookahead activity is not on this job.')
  return null
}

// A linked inspection with a scheduled date marks the activity "inspection scheduled"
// (never cleared automatically). The link is re-checked here because a row written outside
// this API may point at another job's activity: on a mismatch nothing is written (silently).
async function markActivityScheduled(row) {
  if (!row?.lookahead_activity_id || !row.scheduled_date) return null
  const denied = await linkDenied(row.job_id, row.lookahead_activity_id)
  if (denied) {
    if (denied.status >= 500) return 'Inspection saved, but the lookahead activity was not marked scheduled (lookup failed).'
    return null
  }
  const { error } = await adminSupabase.from('lookahead_activities')
    .update({ inspection_scheduled: true }).eq('id', row.lookahead_activity_id)
  return error ? `Inspection saved, but the lookahead activity was not marked scheduled: ${error.message}` : null
}

async function readBody(request) {
  try { return await request.json() } catch { return null }
}

// GET ?job_id → { inspections, has064 }
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  const denied = await jobDenied(auth, jobId)
  if (denied) return denied
  const { data, error, has064 } = await with064Fallback(sel => adminSupabase.from('res_inspections').select(sel).eq('job_id', jobId).order('scheduled_date'))
  if (error) return bad(error.message, 500)
  return Response.json({ inspections: (data || []).map(inspectionOut), has064 })
}

// POST { job_id, inspection_type, scheduled_date?, inspector_name?, notes?, result?, actual_date?,
//        agency?, lookahead_activity_id? }
// (schedule a new inspection, or a re-inspection after a failure)
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const body = await readBody(request)
  if (!body) return bad('Invalid JSON')
  const denied = await jobDenied(auth, body.job_id)
  if (denied) return denied
  const v = inspectionFields(body, { create: true })
  if (v.error) return bad(v.error)
  const linkErr = await linkDenied(body.job_id, v.fields.lookahead_activity_id)
  if (linkErr) return linkErr
  const { data, error, has064 } = await with064Fallback((sel, pre064) => adminSupabase.from('res_inspections')
    .insert({ ...(pre064 ? withoutInspection064(v.fields) : v.fields), job_id: body.job_id }).select(sel).single())
  if (error) return bad(error.message, 500)
  const warning = has064 ? await markActivityScheduled(data) : null
  return Response.json({ inspection: inspectionOut(data), has064, ...(warning ? { warning } : {}) })
}

// PATCH { id, ...allow-listed fields }  (record a result, reschedule, edit)
export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const body = await readBody(request)
  if (!body) return bad('Invalid JSON')
  const found = await loadForCaller(auth, body.id)
  if (found.res) return found.res
  const v = inspectionFields(body)
  if (v.error) return bad(v.error)
  if (!Object.keys(v.fields).length) return bad('Nothing to change.')
  const linkErr = await linkDenied(found.row.job_id, v.fields.lookahead_activity_id)
  if (linkErr) return linkErr
  let fields = v.fields
  if (!found.has064) {
    fields = withoutInspection064(fields)
    if (!Object.keys(fields).length) return Response.json({ inspection: inspectionOut(found.row), has064: false })
  }
  const { data, error, has064 } = await with064Fallback((sel, pre064) => adminSupabase.from('res_inspections')
    .update(pre064 ? withoutInspection064(fields) : fields)
    .eq('id', found.row.id).eq('job_id', found.row.job_id).select(sel))
  if (error) return bad(error.message, 500)
  if (!data?.length) return bad('Inspection not found.', 404)
  const warning = has064 ? await markActivityScheduled(data[0]) : null
  return Response.json({ inspection: inspectionOut(data[0]), has064, ...(warning ? { warning } : {}) })
}

// DELETE { id }  — Owner / PM only (same as the office page's ×).
export async function DELETE(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const body = await readBody(request)
  if (!body) return bad('Invalid JSON')
  if (!atLeastPM(auth.role)) return bad('Forbidden', 403)
  const found = await loadForCaller(auth, body.id)
  if (found.res) return found.res
  const { error } = await adminSupabase.from('res_inspections').delete().eq('id', found.row.id).eq('job_id', found.row.job_id)
  if (error) return bad(error.message, 500)
  return Response.json({ ok: true })
}
