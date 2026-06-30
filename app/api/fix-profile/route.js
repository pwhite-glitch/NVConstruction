import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const { email, role, full_name } = await request.json()
  if (!email || !role) return Response.json({ error: 'email and role required' }, { status: 400 })

  const { data: { users }, error: listErr } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return Response.json({ error: listErr.message }, { status: 500 })

  const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) return Response.json({ error: `No account found for ${email}` }, { status: 404 })

  const { data: existing } = await adminSupabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  let dbError
  if (existing) {
    const { error } = await adminSupabase
      .from('profiles')
      .update({ role, ...(full_name ? { full_name } : {}) })
      .eq('id', user.id)
    dbError = error
  } else {
    const { error } = await adminSupabase
      .from('profiles')
      .insert({ id: user.id, role, full_name: full_name || user.user_metadata?.full_name || null })
    dbError = error
  }

  if (dbError) return Response.json({ error: dbError.message }, { status: 500 })
  return Response.json({ ok: true, user_id: user.id, action: existing ? 'updated' : 'created' })
}
