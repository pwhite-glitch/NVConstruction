// SignWell e-signature API client (prompt 98). SERVER ONLY: reads SIGNWELL_API_KEY.
// Never import this from a page or client component.
//
// API reference used (offline copy): portal-fixes/signwell-api-notes.md + signwell-openapi.json.
//   Base https://www.signwell.com/api/v1, header X-Api-Key.
//   POST   /documents                      create (+ send unless draft)       201
//   POST   /documents/{id}/send            send a draft                       200
//   GET    /documents/{id}                 document (status, metadata, …)     200
//   GET    /documents/{id}/completed_pdf   signed PDF (+ audit page)          200 binary
//   POST   /documents/{id}/remind          remind unsigned recipients         201
//   DELETE /documents/{id}                 delete + cancel signing            204
//
// The API key is never logged, returned or put in an error message. test_mode is ON unless
// SIGNWELL_TEST_MODE is exactly 'false' (test documents are free and not legally binding).

import crypto from 'crypto'

export const SIGNWELL_BASE = 'https://www.signwell.com/api/v1'

export const isSignwellEnabled = (env = process.env) => !!(env && env.SIGNWELL_API_KEY)
export const isSignwellTestMode = (env = process.env) => !(env && env.SIGNWELL_TEST_MODE === 'false')

export class SignwellError extends Error {
  constructor(message, status = 0, code = 'signwell_error') {
    super(message)
    this.name = 'SignwellError'
    this.status = status
    this.code = code
  }
}

// Remove the key from any text that could reach a log or a response.
function scrub(text, key) {
  let s = String(text ?? '')
  if (key && key.length >= 4) s = s.split(key).join('[redacted]')
  return s.slice(0, 500)
}

function errorFromBody(status, body, key) {
  if (status === 429) {
    const detail = body && typeof body.error === 'string' ? ` (${scrub(body.error, key)})` : ''
    return new SignwellError(`SignWell rate limit reached${detail}. Wait a minute and try again.`, 429, 'rate_limited')
  }
  if (status === 401) return new SignwellError('SignWell rejected the API key (401). Check SIGNWELL_API_KEY in the server settings.', 401, 'unauthorized')
  if (status === 404) return new SignwellError('SignWell document not found (404).', 404, 'not_found')
  let detail = ''
  if (body && typeof body === 'object') {
    const msgs = Array.isArray(body.meta?.messages) ? body.meta.messages.filter(m => typeof m === 'string') : []
    detail = msgs.length ? msgs.join('; ') : (typeof body.meta?.message === 'string' ? body.meta.message : typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : '')
  }
  return new SignwellError(`SignWell request failed (${status})${detail ? ': ' + scrub(detail, key) : ''}`, status, 'request_failed')
}

/**
 * One API call. Options: { body, query, binary, env, fetchFn }.
 * Returns parsed JSON (or null for 204), or a Uint8Array when binary. Throws SignwellError.
 */
