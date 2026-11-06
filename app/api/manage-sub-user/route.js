import { createClient } from '@supabase/supabase-js'
import { requirePM, SUB_ROLES } from '../../../lib/server-auth'
import { ownerChangeError, ilikeExact } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Directory staff (requirePM) can edit and remove SUB company users only.
// Office/Owner/client accounts are managed elsewhere (invite-team, fix-profile).
const SUB_USER_ROLES = ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']

const fail = (status, error) => Response.json({ error }, { status })

// Load the target and refuse anything that is not a sub user. Returns { target } or { res }.
async function loadSubTarget(userId, cols = 'id, role') {
  const { data: target, error } = await adminSupabase.from('profiles').select(cols).eq('id', userId).maybeSingle()
  if (error) return { res: fail(500, error.message) }
  if (!target) return { res: fail(404, 'User not found.') }
  if (!SUB_ROLES.has(target.role)) return { res: fail(403, 'Only sub company users can be managed here.') }
  return { target }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    let body
    try { body = await request.json() } catch { return fail(400, 'Invalid JSON') }
    const { userId } = body || {}
    if (!userId) return fail(400, 'userId required')

    const { res } = await loadSubTarget(userId)
    if (res) return res

    // Whitelisted fields only.
    const update = {}
    if (body.full_name !== undefined) update.full_name = body.full_name
    if (body.phone !== undefined) update.phone = body.phone
    if (body.role !== undefined) {
      if (!SUB_USER_ROLES.includes(body.role)) return fail(400, 'Role must be a sub role (Sub, Sub Est, Sub PM, Sub Admin).')
      update.role = body.role
    }
    if (body.company_name !== undefined) update.company_name = body.company_name
    if (body.company_id !== undefined) update.company_id = body.company_id || null

    const ownerErr = await ownerChangeError(adminSupabase, auth, userId, update.role ?? null)
    if (ownerErr) return fail(ownerErr.status, ownerErr.error)

    // Auto-resolve company_id from companies table if name is set but id is missing
    if (!update.company_id && typeof update.company_name === 'string' && update.company_name.trim()) {
      const { data: co, error: coErr } = await adminSupabase
        .from('companies')
        .select('id')
        .ilike('name', ilikeExact(update.company_name.trim()))
        .limit(1)
        .maybeSingle()
      if (coErr) return fail(500, coErr.message)
      if (co?.id) update.company_id = co.id
    }

    if (!Object.keys(update).length) return fail(400, 'Nothing to update.')
    const { error } = await adminSupabase.from('profiles').update(update).eq('id', userId)
    if (error) return fail(400, error.message)

    return Response.json({ ok: true })
  } catch (e) {
    return fail(500, e.message)
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    let body
    try { body = await request.json() } catch { return fail(400, 'Invalid JSON') }
    const { userId } = body || {}
    if (!userId) return fail(400, 'userId required')
    if (userId === auth.userId) return fail(403, "You can't remove your own account.")

    const { target, res } = await loadSubTarget(userId, '*')
    if (res) return res
    const ownerErr = await ownerChangeError(adminSupabase, auth, userId, null)
    if (ownerErr) return fail(ownerErr.status, ownerErr.error)

    // Remove profile first so RLS-protected tables don't block the auth delete
    const { error: profileErr } = await adminSupabase.from('profiles').delete().eq('id', userId)
    if (profileErr) return fail(500, 'Could not delete profile: ' + profileErr.message)

    // Hard-delete from auth — this invalidates any pending invite links
    const { error } = await adminSupabase.auth.admin.deleteUser(userId)
    if (error) {
      // Don't leave a login with no profile: put the profile back.
      const { error: restoreErr } = await adminSupabase.from('profiles').insert(target)
      const msg = restoreErr
        ? `Could not delete login (${error.message}) and could not restore the profile (${restoreErr.message}). The login has no profile now — contact support.`
        : `Could not delete login: ${error.message}. The profile was restored; nothing was removed.`
      return fail(500, msg)
    }

    return Response.json({ ok: true })
  } catch (e) {
    return fail(500, e.message)
  }
}
