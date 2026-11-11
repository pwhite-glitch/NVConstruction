// Server side of the direct-upload protocol (prompt 78). SERVER ONLY (node crypto).
//
// Browsers (and bots) upload file bytes straight to Supabase Storage with a signed upload
// URL; our API only ever sees small JSON: the issuance request, then a path plus a signed
// upload receipt on the business route. This module owns:
//   - the target allowlist (target → fixed bucket + server-built path layout),
//   - issuance (createSignedUploadUrl(path, { upsert: false }) + receipt),
//   - the receipt (stateless HMAC-SHA256 over the exact claims, timingSafeEqual on verify),
//   - final verification (receipt ↔ caller ↔ target ↔ bucket ↔ context ↔ exact path, then the
//     object must exist in Storage with the declared size),
//   - request guards (multipart refused early, inline/base64 file content refused).
// Authorization is NOT here: every caller runs its own target guards first (lib/upload-guards.js
// and the business routes). A valid receipt never replaces those checks.
import { createHmac, timingSafeEqual, randomUUID } from 'crypto'
import { safeFileName } from './storage-path'

export const RECEIPT_VERSION = 1
export const RECEIPT_TTL_MS = 2 * 60 * 60 * 1000 // == Supabase signed upload URL lifetime (2h)
const DOMAIN = 'nvc:prompt78:upload-receipt:v1'
const KEY_LABEL = 'nvc:prompt78:upload-receipt:key:v1'

export const MAX_NAME_LEN = 255
export const MAX_CT_LEN = 127
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const UUID_SEG = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SAFE_NAME = '[\\w.\\-]{1,120}' // lib/storage-path.js safeFileName output

export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
export const privateJson = (body, status = 200) => Response.json(body, { status, headers: PRIVATE_HEADERS })

export const DIRECT_UPLOAD_MESSAGE = 'Files are no longer sent through this request. Upload the file directly (the app does this automatically — refresh the page and try again).'

// ── Targets ───────────────────────────────────────────────────────────────────
// ctx keys (all always present, null when unused): job, rec, order, vehicle, cat, user.
// rec null = a create (no row yet); otherwise the existing row the file will attach to.
const jobFile = (ctx, uuid, name) => `${ctx.job}/${uuid}_${name}`
const jobFileRe = ctx => new RegExp(`^${esc(ctx.job)}/${UUID_SEG}_(?:${SAFE_NAME})$`)

