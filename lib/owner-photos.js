// Owner portal Photos: the same sources the commercial / residential job pages use —
// job_photos rows (field gallery) plus daily_reports.photos — all stored in the
// private daily-report-photos bucket. Pure helpers; the route loads and signs.

import { photoDateCentral } from './photo-taken-at'
import { isInternalPhoto } from './photo-visibility'

export const PHOTO_BUCKET = 'daily-report-photos'
export const thumbPath = p => (p && /\.jpg$/i.test(p) ? p.replace(/\.jpg$/i, '_thumb.jpg') : null)
export const isThumb = p => /_thumb\.jpe?g$/i.test(String(p || ''))

// [{ path, caption, tag, date, name, source }] newest first, one per path, no _thumb files,
// only paths under this job's folder. Internal-only photos (job_photos.internal_only or
// daily_reports.photos[].internal_only === true) are dropped — and a path marked internal
// in either source is dropped everywhere. The owner payload carries no internal flag.
export function ownerPhotoList({ jobId, jobPhotos = [], reports = [] }) {
  const reportPhotos = reports.flatMap(r => (Array.isArray(r?.photos) ? r.photos : []))
  const internalPaths = new Set([
    ...jobPhotos.filter(isInternalPhoto).map(p => p.storage_path),
    ...reportPhotos.filter(isInternalPhoto).map(p => p.path),
  ].filter(Boolean))
  const all = [
    ...jobPhotos.map(p => ({ path: p.storage_path, caption: p.caption || null, tag: p.tag || null, date: photoDateCentral(p.taken_at || p.created_at), name: p.file_name || null, source: 'gallery' })),
    ...reports.flatMap(r => (Array.isArray(r.photos) ? r.photos : []).map(p => ({ path: p?.path, caption: p?.caption || null, tag: p?.tag || null, date: r.report_date || null, name: p?.name || null, source: 'daily_report' }))),
  ]
  const seen = new Set()
  return all
    .filter(p => typeof p.path === 'string' && p.path && !isThumb(p.path) && p.path.startsWith(`${jobId}/`) && !p.path.includes('..'))
    .filter(p => !internalPaths.has(p.path))
    .filter(p => (seen.has(p.path) ? false : (seen.add(p.path), true)))
    // date desc, then path asc — deterministic so owner paging never skips / repeats within a date
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.path).localeCompare(String(b.path)))
}

// Attach signed URLs from a createSignedUrls batch to the list. Per-object results
// can fail (error set / signedUrl missing) even when the batch call succeeds:
//  • a missing thumbnail is fine — thumb_url falls back to the full image;
//  • a full-size image that did not sign (or is absent from the batch) is a failure.
// Returns { photos } or { error, failed: [path] }.
export function signOwnerPhotos(list = [], signed) {
  if (!Array.isArray(signed)) return { error: "Couldn't sign photo links.", failed: list.map(p => p.path) }
  const urls = Object.fromEntries(signed.filter(s => s && s.path && s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]))
  const failed = list.filter(p => !urls[p.path]).map(p => p.path)
  if (failed.length) return { error: `Couldn't load ${failed.length} photo${failed.length !== 1 ? 's' : ''}.`, failed }
  return { photos: list.map(p => ({ ...p, url: urls[p.path], thumb_url: urls[thumbPath(p.path)] || urls[p.path] })) }
}
