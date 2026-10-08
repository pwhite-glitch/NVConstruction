import { createClient } from '@supabase/supabase-js'

const COOKIE_SESSION = 'nvc_preview'
const COOKIE_ROLE    = 'nvc_preview_role'
const COOKIE_COMPANY = 'nvc_preview_company'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Which real roles may start a preview
export const PREVIEW_ADMIN_ROLES = new Set(['pm', 'admin'])

// Roles that can be previewed
export const PREVIEWABLE_ROLES = [
  'pm', 'apm', 'super', 'admin', 'subcontractor', 'sub_pm', 'sub_admin', 'owner',
]

// Sub roles that require a company context
export const SUB_PREVIEW_ROLES = new Set(['subcontractor', 'sub_pm', 'sub_admin'])

/**
 * Read and validate the active preview session from the request's HttpOnly cookie.
 * Returns the session row on success, or null when no valid session exists.
 */
export async function getPreviewSession(request) {
  const sessionId = request.cookies.get(COOKIE_SESSION)?.value
  if (!sessionId) return null

  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString()
  const { data } = await adminSupabase
    .from('preview_sessions')
    .select('id, started_by, preview_role, preview_company_id')
    .eq('id', sessionId)
    .is('ended_at', null)
    .gte('started_at', cutoff)
    .maybeSingle()

  return data ?? null
}

/** Build Set-Cookie header strings for a new preview session. */
export function buildPreviewCookies(sessionId, role, companyId) {
  const age  = Math.floor(SESSION_TTL_MS / 1000)
  const base = `; Path=/; SameSite=Lax; Max-Age=${age}`
  const cookies = [
    `${COOKIE_SESSION}=${sessionId}; HttpOnly${base}`,
    `${COOKIE_ROLE}=${encodeURIComponent(role)}${base}`,
  ]
  if (companyId) cookies.push(`${COOKIE_COMPANY}=${companyId}${base}`)
  return cookies
}

/** Set-Cookie headers that expire all three preview cookies immediately. */
export function clearPreviewCookies() {
  const base = `; Path=/; SameSite=Lax; Max-Age=0`
  return [
    `${COOKIE_SESSION}=; HttpOnly${base}`,
    `${COOKIE_ROLE}=${base}`,
    `${COOKIE_COMPANY}=${base}`,
  ]
}

/** End every active preview session for a user. */
export async function endAllPreviewSessions(userId) {
  await adminSupabase
    .from('preview_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('started_by', userId)
    .is('ended_at', null)
}
