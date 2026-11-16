// CompanyCam → portal job Photos (prompt 82). SERVER ONLY — never import from a page.
//
// CompanyCam facts this file relies on (researched 2026-11-16):
//   • Webhook signature: header X-CompanyCam-Signature =
//       Base64( HMAC-SHA1( key = the webhook token, data = the RAW request body ) )
//     SHA-1, base64 (not hex). Verify the raw bytes, never re-serialized JSON.
//     Sources: https://developers.companycam.com/openapi/public_api_v1.yaml (info.description
//     "Webhooks") and https://companycam.readme.io/docs/webhooks-1 ("Validating your payload").
//   • Delivery: CompanyCam expects exactly HTTP 200; anything else is retried with exponential
//     backoff (max 10 attempts) and a webhook whose error count passes 25 is disabled (reset by
//     each success). So only answer non-200 when a retry can actually help.
//     Body: { event_type: 'photo.created', created_at: <epoch s>, payload, webhook_id }.
//     Older docs: payload IS the photo; newer changelog examples nest it ({ payload: { photo } }).
//     Source: https://companycam.readme.io/docs/webhooks-1, https://developers.companycam.com/changelog.json
//   • API: Public API v1, base https://api.companycam.com/public_api/v1, Authorization: Bearer
//     <token>. Envelope { data, errors, meta }; cursor paging ?limit=1..100&after=<cursor>,
//     meta.next_cursor / meta.has_next. Source: https://developers.companycam.com/llms.txt + the
//     OpenAPI yaml above. POST /webhooks takes a CLIENT-SET token (without one deliveries are
//     unsigned), which is why the portal registers the webhook itself.
//
// Next.js 14.1 has no after(): the webhook does its work synchronously and every step here is
// idempotent (deterministic storage path, unique companycam_photo_id) so retries are safe.

import crypto from 'crypto'
import { getSiteUrl } from './site-url'
import { PHOTO_BUCKET, thumbPath } from './owner-photos'
import { insertJobPhotoWithFallbacks } from './photo-visibility'
import { isMissingColumnError } from './missing-column-retry'
import { logChange } from './change-log'

export const DEFAULT_CC_API_BASE = 'https://api.companycam.com/public_api/v1'
export const CC_API_BASE = process.env.COMPANYCAM_API_BASE || DEFAULT_CC_API_BASE
const apiBase = () => (process.env.COMPANYCAM_API_BASE || DEFAULT_CC_API_BASE).replace(/\/+$/, '')

export const companycamWebhookUrl = () => `${getSiteUrl()}/api/companycam/webhook`

export const MIGRATION_074_MESSAGE = 'CompanyCam photos need database migration 074 (CompanyCam columns + inbox). Ask Peyton to apply it — nothing was saved.'

export const MAX_WEBHOOK_BYTES = 1024 * 1024
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const CC_ID = /^\d{1,20}$/

// ── Signature ────────────────────────────────────────────────────────────────
// true only for an exact base64 HMAC-SHA1 of rawBuf with token. Never throws.
export function verifyCompanyCamSignature(rawBuf, header, token) {
  try {
    if (typeof token !== 'string' || !token.trim()) return false
    if (typeof header !== 'string' || !header.trim()) return false
    const body = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf ?? '')
    const expected = crypto.createHmac('sha1', token).update(body).digest('base64')
    const a = Buffer.from(header.trim(), 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── API client ───────────────────────────────────────────────────────────────
// → { ok, status, data, meta, error }. The token is never logged or returned.
// timeoutMs (optional) shortens the 15 s cap, e.g. when a cron run is near its own deadline.
export async function ccFetch(path, { method = 'GET', body, token, timeoutMs } = {}) {
  const key = token || process.env.COMPANYCAM_API_TOKEN
  if (!key || !String(key).trim()) return { ok: false, status: 503, data: null, meta: null, error: 'COMPANYCAM_API_TOKEN is not set' }
  let res
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${String(key).trim()}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutMs > 0 && timeoutMs < 15000 ? AbortSignal.timeout(Math.ceil(timeoutMs)) : AbortSignal.timeout(15000),
    })
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return { ok: false, status: 0, data: null, meta: null, error: timeout ? 'CompanyCam API timed out' : 'CompanyCam API unreachable' }
  }
  let json = null
  try { const text = await res.text(); json = text ? JSON.parse(text) : null } catch { json = null }
  const envelope = json && typeof json === 'object' && !Array.isArray(json) && ('data' in json || 'errors' in json || 'meta' in json)
  const data = envelope ? (json.data ?? null) : json
  const meta = envelope ? (json.meta ?? null) : null
  if (!res.ok) return { ok: false, status: res.status, data: null, meta: null, error: `CompanyCam API returned ${res.status}` }
  return { ok: true, status: res.status, data, meta, error: null }
}

