import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal, ownerChangeError } from '../../../lib/roles'
import { isBotAccount } from '../../../lib/bot-rules'
import { logChange } from '../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_ROLES = ['pm', 'apm', 'super', 'subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']
// NV Team role picker: staff roles only, staff targets only.
const TEAM_ROLES = ['principal', 'pm', 'apm', 'super', 'admin']

// POST { action: 'team_role', user_id, role } — the NV Team tab's Role dropdown.
// Owner-only (checked by the caller), allow-listed roles, staff targets only,
// never a Portal Bot, and ownerChangeError keeps the last Owner. The change is
// stamped in change_log from the session.
async function setTeamRole(auth, body) {
  const { user_id, role } = body
  if (typeof user_id !== 'string' || !user_id) return Response.json({ error: 'user_id required' }, { status: 400 })
  if (!TEAM_ROLES.includes(role)) return Response.json({ error: `Role must be one of: ${TEAM_ROLES.join(', ')}` }, { status: 400 })
  const { data: target, error } = await adminSupabase.from('profiles').select('*').eq('id', user_id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!target) return Response.json({ error: 'Team member not found.' }, { status: 404 })
  if (!TEAM_ROLES.includes(target.role)) return Response.json({ error: 'Only NV team members can be changed here.' }, { status: 400 })
  if (isBotAccount(target)) return Response.json({ error: 'Portal Bot logins are managed in Bot Access.' }, { status: 400 })
  if (target.role === role) return Response.json({ ok: true, user_id, role, unchanged: true })
  const ownerErr = await ownerChangeError(adminSupabase, auth, user_id, role)
  if (ownerErr) return Response.json({ error: ownerErr.error }, { status: ownerErr.status })
  const { data: updated, error: upErr } = await adminSupabase.from('profiles').update({ role }).eq('id', user_id).eq('role', target.role).select('id, role')
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
  if (!updated?.length) return Response.json({ error: 'That role changed while you were editing. Refresh and try again.' }, { status: 409 })
  await logChange({
    entity_type: 'profile', entity_id: user_id, field_name: 'role',
    old_value: target.role, new_value: role, changed_by: auth.userId,
    note: `NV Team role changed for ${target.full_name || user_id}: ${target.role} → ${role}`,
  })
  return Response.json({ ok: true, user_id, role })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  // Setting anyone's role is Owner-only (principal).
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Only Owners can change account roles.' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (body?.action === 'team_role') return setTeamRole(auth, body)
  const { email, role, full_name, company_name, company_id, invite_email } = body

  if (!email || !role) return Response.json({ error: 'email and role required' }, { status: 400 })
  if (!ALLOWED_ROLES.includes(role)) return Response.json({ error: 'Invalid role' }, { status: 400 })

  const { data: { users }, error: listErr } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return Response.json({ error: listErr.message }, { status: 500 })

  const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) return Response.json({ error: `No account found for ${email}` }, { status: 404 })

  const { data: existing } = await adminSupabase.from('profiles').select('id, company_name, invite_email').eq('id', user.id).maybeSingle()
  // Never demote the last Owner.
  const ownerErr = await ownerChangeError(adminSupabase, auth, user.id, role)
  if (ownerErr) return Response.json({ error: ownerErr.error }, { status: ownerErr.status })

  const profileFields = {
    role,
    invite_email: invite_email || user.email,
    ...(full_name ? { full_name } : {}),
    ...(company_name ? { company_name } : {}),
    ...(company_id ? { company_id } : {}),
  }

  let dbError
  if (existing) {
    const { error } = await adminSupabase.from('profiles').update(profileFields).eq('id', user.id)
    dbError = error
  } else {
    const { error } = await adminSupabase.from('profiles')
      .insert({ id: user.id, full_name: full_name || user.user_metadata?.full_name || 'Invited User', ...profileFields })
    dbError = error
  }

  // If sub_* role not in DB constraint yet, retry with 'subcontractor'
  if (dbError?.message?.includes('role_check') && profileFields.role !== 'subcontractor') {
    profileFields.role = 'subcontractor'
    const { error: retryErr } = existing
      ? await adminSupabase.from('profiles').update(profileFields).eq('id', user.id)
      : await adminSupabase.from('profiles').insert({ id: user.id, full_name: full_name || user.user_metadata?.full_name || 'Invited User', ...profileFields })
    dbError = retryErr
  }

  if (dbError) return Response.json({ error: dbError.message }, { status: 500 })
  return Response.json({ ok: true, user_id: user.id, action: existing ? 'updated' : 'created' })
}
