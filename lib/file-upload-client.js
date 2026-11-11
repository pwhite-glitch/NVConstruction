// Browser side of the direct-upload protocol (prompt 78).
//   1. POST /api/file-upload { target, <context ids>, file_name, content_type, size }
//        → { bucket, path, signedUrl, uploadReceipt, expires_at }   (our API: fetchFn = authFetch)
//   2. PUT the original File/Blob straight to signedUrl            (Storage: putFn = plain fetch,
//        never our Authorization header)
//   3. the caller sends attachment { path, uploadReceipt } to the business route.
// File bytes never go to our API, so Vercel's 4.5 MB request cap no longer applies.
// No server-only imports here (no crypto, no service client).
import { readJsonResponse, rawResponseError, jsonInit, NETWORK_MESSAGE } from './fetch-json'

export const UPLOAD_ENDPOINT = '/api/file-upload'
const REUSE_MARGIN_MS = 10 * 60 * 1000

// Shared signed PUT (also used by lib/job-doc-client.js). Storage may answer 200 with an
// empty or non-JSON body: only the HTTP status decides success.
export async function putToSignedUrl(putFn, signedUrl, file, contentType) {
  let res
  try {
    res = await putFn(signedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': contentType || file?.type || 'application/octet-stream' },
    })
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'Upload cancelled.' : `Upload failed: ${NETWORK_MESSAGE}` }
  }
  const error = await rawResponseError(res, 'Upload')
  return error ? { ok: false, status: res.status, error } : { ok: true, status: res.status }
}

export function uploadContentType(file) {
  const t = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : ''
  return /^[\w.+-]+\/[\w.+-]+$/.test(t) ? t : 'application/octet-stream'
}

// Ask our API for a signed upload URL. Returns { ok, upload, error, status, data }.
export async function requestUpload(fetchFn, { target, file, context = {}, endpoint = UPLOAD_ENDPOINT }) {
  if (!file) return { ok: false, error: 'No file selected.' }
  const body = { ...context, target, file_name: String(file.name || 'file'), content_type: uploadContentType(file), size: Number(file.size) }
  let res
  try {
    res = await fetchFn(endpoint, jsonInit('POST', body))
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === 'AbortError' ? 'Upload cancelled.' : NETWORK_MESSAGE }
  }
  const r = await readJsonResponse(res)
  if (!r.ok) return { ok: false, status: r.status, data: r.data, error: r.error }
  const up = r.data || {}
  if (typeof up.signedUrl !== 'string' || typeof up.path !== 'string' || typeof up.uploadReceipt !== 'string') {
    return { ok: false, status: r.status, error: 'The server did not return an upload link.' }
  }
  return { ok: true, status: r.status, upload: up }
}

// Upload one file for a target. Returns { ok, attachment: { path, uploadReceipt }, expiresAt }
// or { ok: false, stage: 'url' | 'put', error }.
export async function uploadForTarget({ fetchFn, putFn, target, file, context = {}, endpoint = UPLOAD_ENDPOINT }) {
  const req = await requestUpload(fetchFn, { target, file, context, endpoint })
  if (!req.ok) return { ok: false, stage: 'url', status: req.status, error: req.error }
  const put = await putToSignedUrl(putFn, req.upload.signedUrl, file, uploadContentType(file))
  if (!put.ok) return { ok: false, stage: 'put', status: put.status, error: put.error }
  return {
    ok: true,
    attachment: { path: req.upload.path, uploadReceipt: req.upload.uploadReceipt },
    expiresAt: Number(req.upload.expires_at) || null,
  }
}

// Per-file cache of a finished upload, so a retry / duplicate-confirm resend reuses the
// uploaded object instead of uploading again. Keyed by the File object itself plus the
// target and context; dropped near receipt expiry or when the server rejects the receipt.
const uploaded = new WeakMap()
const cacheKey = (target, context) => `${target}|${JSON.stringify(Object.keys(context || {}).sort().map(k => [k, context[k]]))}`

export async function uploadFileOnce(opts, now = Date.now) {
  const { file, target, context } = opts
  const key = cacheKey(target, context)
  const byKey = file && typeof file === 'object' ? uploaded.get(file) : null
  const hit = byKey?.get(key)
  if (hit && (!hit.expiresAt || hit.expiresAt - now() > REUSE_MARGIN_MS)) return { ok: true, attachment: hit.attachment, expiresAt: hit.expiresAt, reused: true }
  const r = await uploadForTarget(opts)
  if (r.ok && file && typeof file === 'object') {
    const m = byKey || new Map()
    m.set(key, { attachment: r.attachment, expiresAt: r.expiresAt })
    uploaded.set(file, m)
  }
  return r
}

export function forgetUpload(file) {
  if (file && typeof file === 'object') uploaded.delete(file)
}

// The server refused an upload receipt (expired / does not match): the next attempt must upload again.
export function isUploadReceiptError(result) {
  return typeof result?.data?.code === 'string' && result.data.code.startsWith('upload_')
}

// Upload `file` (when there is one) for `target`, then call send(attachment | undefined), which
// returns a lib/fetch-json result. Returns that result plus stage: 'upload' (nothing was
// saved) or 'save'. A successful upload is cached per file, so a retry or a duplicate-confirm
// resend reuses it; a receipt the server refuses is dropped so the next try uploads again.
// Callers only treat result.ok as saved — on failure the form and file stay as they were.
export async function uploadThenSend({ fetchFn, putFn, file, target, context = {}, send }) {
  let attachment
  if (file) {
    const up = await uploadFileOnce({ fetchFn, putFn, target, file, context })
    if (!up.ok) return { ok: false, stage: 'upload', status: up.status || 0, data: null, error: up.error }
    attachment = up.attachment
  }
  let r
  try {
    r = await send(attachment)
  } catch (e) {
    r = { ok: false, status: 0, data: null, error: e?.message || NETWORK_MESSAGE }
  }
  if (!r.ok && file && isUploadReceiptError(r)) forgetUpload(file)
  return { ...r, stage: 'save' }
}

// Upload several files (in order) for one target. Returns { ok, attachments } or the first failure.
export async function uploadAll({ fetchFn, putFn, files, target, context = {} }) {
  const attachments = []
  for (const file of files || []) {
    if (!file) continue
    const up = await uploadFileOnce({ fetchFn, putFn, target, file, context })
    if (!up.ok) return { ok: false, error: `${file.name || 'File'}: ${up.error}` }
    attachments.push(up.attachment)
  }
  return { ok: true, attachments }
}
