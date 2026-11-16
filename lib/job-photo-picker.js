// Daily report photo picker (prompt 85): choose existing job photos (job_photos rows —
// CompanyCam imports and gallery uploads) and attach them to a report BY REFERENCE.
// Pure helpers; the API route loads, filters, pages and signs.

import { photoDateCentral } from './photo-taken-at'

export const PICKER_PAGE_SIZE = 40
export const PICKER_PAGE_MAX = 100
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isThumbPath = p => /_thumb\.jpe?g$/i.test(String(p || ''))

// → { jobId, date, all, source: 'all' | 'companycam', limit, offset }
export function parsePickerParams(params) {
  const get = k => (params && typeof params.get === 'function' ? params.get(k) : params?.[k])
  const date = String(get('date') || '').trim()
  const all = ['1', 'true', 'yes'].includes(String(get('all') || '').toLowerCase()) || !DATE_RE.test(date)
  const source = String(get('source') || '').toLowerCase() === 'companycam' ? 'companycam' : 'all'
  const rawLimit = parseInt(get('limit'), 10)
  const rawOffset = parseInt(get('offset'), 10)
  return {
    jobId: String(get('job_id') || '').trim(),
    date: DATE_RE.test(date) ? date : null,
    all,
    source,
    limit: Number.isFinite(rawLimit) ? Math.min(PICKER_PAGE_MAX, Math.max(1, rawLimit)) : PICKER_PAGE_SIZE,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  }
}

const when = r => r?.taken_at || r?.created_at || null

// job_photos rows → picker items, newest first (taken_at, else created_at), filtered to this
// job's folder, no thumbnails. date (Central, YYYY-MM-DD) filters unless `all`. internal_only
// photos are INCLUDED (this is a staff picker) and flagged.
export function pickerList(rows = [], { jobId, date = null, all = true, source = 'all' } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && typeof r.storage_path === 'string' && r.storage_path.startsWith(`${jobId}/`) && !r.storage_path.includes('..') && !isThumbPath(r.storage_path))
    .filter(r => source !== 'companycam' || (r.companycam_photo_id != null && r.companycam_photo_id !== ''))
    .filter(r => all || !date || photoDateCentral(when(r)) === date)
    .map(r => ({
      id: r.id,
      path: r.storage_path,
      name: r.file_name || null,
      caption: r.caption || '',
      taken_at: when(r),
      date: photoDateCentral(when(r)),
      internal_only: r.internal_only === true,
      companycam: r.companycam_photo_id != null && r.companycam_photo_id !== '',
      creator: r.companycam_creator_name || null,
      tags: Array.isArray(r.companycam_tags) ? r.companycam_tags.filter(t => typeof t === 'string' && t) : [],
    }))
    .sort((a, b) => String(b.taken_at || '').localeCompare(String(a.taken_at || '')) || String(a.path).localeCompare(String(b.path)))
}

// The jsonb element a picked photo becomes on daily_reports.photos (reference, not a copy).
// internal_only is inherited from the job_photos row — never flipped to owner-visible.
export function referenceElement(item) {
  return {
    path: item.path,
    name: item.name || item.path.split('/').pop(),
    caption: item.caption || '',
    internal_only: item.internal_only === true,
    job_photo_id: item.id,
    source: 'job_photos',
  }
}
