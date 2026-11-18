// Server side of the daily report PDF export / email (prompt 92). Pass the service-role client
// as `db`. Every report is loaded and access-checked here before anything else is read:
//   role: Owner (principal) / admin / PM / APM only (canExportReports) — supers 403;
//   job:  denyUnlessOnJob for every distinct job (principal / admin any job; PM / APM only a
//         job they are on);
//   status: drafts are refused (400 DRAFT_EXPORT_MESSAGE) when asked for by id, and simply
//         not included in a date range.
// Photos are downloaded with the service role only after those checks, internal_only photos
// are never downloaded, and the caps in lib/daily-report-export.js apply.

import { isDraftReport, isFinalReport } from './daily-report-payload'
import { loadReport } from './daily-report-server'
import { denyUnlessOnJob } from './roles'
import { reportPhotoInternal, PHOTO_BUCKET } from './report-photo-links'
import { fetchJobPhotosByPaths, mergeJobPhotoRows } from './job-photo-pages'
import { logChange } from './change-log'
import {
  canExportReports, EXPORT_ROLE_MESSAGE, DRAFT_EXPORT_MESSAGE, MAX_EXPORT_REPORTS, validateRange, isValidDate,
  PHOTO_MAX_BYTES, PHOTOS_PER_REPORT, PHOTOS_PER_PDF, PHOTO_TOTAL_BYTES, PHOTO_DOWNLOAD_CONCURRENCY,
  isValidRecipient, latestSends, SENT_FIELD,
} from './daily-report-export'

const fail = (status, error) => ({ response: Response.json({ error }, { status }) })
const str = v => (typeof v === 'string' ? v.trim() : '')

// The date range asked for, if any. `to` is the recipient list in email mode, so a range there
// comes as range: { from, to } or from + to_date.
export function requestedRange(body) {
  if (!body || typeof body !== 'object') return null
  if (body.range && typeof body.range === 'object') return { from: body.range.from, to: body.range.to }
  if (body.from == null && body.to_date == null && !(typeof body.to === 'string' && isValidDate(body.to))) return null
  return { from: body.from, to: body.to_date ?? (typeof body.to === 'string' && isValidDate(body.to) ? body.to : undefined) }
}

// → { reports, job, range? } | { response }
export async function resolveExportReports(db, auth, body) {
  if (!canExportReports(auth?.role)) return fail(403, EXPORT_ROLE_MESSAGE)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid request.')

  let reports = []
  let jobId = null
  let range = null

  if (body.report_ids != null) {
    if (!Array.isArray(body.report_ids) || !body.report_ids.length) return fail(400, 'Pick at least one daily report.')
    const ids = [...new Set(body.report_ids.map(str))]
    if (ids.some(id => !id)) return fail(400, 'Report id is required.')
    if (ids.length > MAX_EXPORT_REPORTS) return fail(400, `Export ${MAX_EXPORT_REPORTS} reports or fewer at a time.`)
    for (const id of ids) {
      const { report, response } = await loadReport(db, id)
      if (response) return { response }
      reports.push(report)
    }
    // Job access for EVERY report (each distinct job), before anything about the reports is said.
    for (const jid of new Set(reports.map(r => r.job_id))) {
      const denied = await denyUnlessOnJob(db, auth, jid)
      if (denied) return { response: denied }
    }
    const jobs = new Set(reports.map(r => r.job_id))
    if (jobs.size > 1) return fail(400, 'All reports in one PDF must be on the same project.')
    jobId = reports[0].job_id
    if (body.job_id != null && str(body.job_id) !== String(jobId)) return fail(400, 'These reports belong to a different project.')
    if (reports.some(isDraftReport)) return fail(400, DRAFT_EXPORT_MESSAGE)
  } else {
    jobId = str(body.job_id)
    if (!jobId) return fail(400, 'Pick reports to export, or a project and a date range.')
    const asked = requestedRange(body) || {}
    const v = validateRange(asked.from, asked.to)
    if (!v.ok) return fail(400, v.error)
    range = { from: v.from, to: v.to }
    const denied = await denyUnlessOnJob(db, auth, jobId)
    if (denied) return { response: denied }
    const { data, error } = await db.from('daily_reports').select('*').eq('job_id', jobId)
      .gte('report_date', range.from).lte('report_date', range.to).order('report_date', { ascending: true })
    if (error) return fail(500, `Could not load daily reports: ${error.message}`)
    reports = (data || []).filter(isFinalReport)
    if (!reports.length) return fail(404, 'No final daily reports in that date range.')
    if (reports.length > MAX_EXPORT_REPORTS) return fail(400, `That range has ${reports.length} reports; export ${MAX_EXPORT_REPORTS} or fewer at a time.`)
  }

  const { data: job, error: jobErr } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (jobErr) return fail(500, jobErr.message)
  if (!job) return fail(404, 'Job not found.')

  // Author names (profiles.full_name); missing names print as blank.
  const authorIds = [...new Set(reports.map(r => r.super_id).filter(Boolean))]
  const names = {}
  if (authorIds.length) {
    const { data: people } = await db.from('profiles').select('id, full_name').in('id', authorIds)
    for (const p of people || []) if (p?.id) names[p.id] = typeof p.full_name === 'string' ? p.full_name.trim() : ''
  }
  reports = reports
    .map(r => ({ ...r, job, author_name: names[r.super_id] || '' }))
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  return { reports, job, range }
}

