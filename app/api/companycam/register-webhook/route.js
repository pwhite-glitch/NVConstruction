import { requireAuth } from '../../../../lib/server-auth'
import { isPrincipal } from '../../../../lib/roles'
import { ccFetch, companycamWebhookUrl, stripSecrets } from '../../../../lib/companycam'

// Owner-only: (re)create the one CompanyCam photo webhook (photo.*) pointing at this portal,
// with the signing token from COMPANYCAM_WEBHOOK_TOKEN (Vercel env only). CompanyCam's
// connector create_webhook cannot set a token, so registration happens here. Existing
// webhooks for our URL are deleted and re-POSTed (PATCH can't set a token).
// → { ok, action: 'created'|'recreated', webhook_id, url, scopes, requested_scopes, scopes_fallback, enabled, deleted: [ids] }.
// The token is never returned, logged, or stored in the database.
export const dynamic = 'force-dynamic'

// Prompt 83: photo.* also delivers tag changes (photo.tag_added, …) so tags edited after import
// keep syncing. If CompanyCam refuses the wildcard (400/422) the route retries once with the
// explicit list. `scopes` in the response is what CompanyCam reports it registered;
// `requested_scopes` is the list we sent.
const SCOPES = ['photo.*']
const FALLBACK_SCOPES = ['photo.created', 'photo.tag_added', 'photo.updated']

// scopes = what CompanyCam says it registered (its POST response), falling back to the list we
// sent only when the response has no scopes array. requested_scopes = the list we sent.
const webhookOut = (w, scopes) => {
  const s = stripSecrets(w || {})
  return {
    webhook_id: s.id != null ? String(s.id) : null,
    url: s.url || null,
    scopes: Array.isArray(s.scopes) ? s.scopes : scopes,
    requested_scopes: scopes,
    enabled: s.enabled !== false,
  }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Owners only' }, { status: 403 })

  const apiToken = process.env.COMPANYCAM_API_TOKEN
  const hookToken = process.env.COMPANYCAM_WEBHOOK_TOKEN
  const missing = [
    !(apiToken && apiToken.trim()) && 'COMPANYCAM_API_TOKEN',
    !(hookToken && hookToken.trim()) && 'COMPANYCAM_WEBHOOK_TOKEN',
  ].filter(Boolean)
  if (missing.length) return Response.json({ error: `Missing environment variable(s): ${missing.join(', ')}` }, { status: 503 })

  const url = companycamWebhookUrl()
  const list = await ccFetch('/webhooks?limit=100')
  if (!list.ok) return Response.json({ error: `Could not list CompanyCam webhooks: ${list.error}` }, { status: 502 })
  const matches = (Array.isArray(list.data) ? list.data : []).filter(w => w && w.url === url)

  // PATCH /webhooks/{id} has no `token` field (only POST takes one), so an existing webhook for
  // our URL can't be given our signing token. Delete every one of them, then POST a fresh one.
  // Never PATCH. If a delete fails, stop: claiming success would leave unsigned deliveries.
  const deleted = []
  for (const w of matches) {
    const id = String(w.id)
    const del = await ccFetch(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!del.ok) {
      console.warn(`[companycam] webhook delete failed id=${id} status=${del.status}`)
      return Response.json({ error: `Could not delete existing CompanyCam webhook ${id} (${del.error}). Nothing was re-registered.`, deleted }, { status: 502 })
    }
    deleted.push(id)
  }
  const action = matches.length ? 'recreated' : 'created'

  const create = scopes => ccFetch('/webhooks', { method: 'POST', body: { webhook: { url, scopes, token: hookToken.trim() } } })
  let scopes = SCOPES
  let res = await create(scopes)
  const scopesFallback = !res.ok && (res.status === 422 || res.status === 400)
  if (scopesFallback) {
    console.info(`[companycam] webhook scopes ${SCOPES.join(',')} refused (${res.status}); retrying with ${FALLBACK_SCOPES.join(',')}`)
    scopes = FALLBACK_SCOPES
    res = await create(scopes)
  }
  if (!res.ok) {
    const lost = deleted.length ? ` The old webhook(s) ${deleted.join(', ')} were already deleted — run Register again.` : ''
    return Response.json({ error: `CompanyCam refused the webhook create: ${res.error}.${lost}`, deleted }, { status: 502 })
  }

  const out = webhookOut(res.data, scopes)
  console.info(`[companycam] webhook ${action} id=${out.webhook_id} scopes=${out.scopes.join(',')} requested=${scopes.join(',')} deleted=${deleted.length}`)
  return Response.json({ ok: true, action, ...out, url: out.url || url, scopes_fallback: scopesFallback, deleted })
}
