import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('user_id')
  if (!userId) return Response.json({ error: 'user_id required' }, { status: 400 })

  // Get caller's company_id
  const { data: caller } = await adminSupabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .single()

  if (!caller?.company_id) return Response.json({ members: [] })

  const { data: profiles } = await adminSupabase
    .from('profiles')
    .select('id, full_name, role, phone, invite_email, company_name')
    .eq('company_id', caller.company_id)
    .order('full_name')

  // Get last_sign_in_at from auth
  const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  const authMap = Object.fromEntries((authData?.users || []).map(u => [u.id, { email: u.email, last_sign_in_at: u.last_sign_in_at }]))

  const members = (profiles || []).map(p => ({
    ...p,
    email: authMap[p.id]?.email || p.invite_email || null,
    last_sign_in_at: authMap[p.id]?.last_sign_in_at || null,
  }))

  return Response.json({ members, company_id: caller.company_id })
}