// Retry can help: missing token (env fix), auth, rate limit, server error, network/timeout.
export const ccRetryable = status => status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status === 503 || status >= 500

// '12345' or https://app.companycam.com/projects/12345[/...] → '12345'; else null.
export function parseCcProjectId(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  if (CC_ID.test(s)) return s
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  if (host !== 'companycam.com' && !host.endsWith('.companycam.com')) return null
  const m = u.pathname.match(/\/projects\/(\d{1,20})(?:\/|$)/)
  return m ? m[1] : null
}

export const isCcId = v => CC_ID.test(String(v ?? ''))

// ── Normalize ────────────────────────────────────────────────────────────────
function toIso(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return null
    const d = new Date(n < 1e12 ? n * 1000 : n)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const pickUri = (uris, types) => {
  const list = Array.isArray(uris) ? uris.filter(u => u && (u.uri || u.url)) : []
  for (const t of types) {
    const hit = list.find(u => u.type === t)
    if (hit) return hit.uri || hit.url
  }
  return null
}

export function normalizeCcTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map(t => (typeof t === 'string' ? t : t?.display_value || t?.value || ''))
    .map(t => String(t).trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 20)
}

export function normalizeCcPhoto(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const desc = r.description
  let caption = desc && typeof desc === 'object' ? desc.plain_text_content : desc
  caption = typeof caption === 'string' ? caption.trim().slice(0, 500) : ''
  const uris = Array.isArray(r.uris) ? r.uris : []
  const firstUri = uris.find(u => u && (u.uri || u.url))
  const creator = typeof r.creator_name === 'string' ? r.creator_name.trim().slice(0, 120) : ''
  return {
    id: r.id != null ? String(r.id) : null,
    projectId: r.project_id != null && r.project_id !== '' ? String(r.project_id) : null,
    creatorName: creator || null,
    capturedAt: toIso(r.captured_at) || toIso(r.created_at) || new Date().toISOString(),
    caption: caption || null,
    tags: normalizeCcTags(r.tags),
    hasTags: Array.isArray(r.tags),
    originalUrl: pickUri(uris, ['original', 'web']) || (firstUri ? firstUri.uri || firstUri.url : null),
    thumbUrl: pickUri(uris, ['thumbnail', 'web']),
    photoUrl: typeof r.photo_url === 'string' ? r.photo_url : null,
  }
}