export const UPLOAD_TARGETS = {
  'direct-cost-receipt': { bucket: 'receipts', build: jobFile, re: jobFileRe },
  'dc-resubmit-receipt': { bucket: 'receipts', build: jobFile, re: jobFileRe },
  'gc-doc':              { bucket: 'receipts', build: jobFile, re: jobFileRe },
  'submittal-doc':       { bucket: 'submittal-docs', build: jobFile, re: jobFileRe },
  'po-attachment':       { bucket: 'purchase-order-docs', build: jobFile, re: jobFileRe },
  'billing-doc':         { bucket: 'billing-docs', build: jobFile, re: jobFileRe },
  'vehicle-photo': {
    bucket: 'vehicle-photos',
    build: (ctx, uuid, name) => `${ctx.vehicle}/${uuid}_${name}`,
    re: ctx => new RegExp(`^${esc(ctx.vehicle)}/${UUID_SEG}_(?:${SAFE_NAME})$`),
  },
  'sales-doc': {
    bucket: 'sales-docs',
    build: (ctx, uuid, name) => `${ctx.order}/${uuid}_${name}`,
    re: ctx => new RegExp(`^${esc(ctx.order)}/${UUID_SEG}_(?:${SAFE_NAME})$`),
  },
  'parse-estimate': {
    bucket: 'estimate-docs',
    build: (ctx, uuid, name) => `parse/${ctx.user}/${uuid}_${name}`,
    re: ctx => new RegExp(`^parse/${esc(ctx.user)}/${UUID_SEG}_(?:${SAFE_NAME})$`),
  },
  'generated-contract': {
    bucket: 'documents',
    // Same folder + "generated-<time>" prefix as lib/generated-contract.js generatedContractPath
    // (readers sort by name), plus a random suffix so two saves never collide.
    build: (ctx, uuid, _name, now) => `subcontracts/${ctx.rec}/generated-${new Date(now).toISOString().replace(/[:.]/g, '-')}-${uuid}.html`,
    re: ctx => new RegExp(`^subcontracts/${esc(ctx.rec)}/generated-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-${UUID_SEG}\\.html$`),
    contentTypes: ['text/html'],
  },
  'signing-html': {
    bucket: 'documents',
    build: (ctx, uuid) => `signing-drafts/${ctx.job}/${ctx.user}/${uuid}.html`,
    re: ctx => new RegExp(`^signing-drafts/${esc(ctx.job)}/${esc(ctx.user)}/${UUID_SEG}\\.html$`),
    contentTypes: ['text/html'],
  },
  'bot-attachment': {
    bucket: 'job-documents',
    // Same "<job>/<category>/<time>-<name>" layout as the legacy bot upload, plus a random id.
    build: (ctx, uuid, name, now) => `${ctx.job}/${ctx.cat}/${now}-${uuid}-${name}`,
    re: ctx => new RegExp(`^${esc(ctx.job)}/${esc(ctx.cat)}/\\d{10,16}-${UUID_SEG}-(?:${SAFE_NAME})$`),
  },
}

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const CTX_KEYS = ['job', 'rec', 'order', 'vehicle', 'cat', 'user']
const normId = v => (v === null || v === undefined || v === '' ? null : String(v).toLowerCase())

// Canonical context: every key present, ids lower-cased (UUIDs compare consistently).
export function makeContext(partial = {}) {
  const out = {}
  for (const k of CTX_KEYS) out[k] = k === 'cat' ? (partial.cat == null ? null : String(partial.cat)) : normId(partial[k])
  return out
}

const ctxValid = ctx => CTX_KEYS.every(k => ctx[k] === null || (typeof ctx[k] === 'string' && (k === 'cat' ? /^[a-z_]{1,40}$/.test(ctx[k]) : ID_RE.test(ctx[k]))))
const sameCtx = (a, b) => CTX_KEYS.every(k => (a?.[k] ?? null) === (b?.[k] ?? null))

// ── Receipt ───────────────────────────────────────────────────────────────────
function receiptKey() {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('Direct uploads are not configured on the server.')
  // Derived, domain-separated key: the service-role value itself never signs anything.
  return createHmac('sha256', base).update(KEY_LABEL).digest()
}
const b64u = buf => Buffer.from(buf).toString('base64url')
const mac = payload => createHmac('sha256', receiptKey()).update(`${DOMAIN}.${payload}`).digest()

export function signReceipt(claims) {
  const payload = b64u(JSON.stringify(claims))
  return `v${RECEIPT_VERSION}.${payload}.${b64u(mac(payload))}`
}

const isPosInt = n => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

