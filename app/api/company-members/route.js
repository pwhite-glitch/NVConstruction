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
    .select('id, full_name, phone, company_id, company_name, invite_email, role')
    .in('role', ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])

  if (company_id) query = query.eq('company_id', company_id)
  if (email) query = query.eq('invite_email', email.toLowerCase())

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Merge last_sign_in_at from auth so UI can distinguish truly-registered users from pending invites
  let members = data || []
  if (members.length > 0) {
    try {
      const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
      const byEmail = {}
      authData?.users?.forEach(u => { if (u.email) byEmail[u.email.toLowerCase()] = { last_sign_in_at: u.last_sign_in_at, created_at: u.created_at } })
      members = members.map(m => ({
        ...m,
        last_sign_in_at: byEmail[m.invite_email?.toLowerCase()]?.last_sign_in_at || null,
        invited_at: byEmail[m.invite_email?.toLowerCase()]?.created_at || null,
      }))
    } catch (_) {
      // listUsers failed — members still returned, just without sign-in status
    }
  }

  return Response.json({ members })
}
