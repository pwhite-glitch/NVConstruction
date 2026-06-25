import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const company_id = searchParams.get('company_id')
  const email = searchParams.get('email')

  let query = adminSupabase
    .from('profiles')
    .select('id, full_name, phone, company_id, invite_email')
    .eq('role', 'subcontractor')

  if (company_id) query = query.eq('company_id', company_id)
  if (email) query = query.eq('invite_email', email.toLowerCase())

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Merge last_sign_in_at from auth so UI can distinguish truly-registered users from pending invites
  let members = data || []
  if (members.length > 0) {
    const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    const signInByEmail = {}
    users?.forEach(u => { if (u.email) signInByEmail[u.email.toLowerCase()] = u.last_sign_in_at })
    members = members.map(m => ({
      ...m,
      last_sign_in_at: signInByEmail[m.invite_email?.toLowerCase()] || null,
    }))
  }

  return Response.json({ members })
}
