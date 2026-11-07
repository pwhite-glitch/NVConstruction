// Rules for /api/invite-sub and /api/invite-team-member when the email
// already has an auth account (Resend / Reset PW). Those routes then only send
// a recovery link: they must not change the person's role or name, must never
// touch an office (Owner/PM/APM/Super/Admin) or client account, and may only
// fill company fields that are currently blank.
import { SUB_ROLES } from './server-auth'
import { ownerChangeError, normEmail, ilikeExact } from './roles'

// The existing profile for an auth user: by id, else by invite_email.
// Returns { profile } (null when none) or { error }.
export async function loadExistingProfile(db, userId, email) {
  const cols = 'id, role, full_name, company_id, company_name, invite_email'
  if (userId) {
    const { data, error } = await db.from('profiles').select(cols).eq('id', userId).maybeSingle()
    if (error) return { error }
    if (data) return { profile: data }
  }
  const e = normEmail(email)
  if (!e) return { profile: null }
  const { data, error } = await db.from('profiles').select(cols).ilike('invite_email', ilikeExact(e)).limit(1)
  if (error) return { error }
  return { profile: data?.[0] || null }
}

// Null when a recovery link may be sent to this existing account, else { status, error }.
// `profile` is what loadExistingProfile returned (may be null: no profile row yet).
export async function existingInviteTargetError(db, auth, userId, profile) {
  const ownerErr = await ownerChangeError(db, auth, userId, null)
  if (ownerErr) return ownerErr
  if (profile && !SUB_ROLES.has(profile.role)) {
    return { status: 403, error: 'That email belongs to an existing non-subcontractor account. Change it from Settings → Team instead.' }
  }
  return null
}

// Fields to write on an existing sub profile: company_id / company_name only,
// and only where they are blank today. Never role, full_name, or invite_email.
// Returns {} when nothing needs filling.
export function blankCompanyFill(profile, { companyId, companyName } = {}) {
  const fill = {}
  if (!profile) return fill
  if (!profile.company_id && companyId) fill.company_id = companyId
  if (!String(profile.company_name || '').trim() && String(companyName || '').trim()) fill.company_name = String(companyName).trim()
  return fill
}
