// Shared files between job_photos (gallery / CompanyCam) and daily_reports.photos (prompt 85).
//
// A report photo picked from the job's existing photos reuses that job_photos row's
// storage_path (attach BY REFERENCE — no copy). So:
//   • unlinking it from a report removes only the jsonb element — NEVER the storage object
//     and NEVER the job_photos row — when the element has job_photo_id / source:'job_photos'
//     OR a job_photos row exists with that storage_path;
//   • deleting a gallery item must not remove the storage object while any
//     daily_reports.photos[] element still points at the same path (the report keeps it).
// `db` is a Supabase client (service role in API routes, the browser client in the field app).

import { isReferencedReportPhoto, photoPathOk } from './daily-report-payload'

export const PHOTO_BUCKET = 'daily-report-photos'
// Is a daily_reports.photos[] element internal (hidden from the owner) RIGHT NOW? (prompt 85 M2)
//   • A picked job photo (job_photo_id / source:'job_photos') follows its job_photos row's CURRENT
//     internal_only — the flag copied onto the element at pick time is ignored, so showing /
//     hiding the photo in Site Photos takes effect on every report that uses it.
//     Matched by job_photo_id, else by storage_path. Fail safe: when the rows could not be
//     loaded (jobPhotos not an array) or no row is found, the photo counts as internal.
//   • A report-only upload keeps its own element flag (strict true).
export function reportPhotoInternal(element, jobPhotos) {
  if (!element || typeof element !== 'object') return true
  if (!isReferencedReportPhoto(element)) return element.internal_only === true
  if (!Array.isArray(jobPhotos)) return true
  const row = (element.job_photo_id && jobPhotos.find(r => r && r.id === element.job_photo_id))
    || jobPhotos.find(r => r && r.storage_path && r.storage_path === element.path)
  if (!row) return true
  return row.internal_only === true
}

export const thumbOf = path => (typeof path === 'string' && /\.jpg$/i.test(path) ? path.replace(/\.jpg$/i, '_thumb.jpg') : null)

// Does a job_photos row own this path? → { exists, error }
export async function jobPhotoExistsForPath(db, path, jobId) {
  let q = db.from('job_photos').select('id').eq('storage_path', path)
  if (jobId) q = q.eq('job_id', jobId)
  const { data, error } = await q.limit(1)
  if (error) return { exists: true, error } // fail safe: unknown → keep the file
  return { exists: Array.isArray(data) && data.length > 0, error: null }
}

// Is this path still attached to any daily report on the job (other than skipReportId)? → { referenced, error }
export async function reportsReferencingPath(db, jobId, path, { skipReportId } = {}) {
  const { data, error } = await db.from('daily_reports').select('id, photos').eq('job_id', jobId)
  if (error) return { referenced: true, error } // fail safe
  const hit = (data || []).some(r => r.id !== skipReportId && Array.isArray(r.photos) && r.photos.some(p => p && p.path === path))
  return { referenced: hit, error: null }
}

// After a report element was removed: may the storage object be deleted? Only when the
// element was not a reference, no job_photos row owns the path, and no other report uses it.
// → { removeStorage: boolean, reason }
export async function canRemoveReportPhotoFile(db, { jobId, reportId, element, path }) {
  if (isReferencedReportPhoto(element)) return { removeStorage: false, reason: 'job_photos reference' }
  const owned = await jobPhotoExistsForPath(db, path, jobId)
  if (owned.exists) return { removeStorage: false, reason: owned.error ? 'could not check job_photos' : 'job_photos row exists' }
  const used = await reportsReferencingPath(db, jobId, path, { skipReportId: reportId })
  if (used.referenced) return { removeStorage: false, reason: used.error ? 'could not check reports' : 'another report uses it' }
  return { removeStorage: true, reason: null }
}

// After a daily report row was DELETED (prompt 91): remove the storage objects of photos that
// were uploaded directly to that report — best effort, never throws. Same rule as unlinking one
// photo in /api/delete-photo (canRemoveReportPhotoFile): never a picked job photo (job_photo_id /
// source:'job_photos'), never a path a job_photos row owns, never a path another report still
// lists, and never a path outside the job's folder. job_photos rows are never touched.
// → { removed: [paths], kept: [paths], errors: [messages] }
export async function removeReportOnlyPhotoFiles(db, report) {
  const out = { removed: [], kept: [], errors: [] }
  const photos = Array.isArray(report?.photos) ? report.photos : []
  const seen = new Set()
  for (const element of photos) {
    const path = element?.path
    if (typeof path !== 'string' || !path || seen.has(path)) continue
    seen.add(path)
    try {
      if (!photoPathOk(report.job_id, path)) { out.kept.push(path); continue }
      const { removeStorage } = await canRemoveReportPhotoFile(db, { jobId: report.job_id, reportId: report.id, element, path })
      if (!removeStorage) { out.kept.push(path); continue }
      const { error } = await db.storage.from(PHOTO_BUCKET).remove([path, thumbOf(path)].filter(Boolean))
      if (error) { out.errors.push(`${path}: ${error.message || error}`); continue }
      out.removed.push(path)
    } catch (e) {
      out.errors.push(`${path}: ${e?.message || e}`)
    }
  }
  return out
}

// Before deleting a gallery (job_photos) item: may the storage object be deleted?
export async function canRemoveGalleryPhotoFile(db, { jobId, path }) {
  const used = await reportsReferencingPath(db, jobId, path)
  return { removeStorage: !used.referenced, reason: used.referenced ? (used.error ? 'could not check reports' : 'a daily report uses it') : null }
}
