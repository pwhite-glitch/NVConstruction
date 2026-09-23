import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_ROLES = ['pm', 'apm', 'super', 'subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { email, role, full_name, company_name, company_id, invite_email } = body

  if (!email || !role) return Response.json({ error: 'email and role required' }, { status: 400 })
  if (!ALLOWED_ROLES.includes(role)) return Response.json({ error: 'Invalid role' }, { status: 400 })

  const { data: { users }, error: listErr } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return Response.json({ error: listErr.message }, { status: 500 })

  const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) return Response.json({ error: `No account found for ${email}` }, { status: 404 })

  const { data: existing } = await adminSupabase.from('profiles').select('id, company_name, invite_email').eq('id', user.id).maybeSingle()

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

  if (dbError) return Response.json({ error: dbError.message }, { status: 500 })
  return Response.json({ ok: true, user_id: user.id, action: existing ? 'updated' : 'created' })
}