// ── Download (SSRF guard) ────────────────────────────────────────────────────
const CC_S3_HOST = /^companycam-[a-z0-9-]+\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/
export function isAllowedCcImageUrl(u) {
  try {
    const url = new URL(String(u))
    if (url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    if (host === 'companycam.com' || host.endsWith('.companycam.com')) return true
    // A photo that is still processing redirects from static.companycam.com to CompanyCam's own
    // S3 upload buckets (e.g. companycam-pending.s3.amazonaws.com). Exact bucket-host shape only.
    return CC_S3_HOST.test(host)
  } catch {
    return false
  }
}

const fail = (message, retryable) => Object.assign(new Error(message), { retryable })

export const DOWNLOAD_TIMEOUT_MS = 15000 // whole download: every hop + the body
export const MAX_IMAGE_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const isAbort = e => e?.name === 'TimeoutError' || e?.name === 'AbortError'

// → Buffer, or throws Error { retryable }.
// Redirects are followed by hand (redirect:'manual', at most 3 hops) so every hop — not just the
// last — is checked against the https + *.companycam.com (+ CompanyCam S3 bucket) allowlist
// before it is requested.
export async function downloadImage(url) {
  if (!isAllowedCcImageUrl(url)) throw fail('Image URL is not a CompanyCam https URL', false)
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  let current = String(url)
  let res
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(current, { redirect: 'manual', signal })
    } catch (e) {
      throw fail(isAbort(e) ? 'Image download timed out' : 'Image download failed', true)
    }
    if (res.type === 'opaqueredirect') throw fail('Image redirect could not be checked', false)
    if (!REDIRECT_STATUSES.has(res.status)) break
    const loc = res.headers.get('location')
    try { await res.body?.cancel() } catch {}
    if (!loc) throw fail('Image redirect has no Location', false)
    if (hop >= MAX_IMAGE_REDIRECTS) throw fail('Image URL redirected too many times', false)
    let next
    try { next = new URL(loc, current).toString() } catch { throw fail('Image redirect is not a valid URL', false) }
    if (!isAllowedCcImageUrl(next)) throw fail('Image URL redirected off CompanyCam', false)
    current = next
  }
  if (!res.ok) throw fail(`Image download returned ${res.status}`, res.status === 404 ? false : true)
  const type = String(res.headers.get('content-type') || '').toLowerCase()
  if (!type.startsWith('image/')) throw fail('Download is not an image', false)
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw fail('Image is larger than 50 MB', false)
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      const chunks = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_IMAGE_BYTES) { try { await reader.cancel() } catch {} ; throw fail('Image is larger than 50 MB', false) }
        chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_IMAGE_BYTES) throw fail('Image is larger than 50 MB', false)
    return buf
  } catch (e) {
    if (e && 'retryable' in e) throw e
    throw fail(isAbort(e) ? 'Image download timed out' : 'Image download failed', true)
  }
}

// ── Import one photo into a job gallery ──────────────────────────────────────
export const ccGalleryPath = (jobId, photoId) => `${jobId}/gallery/cc-${photoId}.jpg`

async function markInboxImported(db, photoId, { jobId, jobPhotoId, resolvedBy }) {
  try {
    const patch = { status: 'imported', job_id: jobId, job_photo_id: jobPhotoId || null, resolved_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }
    if (resolvedBy) patch.resolved_by = resolvedBy
    await db.from('companycam_photo_inbox').update(patch).eq('companycam_photo_id', photoId)
  } catch { /* ignore: the photo is in the gallery either way */ }
}

// A Storage upload that may not run past `ms` (null / 0 = no cap). The request itself is not
// aborted (storage-js upload takes no signal); the caller just stops waiting and treats it as a
// retryable failure. The object path is deterministic and uploads use upsert, so a late upload
// that lands anyway is simply overwritten by the retry.
async function uploadWithTimeout(bucket, path, body, opts, ms) {
  if (!(ms > 0)) return bucket.upload(path, body, opts)
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ data: null, error: { message: 'Storage upload timed out', timeout: true } }), ms) })
  try { return await Promise.race([bucket.upload(path, body, opts), timeout]) } finally { clearTimeout(timer) }
}

