import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob, denyUnlessOnJob, atLeastPM } from '../../../lib/roles'
import { inspectionFields, inspectionOut, INSPECTION_SELECT } from '../../../lib/res-inspections'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Residential inspections (res_inspections) through the service role. Migration 046's
// browser policy is office-only, so supers go through here.
//   Owner (principal) / admin: every residential job.
//   PM / APM: their jobs (assignment or pm_email) — denyJob.
//   Super: only jobs they are assigned to — denyUnlessOnJob.
//   Everyone else (subs, client owners, reps): 403.
// Delete matches the office page (Owner / PM only, on their job).
const INSPECTION_ROLES = new Set(['principal', 'admin', 'pm', 'apm', 'super'])

const bad = (error, status = 400) => Response.json({ error }, { status })
const isResidential = job => String(job?.job_type ?? '').trim().toLowerCase() === 'residential'

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
  if (!isResidential(job)) return bad('Inspections are tracked on residential jobs only.')
  return null
}

// Load one inspection, then check the caller against ITS job (never a job id from the body).
async function loadForCaller(auth, id) {
  if (!INSPECTION_ROLES.has(auth?.role)) return { res: bad('Forbidden', 403) }
  if (!id) return { res: bad('id required') }
  const { data, error } = await adminSupabase.from('res_inspections').select(INSPECTION_SELECT).eq('id', id).maybeSingle()
  if (error) return { res: bad(error.message, 500) }
  if (!data) return { res: bad('Inspection not found.', 404) }
  const denied = await jobDenied(auth, data.job_id)
  if (denied) return { res: denied }
  return { row: data }
}

async function readBody(request) {
  try { return await request.json() } catch { return null }
}

// GET ?job_id → { inspections }
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  const denied = await jobDenied(auth, jobId)
  if (denied) return denied
  const { data, error } = await adminSupabase.from('res_inspections').select(INSPECTION_SELECT).eq('job_id', jobId).order('scheduled_date')
  if (error) return bad(error.message, 500)
  return Response.json({ inspections: (data || []).map(inspectionOut) })
}

// POST { job_id, inspection_type, scheduled_date?, inspector_name?, notes?, result?, actual_date? }
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
  const { data, error } = await adminSupabase.from('res_inspections').insert({ ...v.fields, job_id: body.job_id }).select(INSPECTION_SELECT).single()
  if (error) return bad(error.message, 500)
  return Response.json({ inspection: inspectionOut(data) })
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
  const { data, error } = await adminSupabase.from('res_inspections').update(v.fields)
    .eq('id', found.row.id).eq('job_id', found.row.job_id).select(INSPECTION_SELECT)
  if (error) return bad(error.message, 500)
  if (!data?.length) return bad('Inspection not found.', 404)
  return Response.json({ inspection: inspectionOut(data[0]) })
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
