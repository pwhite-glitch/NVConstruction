// CompanyCam one-time import: date range, resumable state, per-click cap (prompt 82 Addendum A).
// Pure helpers, safe in the browser and on the server (no Node / DB imports).
// Big projects (thousands of photos) must never come in on one click: the import takes a
// Central-time date range, runs in time-boxed batches whose cursor lives on the server
// (jobs.companycam_import_state), and the UI pauses every IMPORT_SESSION_CAP imports.

import { todayCentral, addDaysCentral, centralDayStartIso } from './central-date'

export const IMPORT_SESSION_CAP = 200
export const IMPORT_RUNNING_FRESH_MS = 90 * 1000
export const IMPORT_DEFAULT_SINCE_DAYS = 30

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// A real calendar date in 'YYYY-MM-DD' form (2026-02-30 → false).
export function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_ONLY.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export const defaultImportSince = (now = new Date()) => addDaysCentral(-IMPORT_DEFAULT_SINCE_DAYS, now)

// Epoch seconds of Central midnight starting `date`.
export const centralDayStartEpoch = date => Math.floor(new Date(centralDayStartIso(date)).getTime() / 1000)
// Last epoch second of the Central day `date` (inclusive).
export function centralDayEndEpoch(date) {
  const next = addDaysCentral(1, new Date(date + 'T12:00:00Z'))
  return centralDayStartEpoch(next) - 1
}

// { start_date?, end_date? } → { ok: true, start, end, startEpoch, endEpoch } | { ok: false, error }
// Both optional; blank = open. Neither may be in the future (Central); start <= end.
export function validateImportRange({ start_date, end_date } = {}, now = new Date()) {
  const start = start_date == null || start_date === '' ? null : start_date
  const end = end_date == null || end_date === '' ? null : end_date
  if (start !== null && !isRealDate(start)) return { ok: false, error: 'Start date must be a real date (YYYY-MM-DD).' }
  if (end !== null && !isRealDate(end)) return { ok: false, error: 'End date must be a real date (YYYY-MM-DD).' }
  const today = todayCentral(now)
  if (start !== null && start > today) return { ok: false, error: 'Start date is in the future.' }
  if (end !== null && end > today) return { ok: false, error: 'End date is in the future.' }
  if (start !== null && end !== null && start > end) return { ok: false, error: 'Start date is after the end date.' }
  return {
    ok: true,
    start,
    end,
    startEpoch: start !== null ? centralDayStartEpoch(start) : null,
    endEpoch: end !== null ? centralDayEndEpoch(end) : null,
  }
}

// Local filter in case the API ignores start_date / end_date. capturedAt = ISO string.
export function inImportRange(capturedAt, { startEpoch = null, endEpoch = null } = {}) {
  const t = Math.floor(new Date(capturedAt).getTime() / 1000)
  if (!Number.isFinite(t)) return startEpoch === null && endEpoch === null
  if (startEpoch !== null && t < startEpoch) return false
  if (endEpoch !== null && t > endEpoch) return false
  return true
}

// Another request is mid-batch: status 'running' and touched within the last 90 s.
export function isImportRunning(state, now = Date.now()) {
  if (!state || state.status !== 'running') return false
  const t = new Date(state.updated_at).getTime()
  return Number.isFinite(t) && now - t < IMPORT_RUNNING_FRESH_MS
}

// Can the bar offer Resume? A paused run, or a stale 'running' one (page closed mid-batch).
export function canResumeImport(state, now = Date.now()) {
  if (!state || state.status === 'done') return false
  return state.status === 'paused' || (state.status === 'running' && !isImportRunning(state, now))
}

// UI loop: after one batch response, keep going, pause at the per-click cap, or stop.
// sessionImported = photos imported since the user clicked (including this batch).
export function nextImportStep({ done, sessionImported, cap = IMPORT_SESSION_CAP }) {
  if (done) return 'done'
  if (sessionImported >= cap) return 'pause'
  return 'continue'
}

export const importRangeLabel = state => {
  if (!state) return ''
  const a = state.start_date || 'beginning'
  const b = state.end_date || 'today'
  return `${a} – ${b}`
}