// photo = normalizeCcPhoto(...). → { status: 'imported'|'duplicate'|'failed', jobPhotoId?, error?, retryable?, migrationRequired? }
// downloadDeadline (epoch ms): no download is STARTED after it. The original was already
// started by the caller's own budget check; past the deadline the optional thumbnail is
// skipped (galleries fall back to the full image) so the function stays under maxDuration.
// uploadTimeoutMs (prompt 84, the cron): caps each Storage upload; with it set, the thumbnail
// upload is also skipped once past downloadDeadline. Unset (webhook / Owner Assign) = no cap.
export async function importCcPhotoToJob(db, { job, photo, resolvedBy = null, downloadDeadline = null, uploadTimeoutMs = null }) {
  const id = photo?.id
  if (!job?.id || !isCcId(id)) return { status: 'failed', error: 'Bad CompanyCam photo or job', retryable: false }

  const { data: existing, error: exErr } = await db.from('job_photos').select('id, companycam_photo_id').eq('companycam_photo_id', id).limit(1).maybeSingle()
  if (exErr) {
    if (isMissingColumnError(exErr)) return { status: 'failed', error: MIGRATION_074_MESSAGE, retryable: false, migrationRequired: '074' }
    return { status: 'failed', error: 'Could not check existing photos', retryable: true }
  }
  if (existing) {
    await markInboxImported(db, id, { jobId: job.id, jobPhotoId: existing.id, resolvedBy })
    return { status: 'duplicate', jobPhotoId: existing.id }
  }

  if (!photo.originalUrl) return { status: 'failed', error: 'CompanyCam photo has no image URL', retryable: false }
  if (!isAllowedCcImageUrl(photo.originalUrl)) return { status: 'failed', error: 'Image URL is not a CompanyCam https URL — not downloaded', retryable: false }

  let original
  try { original = await downloadImage(photo.originalUrl) } catch (e) { return { status: 'failed', error: e.message, retryable: !!e.retryable } }
  let thumb = null
  const pastDeadline = downloadDeadline != null && Date.now() > downloadDeadline
  if (!pastDeadline && photo.thumbUrl && photo.thumbUrl !== photo.originalUrl && isAllowedCcImageUrl(photo.thumbUrl)) {
    try { thumb = await downloadImage(photo.thumbUrl) } catch { thumb = null } // optional: galleries fall back to the full image
  }

  const path = ccGalleryPath(job.id, id)
  const tPath = thumbPath(path)
  const bucket = db.storage.from(PHOTO_BUCKET)
  const up = await uploadWithTimeout(bucket, path, original, { contentType: 'image/jpeg', upsert: true }, uploadTimeoutMs)
  if (up.error) return { status: 'failed', error: up.error.timeout ? 'Storage upload timed out' : 'Storage upload failed', retryable: true }
  const uploaded = [path]
  if (thumb && uploadTimeoutMs > 0 && downloadDeadline != null && Date.now() > downloadDeadline) thumb = null
  if (thumb) {
    const upT = await uploadWithTimeout(bucket, tPath, thumb, { contentType: 'image/jpeg', upsert: true }, uploadTimeoutMs)
    if (!upT.error) uploaded.push(tPath)
  }
  const removeObjects = async () => { try { await bucket.remove(uploaded) } catch {} }

  let inserted = null
  const res = await insertJobPhotoWithFallbacks(async extra => {
    const r = await db.from('job_photos').insert({
      job_id: job.id,
      super_id: null,
      storage_path: path,
      file_name: `companycam-${id}.jpg`,
      taken_at: photo.capturedAt,
      companycam_photo_id: id,
      companycam_creator_name: photo.creatorName || null,
      companycam_tags: photo.tags || [],
      ...extra,
    }).select('id').single()
    if (r?.data) inserted = r.data
    return r
  }, { caption: photo.caption || null, internal_only: true })

  if (res.migrationRequired) {
    await removeObjects()
    return { status: 'failed', error: MIGRATION_074_MESSAGE, retryable: false, migrationRequired: '074' }
  }
  if (res.error) {
    if (res.error.code === '23505') {
      // A parallel delivery won. Same deterministic path, so the object is theirs too — keep it.
      const { data: won } = await db.from('job_photos').select('id, companycam_photo_id').eq('companycam_photo_id', id).limit(1).maybeSingle()
      await markInboxImported(db, id, { jobId: job.id, jobPhotoId: won?.id, resolvedBy })
      return { status: 'duplicate', jobPhotoId: won?.id || null }
    }
    if (isMissingColumnError(res.error)) {
      await removeObjects()
      return { status: 'failed', error: MIGRATION_074_MESSAGE, retryable: false, migrationRequired: '074' }
    }
    return { status: 'failed', error: 'Could not save the photo row', retryable: true }
  }
  await markInboxImported(db, id, { jobId: job.id, jobPhotoId: inserted?.id, resolvedBy })
  return { status: 'imported', jobPhotoId: inserted?.id || null }
}

