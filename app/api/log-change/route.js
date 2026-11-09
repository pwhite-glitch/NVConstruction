import { requireAuth } from '../../../lib/server-auth'
import { logChange, CLIENT_LOG_ENTITY_TYPES, CLIENT_LOG_FIELDS, LOG_NOTE_MAX } from '../../../lib/change-log'
import { denyJob } from '../../../lib/roles'
import { JOB_DETAILS_WRITER_ROLES } from '../../../lib/job-details'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const clip = (v, n) => (v == null ? null : String(v).slice(0, n))

// POST /api/log-change { job_id, entity_type, entity_id?, field_name, old_value, new_value, note }
// Lets the job page record a Details change (status / contract value / contract
// completion date) or an owner CO's days_added on create. Only the
// Details writer roles, only allow-listed entity types and fields, job_id
// required and job access checked. changed_by / changed_by_name come from the
// session and the caller's profile — never from the body.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!JOB_DETAILS_WRITER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const { job_id, entity_type, entity_id, field_name, old_value, new_value, note } = body
  if (typeof job_id !== 'string' || !job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (!CLIENT_LOG_ENTITY_TYPES.has(entity_type)) return Response.json({ error: `entity_type must be one of: ${[...CLIENT_LOG_ENTITY_TYPES].join(', ')}` }, { status: 400 })
  if (!CLIENT_LOG_FIELDS[entity_type]?.has(field_name)) return Response.json({ error: 'field_name not allowed for this entity_type' }, { status: 400 })

  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied
  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('id').eq('id', job_id).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })

  // A 'job' entry is always about this job (body entity_id ignored). Any other entity
  // (prime_change_order) names its own row, which must belong to this job.
  let entityId = job_id
  if (entity_type === 'prime_change_order') {
    if (typeof entity_id !== 'string' || !entity_id) return Response.json({ error: 'entity_id required' }, { status: 400 })
    const { data: co, error: coErr } = await adminSupabase.from('prime_change_orders').select('id, job_id').eq('id', entity_id).maybeSingle()
    if (coErr) return Response.json({ error: coErr.message }, { status: 500 })
    if (!co || co.job_id !== job_id) return Response.json({ error: 'Change order not found on this job.' }, { status: 404 })
    entityId = co.id
  }

  await logChange({
    job_id,
    entity_type,
    entity_id: entityId,
    field_name,
    old_value: clip(old_value, 200),
    new_value: clip(new_value, 200),
    changed_by: auth.userId,
    note: clip(note, LOG_NOTE_MAX),
  })

  return Response.json({ ok: true })
}
