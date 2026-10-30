import { createClient } from '@supabase/supabase-js'
import { isBotEmail } from './bot-rules'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Verify caller's Supabase JWT from Authorization: Bearer <token>.
 * Returns { userId, email, role, companyId, error: null } on success.
 * Returns { error: Response } on failure — caller should: if (auth.error) return auth.error
 */
export async function requireAuth(request) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Validate token via anon client — the user's own JWT is verified against Supabase
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token)
  if (authErr || !user) {
    return { error: Response.json({ error: 'Unauthorized — invalid or expired token' }, { status: 401 }) }
  }
  // Bot users only work through /api/bot/v1 with an API key
  if (isBotEmail(user.email)) {
    return { error: Response.json({ error: 'Bot accounts can only use the Bot API' }, { status: 403 }) }
  }

  // Fetch role/company from profiles via service role (bypasses RLS, safe)
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    role: profile?.role ?? null,
    companyId: profile?.company_id ?? null,
    error: null,
  }
}

export const PM_ROLES = new Set(['pm', 'apm', 'super', 'admin'])
export const SUB_ROLES = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])

export const isPM = (role) => PM_ROLES.has(role)
export const isSub = (role) => SUB_ROLES.has(role)

/**
 * Like requireAuth but also enforces PM/APM/super role.
 */
export async function requirePM(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth
  if (!isPM(auth.role)) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

/**
 * Like requireAuth but limited to the given roles.
 */
export async function requireRole(request, roles) {
  const auth = await requireAuth(request)
  if (auth.error) return auth
  if (!roles.includes(auth.role)) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

/**
 * Verify a cron request. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`;
 * `x-cron-secret: <CRON_SECRET>` is accepted for manual runs.
 * Fails closed when CRON_SECRET is not configured.
 */
export function verifyCronSecret(request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization') || ''
  if (header === `Bearer ${expected}`) return true
  const secret = request.headers.get('x-cron-secret')
  return secret !== null && secret === expected
}