// ── Inbox ────────────────────────────────────────────────────────────────────
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
export function isMissingTableError(error) {
  if (!error) return false
  const msg = String(error.message || '')
  return MISSING_TABLE_CODES.has(error.code) || /Could not find the table|relation .+ does not exist|schema cache/i.test(msg)
}

// photo: normalized photo or { id, projectId }. Never moves an imported/dismissed row back.
export async function recordInbox(db, photo, { status = 'failed', error = null, projectName = null } = {}) {
  const id = photo?.id != null ? String(photo.id) : null
  if (!isCcId(id)) return { skipped: 'bad_id' }
  const fields = {}
  if (photo.projectId) fields.companycam_project_id = String(photo.projectId)
  if (projectName) fields.project_name = String(projectName).slice(0, 200)
  if (photo.creatorName) fields.creator_name = photo.creatorName
  if (photo.capturedAt) fields.captured_at = photo.capturedAt
  if (photo.caption) fields.caption = photo.caption
  if (photo.thumbUrl && isAllowedCcImageUrl(photo.thumbUrl)) fields.thumbnail_url = photo.thumbUrl
  const lastError = error ? String(error).slice(0, 500) : null
  try {
    const ins = await db.from('companycam_photo_inbox').insert({ companycam_photo_id: id, ...fields, status, last_error: lastError, attempts: 1 })
    if (!ins.error) return { ok: true, created: true }
    if (isMissingTableError(ins.error) || isMissingColumnError(ins.error)) return { skipped: '074' }
    if (ins.error.code !== '23505') return { error: ins.error.message }
    const { data: row, error: selErr } = await db.from('companycam_photo_inbox').select('id, status, attempts').eq('companycam_photo_id', id).maybeSingle()
    if (selErr || !row) return { error: selErr?.message || 'inbox row not found' }
    if (row.status === 'imported' || row.status === 'dismissed') return { ok: true, unchanged: row.status }
    const { error: upErr } = await db.from('companycam_photo_inbox')
      .update({ ...fields, status, last_error: lastError, attempts: (Number(row.attempts) || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).in('status', ['unmatched', 'failed'])
    return upErr ? { error: upErr.message } : { ok: true, updated: true }
  } catch (e) {
    return { error: e?.message || 'inbox write failed' }
  }
}

// ── Fetch + normalize one photo from the API (re-read; never trust webhook payload URIs) ──
// → { ok, photo } | { ok:false, status, error }
export async function fetchCcPhoto(photoId) {
  const r = await ccFetch(`/photos/${photoId}`)
  if (!r.ok) return { ok: false, status: r.status, error: r.error }
  const photo = normalizeCcPhoto(r.data)
  if (!photo.id) photo.id = String(photoId)
  if (!photo.hasTags) {
    const t = await ccFetch(`/photos/${photoId}/tags`)
    if (t.ok) photo.tags = normalizeCcTags(Array.isArray(t.data) ? t.data : [])
  }
  return { ok: true, photo }
}

export const JOB_CC_COLS = 'id, project_name, job_number, job_type, companycam_project_id'

// ── Webhook core ─────────────────────────────────────────────────────────────
// An inbox write that fails (anything but the 23505 duplicate, which recordInbox turns into an
// update, or the pre-074 skip) means the photo would be in neither the gallery nor the inbox:
// answer 503 so CompanyCam retries.
const INBOX_WRITE_FAILED = Object.freeze({ http: 503, status: 'failed', reason: 'inbox' })

// No new download starts after this much of the webhook's maxDuration (60 s) has gone.
export const DOWNLOAD_BUDGET_MS = 35000

// → { http: 200|503, status, reason? }
export async function processCcPhoto(db, photoId) {
  const downloadDeadline = Date.now() + DOWNLOAD_BUDGET_MS
  const id = String(photoId ?? '')
  if (!isCcId(id)) return { http: 200, status: 'ignored', reason: 'bad_id' }

  const { data: existing, error: exErr } = await db.from('job_photos').select('id, companycam_photo_id').eq('companycam_photo_id', id).limit(1).maybeSingle()
  if (exErr) {
    if (isMissingColumnError(exErr)) { console.warn('[companycam] migration 074 not applied — photo skipped'); return { http: 200, status: 'skipped', reason: 'migration_074' } }
    return { http: 503, status: 'failed', reason: 'db' }
  }
  if (existing) return { http: 200, status: 'duplicate' }

  const got = await fetchCcPhoto(id)
  if (!got.ok) {
    if (got.status === 404) {
      if ((await recordInbox(db, { id }, { status: 'failed', error: 'deleted in CompanyCam' })).error) return INBOX_WRITE_FAILED
      return { http: 200, status: 'failed', reason: 'deleted' }
    }
    if ((await recordInbox(db, { id }, { status: 'failed', error: got.error })).error) return INBOX_WRITE_FAILED
    if (got.status === 503 && /COMPANYCAM_API_TOKEN/.test(got.error || '')) return { http: 503, status: 'failed', reason: 'not_configured' }
    return ccRetryable(got.status) ? { http: 503, status: 'failed', reason: 'api' } : { http: 200, status: 'failed', reason: 'api' }
  }
  const photo = got.photo

  let job = null
  if (photo.projectId) {
    const { data, error } = await db.from('jobs').select(JOB_CC_COLS).eq('companycam_project_id', photo.projectId).maybeSingle()
    if (error) {
      if (isMissingColumnError(error)) { console.warn('[companycam] migration 074 not applied — photo skipped'); return { http: 200, status: 'skipped', reason: 'migration_074' } }
      return { http: 503, status: 'failed', reason: 'db' }
    }
    job = data
  }

  if (!job) {
    let projectName = null
    if (photo.projectId) {
      const p = await ccFetch(`/projects/${photo.projectId}`)
      if (p.ok && typeof p.data?.name === 'string') projectName = p.data.name
    }
    if ((await recordInbox(db, photo, { status: 'unmatched', projectName })).error) return INBOX_WRITE_FAILED
    return { http: 200, status: 'unmatched' }
  }

  const r = await importCcPhotoToJob(db, { job, photo, downloadDeadline })
  if (r.status === 'imported' || r.status === 'duplicate') return { http: 200, status: r.status }
  if ((await recordInbox(db, photo, { status: 'failed', error: r.error })).error) return INBOX_WRITE_FAILED
  return { http: r.retryable ? 503 : 200, status: 'failed', reason: r.migrationRequired ? `migration_${r.migrationRequired}` : 'import' }
}

// ── Tag sync (prompt 83) ─────────────────────────────────────────────────────
// A tag added to / removed from a CompanyCam photo after import (photo.tag_*, photo.updated).
// The event payload's tags are never trusted: the photo's current tags are re-read from
// GET /photos/{id}/tags. Only job_photos.companycam_tags is written. internal_only, caption,
// visibility and every other column are left alone. companycam_photo_inbox has no tags column
// (074), so the inbox is not touched. A photo that is not imported yet is skipped: its tags are
// read when it is imported or assigned.
// Known limitation: a tag change made while the photo is still being imported (photo.created is
// downloading, no job_photos row yet) returns 'not imported' here and can be missed until the
// next tag / photo.updated event re-syncs it. importCcPhotoToJob is deliberately not changed.
// Best-effort: every CompanyCam API failure (401/403/429/5xx/timeout/missing token) answers 200
// so photo.* volume can never push the shared webhook (which also carries photo.created) past
// CompanyCam's disable threshold; the next event re-syncs. 503 is kept only for database errors.
// → { http: 200|503, status, reason?, apiStatus? }
export async function syncCcPhotoTags(db, photoId) {
  const id = String(photoId ?? '')
  if (!isCcId(id)) return { http: 200, status: 'ignored', reason: 'bad_id' }

  const { data: row, error: selErr } = await db.from('job_photos').select('id, companycam_photo_id').eq('companycam_photo_id', id).limit(1).maybeSingle()
  if (selErr) {
    if (isMissingColumnError(selErr) || isMissingTableError(selErr)) { console.warn('[companycam] migration 074 not applied — tag sync skipped'); return { http: 200, status: 'skipped', reason: 'migration_074' } }
    return { http: 503, status: 'failed', reason: 'db' }
  }
  if (!row) return { http: 200, status: 'not imported' }

  const t = await ccFetch(`/photos/${id}/tags`)
  if (!t.ok) {
    if (t.status === 404) return { http: 200, status: 'photo gone' }
    console.warn(`[companycam] tag sync failed for photo ${id}: CompanyCam API status ${t.status}`)
    return { http: 200, status: 'failed', reason: 'api', apiStatus: t.status }
  }
  // An unexpected body shape must not wipe the saved tags.
  if (!Array.isArray(t.data)) return { http: 200, status: 'failed', reason: 'api_shape' }
  const tags = normalizeCcTags(t.data)

  const { error: upErr } = await db.from('job_photos').update({ companycam_tags: tags }).eq('companycam_photo_id', id)
  if (upErr) {
    if (isMissingColumnError(upErr) || isMissingTableError(upErr)) { console.warn('[companycam] migration 074 not applied — tag sync skipped'); return { http: 200, status: 'skipped', reason: 'migration_074' } }
    return { http: 503, status: 'failed', reason: 'db' }
  }
  return { http: 200, status: 'tags synced', count: tags.length }
}

// ── Route helpers ────────────────────────────────────────────────────────────
export const migration074Response = () => Response.json({ error: MIGRATION_074_MESSAGE, migration_required: '074' }, { status: 503 })
export const hasCcColumn = job => !!job && typeof job === 'object' && 'companycam_project_id' in job
export const jobLabel = j => [j?.project_name || j?.name, j?.job_number ? `#${j.job_number}` : null].filter(Boolean).join(' ') || 'another job'

// Set jobs.companycam_project_id (service role) + one Change History row.
// → { ok } | { response } (a ready error Response)
export async function setJobCcProject(db, { job, pid, project, userId }) {
  const old = job.companycam_project_id || null
  const patch = { companycam_project_id: pid || null }
  // A different project makes any saved import cursor meaningless.
  if ('companycam_import_state' in job) patch.companycam_import_state = null
  const { error } = await db.from('jobs').update(patch).eq('id', job.id)
  if (error) {
    if (error.code === '23505') return { response: Response.json({ error: 'That CompanyCam project is already linked to another job.' }, { status: 409 }) }
    if (isMissingColumnError(error)) return { response: migration074Response() }
    return { response: Response.json({ error: error.message || 'Could not save the link.' }, { status: 500 }) }
  }
  await logChange({
    job_id: job.id,
    entity_type: 'job',
    entity_id: job.id,
    field_name: 'companycam_project_id',
    old_value: old ? `${old}` : null,
    new_value: pid ? `${pid}${project?.name ? ` (${project.name})` : ''}` : null,
    changed_by: userId,
    note: pid ? 'CompanyCam project linked' : 'CompanyCam project unlinked',
  })
  return { ok: true }
}

// Response objects never carry secrets.
export function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(stripSecrets)
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'token' || k === 'authorization_header') continue
    out[k] = v && typeof v === 'object' ? stripSecrets(v) : v
  }
  return out
}