// { claims } or { error, code }. Checks structure, signature (constant time), expiry, values.
export function verifyReceipt(token, now = Date.now()) {
  const bad = (error = 'The upload receipt is not valid. Upload the file again.', code = 'upload_invalid') => ({ error, code })
  if (typeof token !== 'string' || token.length > 4096) return bad()
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== `v${RECEIPT_VERSION}` || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return bad()
  let expected
  try { expected = mac(parts[1]) } catch (e) { return bad(e.message, 'upload_unavailable') }
  const given = Buffer.from(parts[2], 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return bad()
  let c
  try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch { return bad() }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return bad()
  const keys = Object.keys(c).sort().join(',')
  if (keys !== 'b,ct,ctx,exp,iat,kid,n,p,sub,sz,t,v') return bad()
  if (c.v !== RECEIPT_VERSION || typeof c.t !== 'string' || !UPLOAD_TARGETS[c.t] || c.b !== UPLOAD_TARGETS[c.t].bucket) return bad()
  if (typeof c.sub !== 'string' || !ID_RE.test(c.sub) || (c.kid !== null && (typeof c.kid !== 'string' || !ID_RE.test(c.kid)))) return bad()
  if (typeof c.p !== 'string' || objectPathError(c.p) || typeof c.n !== 'string' || !c.n || c.n.length > MAX_NAME_LEN || typeof c.ct !== 'string' || c.ct.length > MAX_CT_LEN) return bad()
  if (!isPosInt(c.sz) || !isPosInt(c.iat) || !isPosInt(c.exp) || c.exp <= c.iat || c.exp - c.iat > RECEIPT_TTL_MS) return bad()
  if (!c.ctx || typeof c.ctx !== 'object' || Array.isArray(c.ctx) || Object.keys(c.ctx).sort().join(',') !== [...CTX_KEYS].sort().join(',') || !ctxValid(c.ctx)) return bad()
  if (c.iat > now + 5 * 60 * 1000) return bad()
  if (now > c.exp) return bad('The upload expired before it was saved. Choose the file and save again.', 'upload_expired')
  return { claims: c }
}

// ── Paths ─────────────────────────────────────────────────────────────────────
// Why a storage object path is unacceptable, or null. Never normalizes: an odd path is refused,
// not rewritten into a different (maybe permitted) object.
export function objectPathError(path) {
  if (typeof path !== 'string' || !path) return 'File path is required.'
  if (path.length > 1024) return 'File path is too long.'
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'File path has control characters.'
  if (path.includes('\\')) return 'File path has a backslash.'
  if (path.includes('%')) return 'File path has encoded characters.'
  if (/[?#]/.test(path)) return 'File path has a query or fragment.'
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.includes('//')) return 'File path must not be a URL.'
  if (path.startsWith('/')) return 'File path must be relative.'
  if (path.split('/').some(s => s === '' || s === '.' || s === '..')) return 'File path has an empty or dot segment.'
  return null
}

// ── Issuance ──────────────────────────────────────────────────────────────────
const CT_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/

// Validates { target, file_name, content_type, size } from an issuance body. Client-supplied
// bucket / url / path / role / created_by are refused, never used.
export function validateIssueRequest(body, { allowedTargets = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send a JSON object.' }
  for (const k of ['bucket', 'url', 'signedUrl', 'path', 'storage_path', 'role', 'created_by', 'uploadReceipt']) {
    if (k in body) return { error: `"${k}" cannot be chosen by the client.` }
  }
  const target = body.target
  if (typeof target !== 'string' || !UPLOAD_TARGETS[target] || (allowedTargets && !allowedTargets.includes(target))) return { error: 'Unknown upload target.' }
  const name = body.file_name
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LEN || /[\u0000-\u001f\u007f]/.test(name)) return { error: 'A file name (up to 255 characters) is required.' }
  let ct = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : ''
  if (!ct) ct = 'application/octet-stream'
  if (ct.length > MAX_CT_LEN || !CT_RE.test(ct)) return { error: 'Invalid content type.' }
  const allowedCts = UPLOAD_TARGETS[target].contentTypes
  if (allowedCts && !allowedCts.includes(ct)) return { error: `This upload must be ${allowedCts.join(' or ')}.` }
  const size = body.size
  if (!isPosInt(size)) return { error: 'File size must be a positive whole number of bytes (empty files cannot be uploaded).' }
  return { meta: { target, fileName: name.trim(), contentType: ct, size } }
}

// Sign an upload URL for a server-built path and mint its receipt. `storage` is the client
// that signs (service role after the caller's guards; the bot's own RLS client for bots).
// Returns { status, body } — body is { bucket, path, signedUrl, uploadReceipt, expires_at } on 200.
export async function issueUpload(storage, { meta, subject, keyId = null, ctx, now = Date.now(), uuid = randomUUID }) {
  const t = UPLOAD_TARGETS[meta.target]
  const context = makeContext(ctx)
  if (!t || !ctxValid(context)) return { status: 400, body: { error: 'Invalid upload context.' } }
  if (typeof subject !== 'string' || !ID_RE.test(subject)) return { status: 401, body: { error: 'Unauthorized' } }
  const path = t.build(context, uuid().toLowerCase(), safeFileName(meta.fileName), now)
  if (objectPathError(path) || !t.re(context).test(path)) return { status: 400, body: { error: 'Could not build a safe file path.' } }
  let uploadReceipt
  try {
    uploadReceipt = signReceipt({ v: RECEIPT_VERSION, sub: subject, kid: keyId ? String(keyId) : null, t: meta.target, b: t.bucket, p: path, ctx: context, n: meta.fileName, ct: meta.contentType, sz: meta.size, iat: now, exp: now + RECEIPT_TTL_MS })
  } catch (e) {
    return { status: 503, body: { error: e.message } }
  }
  const { data, error } = await storage.storage.from(t.bucket).createSignedUploadUrl(path, { upsert: false })
  if (error || !data?.signedUrl) return { status: 500, body: { error: 'Could not create an upload link: ' + (error?.message || 'no link returned') } }
  const body = { bucket: t.bucket, path, signedUrl: data.signedUrl, uploadReceipt, expires_at: now + RECEIPT_TTL_MS }
  if (data.token) body.token = data.token
  return { status: 200, body }
}

// ── Final verification ────────────────────────────────────────────────────────
const fail = (error, code = 'upload_invalid', status = 422) => ({ ok: false, status, code, error })
const normCt = v => String(v || '').split(';')[0].trim().toLowerCase()

// Is `value` an attachment descriptor { path, uploadReceipt } (exactly those keys)?
export function isAttachmentShape(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'path,uploadReceipt' &&
    typeof value.path === 'string' && typeof value.uploadReceipt === 'string'
}

// Verify a NEW attachment for a final record request. `info` is the storage client used to
// confirm the object (service role, or the bot's client). Returns
// { ok: true, path, fileName, contentType, size } or { ok: false, status, code, error }.
export async function verifyAttachment(info, attachment, { target, subject, keyId = null, ctx, now = Date.now() }) {
  if (!isAttachmentShape(attachment)) return fail('Attachment must be { path, uploadReceipt } from a direct upload.')
  const pathErr = objectPathError(attachment.path)
  if (pathErr) return fail(pathErr)
  const v = verifyReceipt(attachment.uploadReceipt, now)
  if (v.error) return fail(v.error, v.code, v.code === 'upload_unavailable' ? 503 : 422)
  const c = v.claims
  const t = UPLOAD_TARGETS[target]
  const expected = makeContext(ctx)
  if (!t || c.t !== target || c.b !== t.bucket) return fail('That upload was made for a different kind of file.')
  if (c.sub !== String(subject || '') || (c.kid || null) !== (keyId ? String(keyId) : null)) return fail('That upload was made by a different user.')
  if (!sameCtx(c.ctx, expected)) return fail('That upload was made for a different record or job.')
  if (c.p !== attachment.path) return fail('The file path does not match its upload receipt.')
  if (!t.re(expected).test(attachment.path)) return fail('The file path is not in the expected folder.')

  let meta
  try {
    // `info` is a storage client, or (bot) a function (bucket, path) → { data, error } that runs
    // only now, after the receipt, caller and context checks above passed.
    const { data, error } = typeof info === 'function'
      ? await info(t.bucket, attachment.path)
      : await info.storage.from(t.bucket).info(attachment.path)
    if (error || !data) return fail('The uploaded file was not found in storage. Upload it again.', 'upload_missing')
    meta = data
  } catch {
    return fail('Could not check the uploaded file. Try again.', 'upload_missing', 502)
  }
  const size = Number(meta.size ?? meta.metadata?.size ?? meta.metadata?.contentLength)
  if (!Number.isSafeInteger(size) || size <= 0) return fail('The uploaded file is empty or could not be measured.', 'upload_missing')
  if (size !== c.sz) return fail('The uploaded file does not match what was declared. Upload it again.', 'upload_mismatch')
  const actualCt = normCt(meta.contentType ?? meta.metadata?.mimetype ?? meta.metadata?.contentType)
  if (actualCt && normCt(c.ct) !== actualCt) return fail('The uploaded file type does not match what was declared. Upload it again.', 'upload_mismatch')
  return { ok: true, path: attachment.path, fileName: c.n, contentType: actualCt || c.ct, size }
}

// Response for a failed verifyAttachment (keeps the code so the client knows to re-upload).
export const attachmentErrorResponse = v => Response.json({ error: v.error, code: v.code }, { status: v.status || 422 })

// ── Reading a stored object's first bytes ─────────────────────────────────────
// First bytes of a stored object, read server → Storage with a bounded Range request on a
// short-lived server-signed URL (never sent to the browser, never logged). Reads at most
// `max` bytes even when Storage ignores Range (then the rest of the stream is cancelled).
export async function readObjectHead(db, bucket, path, max = 1024, fetchFn = fetch) {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return { error: 'Could not read the uploaded file.' }
  let res
  try {
    res = await fetchFn(data.signedUrl, { headers: { Range: `bytes=0-${max - 1}` }, cache: 'no-store' })
  } catch {
    return { error: 'Could not read the uploaded file.' }
  }
  if (res.status !== 206 && res.status !== 200) {
    try { await res.body?.cancel?.() } catch { /* ignore */ }
    return { error: 'Could not read the uploaded file.' }
  }
  const out = new Uint8Array(max)
  let n = 0
  const reader = res.body?.getReader?.()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    const take = buf.subarray(0, max)
    out.set(take); n = take.length
  } else {
    try {
      while (n < max) {
        const { done, value } = await reader.read()
        if (done) break
        const take = value.subarray(0, max - n)
        out.set(take, n); n += take.length
      }
    } finally {
      try { await reader.cancel() } catch { /* ignore */ }
    }
  }
  return { head: out.subarray(0, n), ranged: res.status === 206 }
}

// ── Request guards ────────────────────────────────────────────────────────────
export function isMultipart(request) {
  return /multipart\/form-data/i.test(request.headers.get('content-type') || '')
}

// Browser recording endpoints: refuse multipart BEFORE request.formData() reads anything.
export function rejectMultipart(request) {
  if (!isMultipart(request)) return null
  return Response.json({ error: DIRECT_UPLOAD_MESSAGE, code: 'direct_upload_required' }, { status: 413 })
}

const FILE_KEYS = new Set(['file', 'files', 'newFile', 'new_file', 'file_data', 'fileData', 'file_base64', 'base64', 'data_url', 'dataUrl', 'blob', 'bytes', 'content_base64'])
const DATA_URL = /^\s*data:[^,]{0,200}base64,/i

// Inline file content in a JSON body (file keys, data: URLs, long base64 strings) → message,
// else null. Checks the top level of an object or each object in an array. `except` lists keys
// whose small inline value is allowed by that route (none by default).
export function inlineFileContentError(body, { except = [] } = {}) {
  const rows = Array.isArray(body) ? body : [body]
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    for (const [k, v] of Object.entries(r)) {
      if (except.includes(k)) continue
      if (FILE_KEYS.has(k) && v != null && v !== '') return `"${k}" cannot carry file content. Upload the file directly.`
      if (typeof v === 'string' && (DATA_URL.test(v) || (v.length > 4096 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v)))) return `"${k}" looks like inline file content. Upload the file directly.`
    }
  }
  return null
}

// Pull a NEW attachment descriptor out of a body without letting proof keys reach a DB row.
// Returns { attachment, rest } (attachment undefined when the key is absent).
export function takeAttachment(body, key = 'attachment') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { attachment: undefined, rest: body }
  const { [key]: attachment, uploadReceipt: _r, ...rest } = body
  return { attachment, rest }
}
