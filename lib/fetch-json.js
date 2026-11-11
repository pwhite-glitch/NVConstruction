// Safe reader for our own JSON API responses (prompt 78, part C).
// Browser + server safe: no imports, no globals patched.
//
// readJsonResponse(res) always resolves to { ok, status, data, error }:
//   - status and Content-Type are checked FIRST; the body is read exactly once (text()),
//     and parsed only for application/json or a +json media type.
//   - JSON error bodies (400/401/403/409/413…) are still parsed so structured fields such as
//     needs_confirm / duplicate survive in `data`.
//   - ok is true only for a 2xx JSON response whose payload has no `error`. A non-2xx is never
//     ok, even if its body says ok:true. A non-JSON / empty / malformed 2xx is a failure too.
//   - error is a short human message: the server's own `error` string when there is one,
//     otherwise a status-based message. Never a SyntaxError / "Unexpected token", never a
//     giant HTML or proxy body, never a URL.
// fetchJson(fetchFn, url, init) wraps a fetch (network rejection / abort included).

export const TOO_LARGE_MESSAGE = 'That file was too large to send. Please try again using direct upload.'
export const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
export const ABORTED_MESSAGE = 'The request was cancelled.'

const MAX_PLAIN_TEXT = 200

// application/json, application/problem+json, APPLICATION/JSON; charset=utf-8 …
export function isJsonContentType(ct) {
  const mt = String(ct || '').split(';')[0].trim().toLowerCase()
  if (!mt) return false
  if (mt === 'application/json') return true
  return /^[a-z0-9!#$&^_.-]+\/[a-z0-9!#$&^_.-]+\+json$/.test(mt)
}

// Short, single-line plain text with no markup and no URLs, or null.
function safePlainText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > MAX_PLAIN_TEXT) return null
  if (/[<>]/.test(t) || /https?:\/\//i.test(t) || /token=|signature=|bearer /i.test(t)) return null
  return t
}

function statusMessage(status) {
  if (status === 413) return TOO_LARGE_MESSAGE
  if (status === 401) return 'Your session has expired. Sign in again and retry.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'Not found.'
  if (status === 408 || status === 504) return `The server took too long to respond (${status}). Please try again.`
  if (status >= 500) return `The server had a problem (${status}). Please try again.`
  if (status >= 200 && status < 300) return `The server sent an unexpected response (${status}).`
  return `Request failed (${status}).`
}

function errorText(v) {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 1000)
  if (v && typeof v === 'object' && typeof v.message === 'string' && v.message.trim()) return v.message.trim().slice(0, 1000)
  return null
}

function cancelBody(res) {
  try { res?.body?.cancel?.() } catch { /* ignore */ }
}

export async function readJsonResponse(res) {
  if (!res || typeof res.status !== 'number') return { ok: false, status: 0, data: null, error: NETWORK_MESSAGE }
  const status = res.status
  const httpOk = status >= 200 && status < 300
  const ct = res.headers?.get?.('content-type') || ''

  if (status === 204 || status === 205) {
    cancelBody(res)
    return { ok: httpOk, status, data: null, error: httpOk ? null : statusMessage(status) }
  }

  if (!isJsonContentType(ct)) {
    // Only short text/plain is ever shown (e.g. "Request Entity Too Large"); HTML and other
    // bodies are not read at all.
    let plain = null
    if (/^text\/plain\b/i.test(ct.trim()) && status !== 413) {
      try { plain = safePlainText(await res.text()) } catch { plain = null }
    } else {
      cancelBody(res)
    }
    const msg = httpOk ? statusMessage(status) : (plain && !httpOk ? `${plain} (${status})` : statusMessage(status))
    return { ok: false, status, data: null, error: msg }
  }

  let text
  try {
    text = await res.text()
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, status, data: null, error: aborted ? ABORTED_MESSAGE : (status === 413 ? TOO_LARGE_MESSAGE : `Could not read the server response (${status}).`) }
  }
  if (!text || !text.trim()) {
    return { ok: false, status, data: null, error: httpOk ? `The server sent an empty response (${status}).` : statusMessage(status) }
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, status, data: null, error: httpOk ? `The server sent an unreadable response (${status}).` : statusMessage(status) }
  }
  const payloadError = data && typeof data === 'object' && !Array.isArray(data) ? errorText(data.error) : null
  if (httpOk && !payloadError) return { ok: true, status, data, error: null }
  return { ok: false, status, data, error: payloadError || statusMessage(status) }
}

// fetch + readJsonResponse. fetchFn is injected (authFetch for our API).
export async function fetchJson(fetchFn, url, init) {
  let res
  try {
    res = await fetchFn(url, init)
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e?.name === 'AbortError' ? ABORTED_MESSAGE : NETWORK_MESSAGE }
  }
  return readJsonResponse(res)
}

// JSON POST/PUT/PATCH/DELETE helper.
export function jsonInit(method, body, extra = {}) {
  return { ...extra, method, headers: { 'Content-Type': 'application/json', ...(extra.headers || {}) }, body: JSON.stringify(body) }
}

// For a raw (non-JSON) response such as a Storage PUT or a signed file download: an error
// message from its status (and a JSON error body when it has one), or null when ok.
export async function rawResponseError(res, what = 'Request') {
  if (!res || typeof res.status !== 'number') return `${what} failed: ${NETWORK_MESSAGE}`
  if (res.ok) return null
  const ct = res.headers?.get?.('content-type') || ''
  let detail = null
  if (isJsonContentType(ct)) {
    try {
      const d = JSON.parse(await res.text())
      detail = safePlainText(errorText(d?.message) || errorText(d?.error))
    } catch { detail = null }
  } else {
    cancelBody(res)
  }
  if (res.status === 413) return `${what} failed: the file is larger than storage allows${detail ? ` (${detail})` : ''}.`
  return `${what} failed (${res.status})${detail ? `: ${detail}` : ''}.`
}
