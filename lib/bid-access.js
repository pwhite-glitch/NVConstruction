// Who may read / change a bid package (bid_packages + its plans, invitations,
// submissions, RFIs). No imports, so the dashboard, /bid/[id] and
// /api/bid-packages share one rule set.
//
//  • Owner (principal) and PM: read and change every package, including
//    "APM Access" (allowed_users) and delete.
//  • APM: only packages whose allowed_users lists them — read and ordinary
//    edits; never allowed_users or delete (so they cannot add themselves).
//  • Admin: read all; ordinary edits; not allowed_users or delete.
//  • Super: read all (as before), no writes at all.
//  • Everyone else (subs, client owners, reps): no staff access here (subs
//    reach their own invitations through /submit).

const MANAGER_ROLES = new Set(['principal', 'pm'])
const READ_ALL_ROLES = new Set(['principal', 'pm', 'admin', 'super'])
const WRITER_ROLES = new Set(['principal', 'pm', 'admin', 'apm'])

export const NO_BID_ACCESS_MESSAGE = "You don't have access to this bid package. Ask an Owner or PM to add you under APM Access."

export const isBidManager = role => MANAGER_ROLES.has(role)

export function bidAllowedUsers(pkg) {
  const list = pkg?.allowed_users
  return Array.isArray(list) ? list.map(String) : []
}

export function isOnBidPackage(pkg, userId) {
  return !!userId && bidAllowedUsers(pkg).includes(String(userId))
}

export function canReadBidPackage(role, userId, pkg) {
  if (READ_ALL_ROLES.has(role)) return true
  if (role === 'apm') return isOnBidPackage(pkg, userId)
  return false
}

export function canEditBidPackage(role, userId, pkg) {
  if (!WRITER_ROLES.has(role)) return false
  if (role === 'apm') return isOnBidPackage(pkg, userId)
  return true
}

export const canCreateBidPackage = role => WRITER_ROLES.has(role)

// PATCH guard. `updates` = the allow-listed fields being written.
// Returns null when allowed, else { status, error }.
export function bidPatchError(auth, pkg, updates) {
  const role = auth?.role
  if (role === 'super') return { status: 403, error: 'Superintendents cannot change bid packages.' }
  if (!canEditBidPackage(role, auth?.userId, pkg)) {
    return role === 'apm'
      ? { status: 403, error: NO_BID_ACCESS_MESSAGE }
      : { status: 403, error: 'Forbidden' }
  }
  if (updates && 'allowed_users' in updates && !isBidManager(role)) {
    return { status: 403, error: 'Only an Owner or PM can change APM Access.' }
  }
  return null
}

export function bidDeleteError(auth) {
  if (!isBidManager(auth?.role)) return { status: 403, error: 'Only an Owner or PM can delete a bid package.' }
  return null
}

// allowed_users must be a list of user ids (strings).
export function normalizeAllowedUsers(v) {
  if (v == null) return { list: [] }
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x.trim())) return { error: 'allowed_users must be a list of user ids.' }
  return { list: [...new Set(v.map(x => x.trim()))] }
}
