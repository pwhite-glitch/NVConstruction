// Read EVERY job_photos row of a job (prompt 90). PostgREST answers at most 1,000 rows per
// request (db-max-rows), so a plain .select().eq('job_id') silently dropped everything past
// row 1,000 on big jobs (Russellville ~3,852, Conway ~2,560 photos). These helpers page
// DB-side with a stable order (taken_at desc, nulls last, then id) and .range() until a short
// page. Browser-safe: `db` is any Supabase client (service role in API routes, the browser
// client on the job / field pages). No other imports with side effects.

import { isMissingColumnError } from './missing-column-retry'

export const JOB_PHOTO_PAGE_SIZE = 1000
// 200 pages = 200,000 photos on one job — far past anything real; the loop can't spin forever.
export const JOB_PHOTO_MAX_PAGES = 200
// .in('storage_path', …) chunk size: keeps the request URL well under PostgREST / proxy limits.
export const JOB_PHOTO_PATH_CHUNK = 200

// → { data: rows[], error, truncated? }
//   visibleOnly: drop internal_only rows in the query itself (owner portal). Uses
//     NOT (internal_only IS TRUE) so a NULL / false row stays visible. Before migration 070
//     (no column) the filter is skipped once and the caller's in-memory check still applies.
//   columns: select list (default '*': optional columns are read when present).
// Rows are de-duplicated by id (a row inserted mid-read can shift a page boundary).
export async function fetchAllJobPhotos(db, jobId, { visibleOnly = false, columns = '*', pageSize = JOB_PHOTO_PAGE_SIZE, maxPages = JOB_PHOTO_MAX_PAGES } = {}) {
  if (!jobId) return { data: [], error: null }
  let filterInternal = !!visibleOnly
  const build = (from, withFilter) => {
    let q = db.from('job_photos').select(columns).eq('job_id', jobId)
    if (withFilter) q = q.not('internal_only', 'is', true)
    return q
      .order('taken_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
  }
  const rows = []
  const seen = new Set()
  for (let page = 0; page < maxPages; page++) {
    let res = await build(page * pageSize, filterInternal)
    if (res?.error && filterInternal && page === 0 && isMissingColumnError(res.error)) {
      filterInternal = false
      res = await build(0, false)
    }
    if (res?.error) return { data: null, error: res.error }
    const got = Array.isArray(res?.data) ? res.data : []
    for (const r of got) {
      const key = r?.id
      if (key != null) { if (seen.has(key)) continue; seen.add(key) }
      rows.push(r)
    }
    if (got.length < pageSize) return { data: rows, error: null }
  }
  console.warn('[job-photos] stopped after', maxPages, 'pages for job', jobId)
  return { data: rows, error: null, truncated: true }
}

// The job_photos rows (internal or not) whose storage_path is one of `paths`, on this job.
// Used for daily-report photos: a referenced photo must be judged by ITS row even when that
// row was not in the paged / filtered list. → { data: rows[], error }
export async function fetchJobPhotosByPaths(db, jobId, paths, { columns = '*', chunk = JOB_PHOTO_PATH_CHUNK } = {}) {
  const list = [...new Set((Array.isArray(paths) ? paths : []).filter(p => typeof p === 'string' && p))]
  if (!jobId || !list.length) return { data: [], error: null }
  const rows = []
  for (let i = 0; i < list.length; i += chunk) {
    const { data, error } = await db.from('job_photos').select(columns).eq('job_id', jobId).in('storage_path', list.slice(i, i + chunk))
    if (error) return { data: null, error }
    rows.push(...(data || []))
  }
  return { data: rows, error: null }
}

// Merge row lists by id (first wins); rows without an id are kept.
export function mergeJobPhotoRows(...lists) {
  const out = []
  const seen = new Set()
  for (const list of lists) {
    for (const r of Array.isArray(list) ? list : []) {
      if (!r) continue
      if (r.id != null) { if (seen.has(r.id)) continue; seen.add(r.id) }
      out.push(r)
    }
  }
  return out
}
