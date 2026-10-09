import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM } from '../../../lib/server-auth'
import { invalidateCache } from '../../../lib/permissions'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALL_ROLES = ['pm', 'apm', 'super', 'admin', 'metal_rep', 'roofing_rep', 'subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator']

// GET /api/role-permissions
//   ?role=<role>  → returns { features: string[] } for that role (requireAuth, own role or PM for any)
//   (no params)   → returns { matrix: { [role]: { [feature_key]: boolean } } } (requirePM)
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const roleParam = searchParams.get('role')

  if (roleParam) {
    // Requesting enabled features for a specific role
    if (!isPM(auth.role) && auth.role !== roleParam) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { data } = await adminSupabase
      .from('role_permissions')
      .select('feature_key, enabled')
      .eq('role', roleParam)
    const features = (data || []).filter(r => r.enabled).map(r => r.feature_key)
    return Response.json({ features })
  }

  // Full matrix — PM roles only
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { data } = await adminSupabase
    .from('role_permissions')
    .select('role, feature_key, enabled, updated_at, updated_by')
    .order('role')
    .order('feature_key')

  // Build matrix: { [role]: { [feature_key]: boolean } }
  const matrix = {}
  for (const role of ALL_ROLES) matrix[role] = {}
  for (const row of data || []) {
    if (!matrix[row.role]) matrix[row.role] = {}
    matrix[row.role][row.feature_key] = row.enabled
  }

  return Response.json({ matrix })
}

// PATCH /api/role-permissions — update a single cell (pm role only, not apm/super/admin)
// Body: { role, feature_key, enabled }
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (auth.role !== 'pm') return Response.json({ error: 'Only Project Managers can edit permissions.' }, { status: 403 })

  const { role, feature_key, enabled } = await request.json()
  if (!role || !feature_key || typeof enabled !== 'boolean') {
    return Response.json({ error: 'role, feature_key, and enabled (boolean) are required' }, { status: 400 })
  }
  if (!ALL_ROLES.includes(role)) {
    return Response.json({ error: `Unknown role: ${role}` }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('role_permissions')
    .upsert({ role, feature_key, enabled, updated_at: new Date().toISOString(), updated_by: auth.userId }, { onConflict: 'role,feature_key' })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Evict server-side cache so the next API request picks up the new value
  invalidateCache(role)

  return Response.json({ ok: true })
}

// POST /api/role-permissions/reset — reset a role to seed defaults (PM only)
// Body: { role }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { role } = await request.json()
  if (!role || !ALL_ROLES.includes(role)) {
    return Response.json({ error: 'Valid role required' }, { status: 400 })
  }

  // Delete all current rows for this role — they'll be re-read from the migration seed on next load
  // (In practice, you'd re-insert the seed values here)
  // For now just return not-implemented so the UI doesn't show the button without wiring
  return Response.json({ error: 'Reset to defaults not yet implemented — edit the DB directly or re-run the seed migration.' }, { status: 501 })
}
