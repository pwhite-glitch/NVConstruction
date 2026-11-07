// The one canonical base URL for links that leave the app: emailed portal links,
// signing links, customer-portal links, password-reset/invite redirectTo values
// and e-mail logo images. Safe in both browser and server code.
//
// Reads NEXT_PUBLIC_SITE_URL only (NEXT_PUBLIC_APP_URL is retired). Blank,
// missing or non-http(s) values fall back to the production portal, and trailing
// slashes are trimmed so a value like "https://x.com///" never yields "//submit".
// Never use window.location.origin for a link that is e-mailed: a preview or
// localhost origin would end up in somebody's inbox.

export const DEFAULT_SITE_URL = 'https://portal.nv.construction'

export function normalizeSiteUrl(raw) {
  const v = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : ''
  if (!/^https?:\/\/[^/\s]+/i.test(v)) return DEFAULT_SITE_URL
  return v
}

// The literal process.env.NEXT_PUBLIC_SITE_URL reference matters: Next inlines it
// into client bundles at build time.
export function getSiteUrl() {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)
}

// siteUrl('/submit') -> 'https://portal.nv.construction/submit'
export function siteUrl(path = '') {
  const p = String(path || '').replace(/^\/+/, '')
  return p ? `${getSiteUrl()}/${p}` : getSiteUrl()
}
