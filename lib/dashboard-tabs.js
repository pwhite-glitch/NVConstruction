// Dashboard ?tab= handling. The allowed keys are the nav items the signed-in
// (effective) role actually sees, so a query string can never open a tab the
// role can't (e.g. Owner-only Permissions / NV Team / Business Dev).
// No imports: browser and tests.

export const DEFAULT_DASHBOARD_TAB = 'overview'

// Tab to show for a requested key: the key when allowed, else the fallback.
export function resolveDashboardTab(requested, allowedKeys, fallback = DEFAULT_DASHBOARD_TAB) {
  if (!requested) return fallback
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys || [])
  return allowed.has(String(requested)) ? String(requested) : fallback
}

// The ?tab= value in a search string ('' when none).
export function tabFromSearch(search) {
  try { return new URLSearchParams(search || '').get('tab') || '' } catch { return '' }
}

// path + search + hash for `tab`, keeping every other query arg and the hash.
// The default tab is written as no ?tab= at all (plain /dashboard).
export function dashboardUrlForTab({ pathname = '/dashboard', search = '', hash = '' } = {}, tab, defaultTab = DEFAULT_DASHBOARD_TAB) {
  const params = new URLSearchParams(search || '')
  if (!tab || tab === defaultTab) params.delete('tab')
  else params.set('tab', tab)
  const qs = params.toString()
  return `${pathname}${qs ? '?' + qs : ''}${hash || ''}`
}
