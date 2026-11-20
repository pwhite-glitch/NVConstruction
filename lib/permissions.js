import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Module-level cache: Map<role, { keys: Set<string>, known: Set<string>, expiry: number }>
// keys = enabled feature keys; known = every key that has a row (enabled or not).
const _cache = new Map()
const TTL = 60_000 // 60 seconds

async function loadEntry(role) {
  const now = Date.now()
  const cached = _cache.get(role)
  if (cached && cached.expiry > now) return cached
  const { data, error } = await adminSupabase
    .from('role_permissions')
    .select('feature_key, enabled')
    .eq('role', role)
  const rows = error ? [] : (data || [])
  const entry = { keys: new Set(rows.filter(r => r.enabled).map(r => r.feature_key)), known: new Set(rows.map(r => r.feature_key)), expiry: now + TTL }
  // A failed read is not cached, so the next request tries again.
  if (!error) _cache.set(role, entry)
  return entry
}

async function loadForRole(role) {
  return (await loadEntry(role)).keys
}

export async function hasPermission(role, featureKey) {
  const keys = await loadForRole(role)
  return keys.has(featureKey)
}

// Like hasPermission, but a feature with NO row for this role (its seed migration not applied
// yet) uses `fallback` instead of "off". A row that exists always wins, either way.
export async function hasPermissionOr(role, featureKey, fallback) {
  const { keys, known } = await loadEntry(role)
  return known.has(featureKey) ? keys.has(featureKey) : !!fallback
}

export async function getEnabledFeatures(role) {
  return loadForRole(role)
}

export function invalidateCache(role) {
  if (role) _cache.delete(role)
  else _cache.clear()
}
