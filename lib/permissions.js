import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Module-level cache: Map<role, { keys: Set<string>, expiry: number }>
const _cache = new Map()
const TTL = 60_000 // 60 seconds

async function loadForRole(role) {
  const now = Date.now()
  const cached = _cache.get(role)
  if (cached && cached.expiry > now) return cached.keys
  const { data } = await adminSupabase
    .from('role_permissions')
    .select('feature_key, enabled')
    .eq('role', role)
  const keys = new Set((data || []).filter(r => r.enabled).map(r => r.feature_key))
  _cache.set(role, { keys, expiry: now + TTL })
  return keys
}

export async function hasPermission(role, featureKey) {
  const keys = await loadForRole(role)
  return keys.has(featureKey)
}

export async function getEnabledFeatures(role) {
  return loadForRole(role)
}

export function invalidateCache(role) {
  if (role) _cache.delete(role)
  else _cache.clear()
}
