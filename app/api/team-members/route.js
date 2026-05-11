import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  const { data: profiles, error } = await adminSupabase
    .from('profiles')
    .select('id, full_name, email, role, phone')
    .in('role', ['pm', 'apm', 'super', 'admin'])
    .order('full_name')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // profiles.email may be null — backfill from auth.users
  const profilesNeedingEmail = (profiles || []).filter(p => !p.email)
  if (profilesNeedingEmail.length > 0) {
    const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    const emailMap = Object.fromEntries((users || []).map(u => [u.id, u.email]))
    profiles.forEach(p => { if (!p.email) p.email = emailMap[p.id] || null })
  }

  return Response.json({ members: profiles || [] })
}
