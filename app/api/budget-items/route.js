import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, denyJobs } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST: insert one row or an array of rows
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const rows = Array.isArray(body) ? body : [body]
    const denied = await denyJobs(adminSupabase, auth, rows.map(r => r?.job_id))
    if (denied) return denied
    const { error } = await adminSupabase.from('budget_items').insert(body)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT: update a single row by id, or increment fields ({ id, increment: { field: delta } })
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id, fields } = await request.json()
    if (!id || !fields) return Response.json({ error: 'id and fields required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'budget_items', id)
      || (fields.job_id ? await denyJob(adminSupabase, auth, fields.job_id) : null)
    if (denied) return denied
    const { error } = await adminSupabase.from('budget_items').update(fields).eq('id', id)
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
    const body = await request.json()
    if (body.job_id) {
      const denied = await denyJob(adminSupabase, auth, body.job_id)
      if (denied) return denied
      const { error } = await adminSupabase.from('budget_items').delete().eq('job_id', body.job_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }
    if (!body.id) return Response.json({ error: 'id or job_id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'budget_items', body.id)
    if (denied) return denied
    const { error } = await adminSupabase.from('budget_items').delete().eq('id', body.id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