const UNSUPPORTED_EXT = /\.(heic|heif|webp|gif|tiff?|bmp|avif|mov|mp4|pdf)$/i
const centralTime = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''
}
const sniffOk = b => !!b && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47))

// Run fn over items with at most `limit` in flight; results keep the input order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return out
}

// → { photoData: { [reportId]: { images: [{ bytes, caption, time }], notes } }, excludedInternal }
export async function collectReportPhotos(db, job, reports, { concurrency = PHOTO_DOWNLOAD_CONCURRENCY } = {}) {
  const photoData = {}
  const all = reports.map(r => ({ r, els: (Array.isArray(r.photos) ? r.photos : []).filter(p => p && typeof p === 'object' && typeof p.path === 'string' && p.path) }))

  // job_photos rows behind picked photos (their CURRENT internal_only wins — prompt 85 M2).
  // If they can't be read, picked photos count as internal (fail safe: left out).
  const refEls = all.flatMap(x => x.els).filter(p => p.source === 'job_photos' || p.job_photo_id)
  let jobPhotos = []
  if (refEls.length) {
    const ids = [...new Set(refEls.map(p => p.job_photo_id).filter(Boolean))]
    const byId = ids.length ? await db.from('job_photos').select('*').eq('job_id', job.id).in('id', ids) : { data: [], error: null }
    const byPath = await fetchJobPhotosByPaths(db, job.id, refEls.map(p => p.path))
    jobPhotos = byId.error || byPath.error ? undefined : mergeJobPhotoRows(byId.data, byPath.data)
  }
  const rowFor = el => (Array.isArray(jobPhotos) ? (el.job_photo_id && jobPhotos.find(j => j.id === el.job_photo_id)) || jobPhotos.find(j => j.storage_path === el.path) : null) || null

  let excludedInternal = 0
  let budgetLeft = PHOTOS_PER_PDF
  const jobs = []
  for (const { r, els } of all) {
    const notes = { unsupported: 0, tooLarge: 0, overLimit: 0, failed: 0 }
    photoData[r.id] = { images: [], notes }
    const visible = els.filter(el => {
      if (reportPhotoInternal(el, jobPhotos)) { excludedInternal++; return false }
      return true
    })
    visible.forEach((el, i) => {
      if (i >= PHOTOS_PER_REPORT || budgetLeft <= 0) { notes.overLimit++; return }
      if (!el.path.startsWith(`${r.job_id}/`) || el.path.includes('..')) { notes.failed++; return }
      if (UNSUPPORTED_EXT.test(el.path)) { notes.unsupported++; return }
      budgetLeft--
      const row = rowFor(el)
      jobs.push({
        reportId: r.id, order: i, path: el.path,
        caption: str(el.caption) || str(row?.caption) || str(row?.description),
        time: centralTime(row?.taken_at || el.taken_at),
      })
    })
  }

  let bytesLeft = PHOTO_TOTAL_BYTES
  const bucket = db.storage.from(PHOTO_BUCKET)
  const results = await mapLimit(jobs, concurrency, async j => {
    try {
      if (typeof bucket.info === 'function') {
        const info = await bucket.info(j.path).catch(() => null)
        const size = Number(info?.data?.size)
        if (Number.isFinite(size) && size > PHOTO_MAX_BYTES) return { j, skip: 'tooLarge' }
      }
      const { data, error } = await bucket.download(j.path)
      if (error || !data) return { j, skip: 'failed' }
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (bytes.length > PHOTO_MAX_BYTES) return { j, skip: 'tooLarge' }
      if (!sniffOk(bytes)) return { j, skip: 'unsupported' }
      if (bytes.length > bytesLeft) return { j, skip: 'overLimit' }
      bytesLeft -= bytes.length
      return { j, bytes }
    } catch {
      return { j, skip: 'failed' }
    }
  })
  for (const { j, bytes, skip } of results) {
    const d = photoData[j.reportId]
    if (skip) { d.notes[skip]++; continue }
    d.images.push({ bytes, caption: j.caption, time: j.time, order: j.order })
  }
  for (const d of Object.values(photoData)) d.images.sort((a, b) => a.order - b.order)
  return { photoData, excludedInternal }
}

