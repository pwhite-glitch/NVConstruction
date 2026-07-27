import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  if (!email) return Response.json({ error: 'email param required' }, { status: 400 })

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ link: data.properties?.action_link })
}
