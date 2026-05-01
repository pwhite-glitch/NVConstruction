import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const { email, full_name, role, phone } = await request.json()
  if (!email || !role) {
    return Response.json({ error: 'Email and role are required.' }, { status: 400 })
  }

  const { data, error } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
  })

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  await adminSupabase.from('profiles').upsert({
    id: data.user.id,
    email,
    full_name: full_name || null,
    role,
    phone: phone || null,
  })

  return Response.json({ ok: true })
}
