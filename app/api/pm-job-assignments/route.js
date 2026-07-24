import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { job_id, user_id, assigned_by } = await request.json()
    if (!job_id || !user_id) return Response.json({ error: 'job_id and user_id required' }, { status: 400 })
    const { error } = await adminSupabase.from('pm_job_assignments').insert({ job_id, user_id, assigned_by: assigned_by || null })
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'already_assigned' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('pm_job_assignments').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
