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

import { isReferencedReportPhoto } from './daily-report-payload'

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

// Before deleting a gallery (job_photos) item: may the storage object be deleted?
export async function canRemoveGalleryPhotoFile(db, { jobId, path }) {
  const used = await reportsReferencingPath(db, jobId, path)
  return { removeStorage: !used.referenced, reason: used.referenced ? (used.error ? 'could not check reports' : 'a daily report uses it') : null }
}