export async function signwellRequest(method, path, { body, query, binary = false, env = process.env, fetchFn } = {}) {
  const key = env?.SIGNWELL_API_KEY
  if (!key) throw new SignwellError('SignWell is not configured (SIGNWELL_API_KEY is not set).', 0, 'not_configured')
  const doFetch = fetchFn || globalThis.fetch
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : ''
  const headers = { 'X-Api-Key': key, Accept: binary ? 'application/pdf' : 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await doFetch(`${SIGNWELL_BASE}${path}${qs}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: 'no-store' })
  } catch (e) {
    throw new SignwellError(`Could not reach SignWell: ${scrub(e?.message || 'network error', key)}`, 0, 'network')
  }
  if (!res.ok) {
    let parsed = null
    try { parsed = JSON.parse(await res.text()) } catch { parsed = null }
    throw errorFromBody(res.status, parsed, key)
  }
  if (res.status === 204) return null
  if (binary) return new Uint8Array(await res.arrayBuffer())
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { throw new SignwellError('SignWell returned an unreadable response.', res.status, 'bad_response') }
}

const docPath = id => {
  const s = String(id || '')
  if (!/^[A-Za-z0-9-]{1,100}$/.test(s)) throw new SignwellError('Invalid SignWell document id.', 400, 'bad_id')
  return `/documents/${encodeURIComponent(s)}`
}

const toB64 = bytes => Buffer.from(bytes instanceof Uint8Array ? bytes : typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).toString('base64')

/**
 * Create a document and send it (draft: false) in one request.
 *   files: [{ name, bytes }]  (bytes: Uint8Array | Buffer | string) → files[].file_base64
 *   recipients: [{ id, name, email }] in signing order
 *   metadata: { subcontract_id, job_id }
 *   textTags: true → text_tags; false → with_signature_page (no field placement needed)
 */
export async function createDocument({ name, subject, message, files, recipients, metadata = {}, textTags = true, draft = false, requesterName = 'NV Construction' } = {}, opts = {}) {
  if (!Array.isArray(files) || !files.length) throw new SignwellError('createDocument: files required', 400, 'bad_request')
  if (!Array.isArray(recipients) || !recipients.length) throw new SignwellError('createDocument: recipients required', 400, 'bad_request')
  const body = {
    test_mode: isSignwellTestMode(opts.env),
    name: name || 'Subcontract',
    ...(subject ? { subject: String(subject).slice(0, 255) } : {}),
    ...(message ? { message: String(message).slice(0, 4000) } : {}),
    files: files.map(f => ({ name: f.name, file_base64: toB64(f.bytes) })),
    recipients: recipients.map((r, i) => ({ id: String(r.id || i + 1), name: r.name, email: r.email })),
    apply_signing_order: true,
    reminders: true,
    draft: !!draft,
    embedded_signing: false,
    text_tags: !!textTags,
    ...(textTags ? {} : { with_signature_page: true }),
    metadata: Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [k, v == null ? '' : String(v)])),
    ...(requesterName ? { custom_requester_name: requesterName } : {}),
  }
  return signwellRequest('POST', '/documents', { ...opts, body })
}

// Send a draft. test_mode does not carry over from the draft, so it is passed again.
export const sendDocument = (id, opts = {}) => signwellRequest('POST', `${docPath(id)}/send`, { ...opts, body: { test_mode: isSignwellTestMode(opts.env) } })
export const getDocument = (id, opts = {}) => signwellRequest('GET', docPath(id), opts)
// One PDF: the signed document with SignWell's audit page appended.
export const getCompletedPdf = (id, opts = {}) => signwellRequest('GET', `${docPath(id)}/completed_pdf`, { ...opts, binary: true, query: { audit_page: true, url_only: false } })
export const remind = (id, opts = {}) => signwellRequest('POST', `${docPath(id)}/remind`, { ...opts, body: {} })
export const deleteDocument = (id, opts = {}) => signwellRequest('DELETE', docPath(id), opts)

// Status helpers live in a client-safe module (the job page uses them too).
export { mapSignwellStatus, SIGNWELL_OPEN_STATUSES, isSignwellOpen, signwellStatusLabel } from './signwell-status'

// ── Webhook ──────────────────────────────────────────────────────────────────
// HMAC-SHA256(key = webhook id, data = `${type}@${time}`), lowercase hex, compared in
// constant time with event.hash. The hash does not cover the body: callers re-fetch the doc.
export function signwellEventHash(type, time, webhookId) {
  return crypto.createHmac('sha256', String(webhookId)).update(`${type}@${time}`).digest('hex')
}

export function verifySignwellEvent(event, webhookId) {
  if (!webhookId || !event || typeof event !== 'object') return false
  const { type, time, hash } = event
  if (typeof type !== 'string' || !type || (typeof time !== 'number' && typeof time !== 'string') || String(time) === '' || typeof hash !== 'string') return false
  if (!/^[0-9a-f]{64}$/.test(hash)) return false
  const expected = Buffer.from(signwellEventHash(type, time, webhookId), 'utf8')
  const given = Buffer.from(hash, 'utf8')
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}
