import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isBotAccount } from '../../../lib/bot-rules'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { data: profiles, error } = await adminSupabase
    .from('profiles')
    // '*' so is_bot (migration 036) is read when present without failing before it
    .select('*')
    .not('role', 'in', '("subcontractor","sub_estimator","sub_pm","sub_admin","owner","owner_rep")')
    .not('role', 'is', null)
    .order('full_name')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  const emailMap = Object.fromEntries((authData?.users || []).map(u => [u.id, u.email]))

  // Portal Bot logins stay in the Bot Access panel only.
  const members = (profiles || [])
    .filter(p => !isBotAccount(p, emailMap[p.id]))
    .map(p => ({ id: p.id, full_name: p.full_name, role: p.role, phone: p.phone ?? null, email: emailMap[p.id] || null }))
  return Response.json({ members })
}
