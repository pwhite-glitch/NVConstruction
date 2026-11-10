// Internal-only photos (prompt 73): a job_photos row (migration 070 internal_only) or a
// daily_reports.photos[] element ({ path, caption, name, internal_only? }) marked
// internal is hidden from the owner portal. Staff galleries still show it with an
// "Internal" badge. Pure helpers — no DB / browser access here.

import { writeWithMissingColumnRetry, isMissingColumnError, missingColumnName } from './missing-column-retry'

export const MIGRATION_070_MESSAGE = 'Internal-only photos need database migration 070 (job_photos.internal_only). Ask Peyton to apply it — the photo was not saved.'
export const MIGRATION_070_TOGGLE_MESSAGE = 'Hiding gallery photos from the owner needs database migration 070 (job_photos.internal_only). Nothing was changed.'

// Strict true only. null / undefined / false / 'true' → visible (legacy rows fail open).
export const isInternalPhoto = p => !!p && p.internal_only === true

export const filterOwnerVisible = (list = []) => (Array.isArray(list) ? list.filter(p => !isInternalPhoto(p)) : [])

// Owner Photos page size: default 100, clamped 1..100; offset ≥ 0.
export const OWNER_PHOTO_PAGE_MAX = 100
export function parseOwnerPaging(params) {
  const get = k => (params && typeof params.get === 'function' ? params.get(k) : params?.[k])
  const rawLimit = parseInt(get('limit'), 10)
  const rawOffset = parseInt(get('offset'), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(OWNER_PHOTO_PAGE_MAX, Math.max(1, rawLimit)) : OWNER_PHOTO_PAGE_MAX
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { limit, offset }
}

// → { photos, total, limit, offset, has_more }. total counts the (already filtered) list.
export function pageOwnerPhotos(list = [], { limit = OWNER_PHOTO_PAGE_MAX, offset = 0 } = {}) {
  const all = Array.isArray(list) ? list : []
  const photos = all.slice(offset, offset + limit)
  return { photos, total: all.length, limit, offset, has_more: offset + photos.length < all.length }
}

// job_photos insert with the optional columns that may not exist yet.
//   insertWith(extra) → { error }  runs the page's insert with `extra` spread into the row
//     (the page keeps its own GPS / pre-066 retry inside insertWith).
//   extra: optional columns { caption?, tag?, internal_only? }.
// Rules:
//   • internal_only !== true → the key is omitted (DB DEFAULT false after 070; before 070
//     the insert never references the column). `tag` (not in the live schema) may be
//     dropped by the missing-column retry.
//   • internal_only === true → NEVER dropped. If the column is missing the insert fails and
//     this returns { error: { code: 'migration_070', … }, migrationRequired: '070' }; no
//     owner-visible row is written. The caller removes the uploaded storage objects.
// → { error, dropped, migrationRequired? }
export async function insertJobPhotoWithFallbacks(insertWith, extra = {}) {
  const wantInternal = extra?.internal_only === true
  const row = { ...(extra || {}) }
  if (wantInternal) row.internal_only = true
  else delete row.internal_only
  const res = await writeWithMissingColumnRetry(insertWith, row, { fallbackCols: ['tag'] })
  const migration070 = () => ({ error: { code: 'migration_070', message: MIGRATION_070_MESSAGE }, dropped: res.dropped, migrationRequired: '070' })
  // Belt and braces: internal_only is not on fallbackCols, so it can't be dropped.
  if (wantInternal && res.dropped.includes('internal_only')) return migration070()
  if (res.error) {
    if (wantInternal && isMissingColumnError(res.error)) {
      const col = missingColumnName(res.error)
      if (!col || col === 'internal_only') return migration070()
    }
    return { error: res.error, dropped: res.dropped }
  }
  return { error: null, dropped: res.dropped }
}

// daily_reports.photos with one element's internal_only set / cleared.
// → { photos, found }. Clearing removes the key (legacy shape stays visible).
export function setReportPhotoInternal(photos, path, internalOnly) {
  const list = Array.isArray(photos) ? photos : []
  let found = false
  const next = list.map(p => {
    if (!p || p.path !== path) return p
    found = true
    const { internal_only, ...rest } = p
    return internalOnly ? { ...rest, internal_only: true } : rest
  })
  return { photos: next, found }
}
