import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, isJobLimited } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Guard the package's job when it has one (packages with no job are not job-scoped).
async function denyPackage(auth, id) {
  if (!isJobLimited(auth.role)) return null
  const { data: pkg } = await adminSupabase.from('bid_packages').select('job_id').eq('id', id).maybeSingle()
  return pkg?.job_id ? denyJob(adminSupabase, auth, pkg.job_id) : null
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { title, description, scope_of_work, due_date, job_id, project_address, owner_name, insurance_req, bid_instructions } = body
    if (!title?.trim()) return Response.json({ error: 'title is required' }, { status: 400 })
    // A package with no job yet is not job-scoped
    if (job_id) {
      const denied = await denyJob(adminSupabase, auth, job_id)
      if (denied) return denied
    }

    const { data, error } = await adminSupabase.from('bid_packages').insert({
      title: title.trim(),
      description: description || null,
      scope_of_work: scope_of_work || null,
      due_date: due_date || null,
      job_id: job_id || null,
      project_address: project_address || null,
      owner_name: owner_name || null,
      insurance_req: insurance_req || null,
      bid_instructions: bid_instructions || null,
      created_by: auth.userId,
      status: 'open',
    }).select('id').single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const allowed = ['status', 'due_date', 'job_id', 'allowed_users']
    const updates = {}
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key]
    }

    if (Object.keys(updates).length === 0) return Response.json({ ok: true })

    const denied = await denyPackage(auth, id) || (updates.job_id ? await denyJob(adminSupabase, auth, updates.job_id) : null)
    if (denied) return denied

    const { error } = await adminSupabase.from('bid_packages').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyPackage(auth, id)
    if (denied) return denied
    const { error } = await adminSupabase.from('bid_packages').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
