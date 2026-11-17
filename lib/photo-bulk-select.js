// Bulk Show / Hide on the job Photos tab (prompt 90). Pure helpers — no DB / browser access.
// Only gallery photos (job_photos rows) can be bulk-changed: /api/photo-visibility's bulk shape
// updates job_photos by path. Daily-report-only photos keep their own per-photo toggle.

export const BULK_VISIBILITY_MAX = 200 // must match app/api/photo-visibility BULK_VISIBILITY_MAX

export const isBulkSelectable = p => !!p && typeof p.path === 'string' && !!p.path && !p.fromReport

// Paths of the selectable photos in `list` (de-duplicated, order kept).
export function selectablePaths(list) {
  const out = []
  const seen = new Set()
  for (const p of Array.isArray(list) ? list : []) {
    if (!isBulkSelectable(p) || seen.has(p.path)) continue
    seen.add(p.path)
    out.push(p.path)
  }
  return out
}

// Split paths into request-sized chunks (the route answers 400 above BULK_VISIBILITY_MAX).
export function chunkPaths(paths, size = BULK_VISIBILITY_MAX) {
  const list = [...new Set(Array.isArray(paths) ? paths : [])]
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// Toggle one path in a Set (returns a new Set).
export function toggleInSet(set, path) {
  const next = new Set(set)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

// "Select all from <day>": adds every selectable photo of that day, or — when all of them are
// already selected — clears them. → new Set
export function toggleDay(set, dayPhotos) {
  const paths = selectablePaths(dayPhotos)
  const next = new Set(set)
  const allIn = paths.length > 0 && paths.every(p => next.has(p))
  for (const p of paths) { if (allIn) next.delete(p); else next.add(p) }
  return next
}

// Short day label for the day-header button: 'Nov 9' (or 'unknown date').
export function shortDayLabel(date) {
  if (!date || date === 'Unknown') return 'unknown date'
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
