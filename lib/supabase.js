import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Every /api route requires a signed-in user, so attach the session token to
// same-origin /api/ calls that don't already set Authorization. Plain
// fetch('/api/...') then behaves like authFetch (lib/client-fetch.js). This
// module is loaded on every page via the root layout's components.
function isOwnApiUrl(url) {
  try {
    const u = new URL(url, window.location.origin)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

if (typeof window !== 'undefined' && !window.__nvcApiAuthFetch) {
  window.__nvcApiAuthFetch = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null
    if (!url || !isOwnApiUrl(url)) return nativeFetch(input, init)
    const headers = new Headers(init.headers || {})
    if (!headers.has('Authorization')) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
    }
    return nativeFetch(input, { ...init, headers })
  }
}
