import { supabase } from './supabase'

/**
 * fetch() drop-in that adds Authorization: Bearer <token> from the current Supabase session.
 * Use this instead of plain fetch() for all authenticated API routes.
 */
export async function authFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}
