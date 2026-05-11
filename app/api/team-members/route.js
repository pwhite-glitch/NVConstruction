import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  // Fetch all profiles to see what roles exist
  const { data: allProfiles, error: allErr } = await adminSupabase
    .from('profiles')
    .select('id, full_name, email, role, phone')
    .order('full_name')

  // Fetch all auth users
  const { data: authData, error: authErr } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  const authUsers = authData?.users || []
  const emailMap = Object.fromEntries(authUsers.map(u => [u.id, u.email]))

  // Merge emails into profiles
  const merged = (allProfiles || []).map(p => ({ ...p, email: p.email || emailMap[p.id] || null }))

  const members = merged.filter(p => ['pm', 'apm', 'super', 'admin'].includes(p.role))

  return Response.json({
    members,
    debug: {
      totalProfiles: allProfiles?.length,
      allProfilesError: allErr?.message,
      totalAuthUsers: authUsers.length,
      authError: authErr?.message,
      rolesFound: [...new Set((allProfiles || []).map(p => p.role))],
    }
  })
}
