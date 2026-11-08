import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { isBotAccount, BOT_NOT_STAFF_MESSAGE } from '../../../lib/bot-rules'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { job_id, user_id, assigned_by } = await request.json()
    if (!job_id || !user_id) return Response.json({ error: 'job_id and user_id required' }, { status: 400 })
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    // Portal Bot logins are never on a job's team (the rest of this route's
    // lockdown is a separate package).
    const { data: prof, error: pErr } = await adminSupabase.from('profiles').select('*').eq('id', user_id).maybeSingle()
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 })
    const { data: target } = await adminSupabase.auth.admin.getUserById(user_id)
    if (isBotAccount(prof, target?.user?.email)) return Response.json({ error: BOT_NOT_STAFF_MESSAGE }, { status: 400 })
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'pm_job_assignments', id)
    if (denied) return denied
    const { error } = await adminSupabase.from('pm_job_assignments').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