// Save the FIRST recipient as jobs.owner_email — only when the job has none (never overwrite;
// the update is conditional so a concurrent save is not clobbered). Logged to change_log.
// → { saved: boolean, email? }
export async function saveOwnerEmailIfEmpty(db, job, email, userId) {
  if (!job || str(job.owner_email)) return { saved: false }
  const e = str(email)
  if (!isValidRecipient(e)) return { saved: false }
  let q = db.from('jobs').update({ owner_email: e }).eq('id', job.id)
  q = job.owner_email == null ? q.is('owner_email', null) : q.eq('owner_email', job.owner_email)
  const { data, error } = await q.select('id')
  if (error || !Array.isArray(data) || !data.length) return { saved: false }
  await logChange({
    job_id: job.id, entity_type: 'job', entity_id: job.id, field_name: 'owner_email',
    old_value: job.owner_email || null, new_value: e, changed_by: userId,
    note: 'Owner email saved from the first recipient of an emailed daily report PDF',
  })
  return { saved: true, email: e }
}

// One change_log entry per report emailed (or attempted). → number written
export async function logReportSends(reports, { to, result, error, subject, range, userId }) {
  let n = 0
  const list = to.join(', ')
  for (const r of reports) {
    const value = { to, result, subject, reports: reports.length, ...(range ? { range } : {}), ...(error ? { error: String(error).slice(0, 300) } : {}) }
    const note = result === 'sent'
      ? `Emailed PDF to ${list}`
      : `Email of PDF to ${list} failed: ${String(error || 'unknown error')}`
    const res = await logChange({
      job_id: r.job_id, entity_type: 'daily_report', entity_id: r.id, field_name: SENT_FIELD,
      old_value: null, new_value: JSON.stringify(value), changed_by: userId, note: note.slice(0, 500),
    })
    if (!res || res.ok !== false) n++
  }
  return n
}

// Latest successful send per report on a job. → { sends, error? }
export async function loadLatestSends(db, jobId) {
  const { data, error } = await db.from('change_log').select('entity_id, field_name, new_value, created_at, changed_by_name')
    .eq('job_id', jobId).eq('entity_type', 'daily_report').eq('field_name', SENT_FIELD)
    .order('created_at', { ascending: false }).limit(1000)
  if (error) return { sends: {}, error }
  return { sends: latestSends(data || []) }
}
