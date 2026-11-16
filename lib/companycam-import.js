// CompanyCam import: date range, resumable server-side state, background status helpers
// (prompt 82 Addendum A, prompt 84). Pure helpers, safe in the browser and on the server (no
// Node / DB imports). The batch itself lives in lib/companycam-import-batch.js (server only).
// A run's cursor + counts live in jobs.companycam_import_state. Prompt 84: runs are
// `background: true` and a per-minute cron (/api/companycam/import-cron) keeps them going
// until done; statuses 'queued' | 'running' | 'paused' | 'stopped' | 'done'. Older states
// without the flag still read as before (a legacy 'paused' is resumable by hand).

import { todayCentral, addDaysCentral, centralDayStartIso } from './central-date'

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

// The date filter. Prompt 84: start_date / end_date are NOT sent to CompanyCam (the list call
// answered 422 to them), so every page is filtered here. capturedAt = ISO string.
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

// Can the bar offer Resume? A paused or stopped run, or a stale 'running' one (page closed
// mid-batch). Background 'queued' / 'paused' runs continue by themselves (cron); the bar offers
// Resume only for a stopped run or a legacy (non-background) paused one.
export function canResumeImport(state, now = Date.now()) {
  if (!state || state.status === 'done') return false
  return state.status === 'paused' || state.status === 'stopped' || (state.status === 'running' && !isImportRunning(state, now))
}

// The cron picks this run up: a background run that is queued / paused, or 'running' but stale.
// 'stopped' and 'done' never; non-background (legacy) states never.
export function isBackgroundRunnable(state, now = Date.now()) {
  if (!state || state.background !== true) return false
  if (state.status === 'queued' || state.status === 'paused') return true
  return state.status === 'running' && !isImportRunning(state, now)
}

// Failed batches (prompt 84 follow-up). Every failed batch bumps error_count and stamps
// last_failed_at; a success resets them. A retryable failure (CompanyCam 429 / 5xx / timeout,
// a DB hiccup) keeps being retried by the cron, but with backoff: after n consecutive failures
// the cron waits min(2^(n-1), 15) minutes from last_failed_at. A permanent failure (404, no
// access, migration missing...) is retried every minute, but after IMPORT_MAX_PERMANENT_FAILURES
// in a row the run is parked: status 'paused', background false (the cron no longer picks it
// up), paused_reason 'repeated_errors'. Resume clears all of it.
export const IMPORT_MAX_PERMANENT_FAILURES = 10
export const IMPORT_MAX_BACKOFF_MIN = 15
const BACKOFF_SLACK_MS = 10000 // a "1-minute" cron tick can land a few seconds early

export function importRetryDelayMs(state) {
  const n = Number(state?.error_count) || 0
  if (n <= 0 || state?.last_error_retryable !== true) return 0
  return Math.min(2 ** (n - 1), IMPORT_MAX_BACKOFF_MIN) * 60000
}

// The cron should leave this run alone for now (backing off after retryable failures).
export function isImportBackingOff(state, now = Date.now()) {
  const delay = importRetryDelayMs(state)
  if (delay <= 0) return false
  const t = new Date(state.last_failed_at).getTime()
  return Number.isFinite(t) && now - t < delay - BACKOFF_SLACK_MS
}

export const isImportParkedAfterErrors = state => !!state && state.status === 'paused' && state.paused_reason === 'repeated_errors'

// A background run still in progress (shows status + Stop in the bar).
export const isBackgroundActive = state => !!state && state.background === true && ['queued', 'running', 'paused'].includes(state.status)

// Plain words for the bar and the Owner page.
export function importStatusLabel(state) {
  if (!state) return 'Not started'
  switch (state.status) {
    case 'queued': return state.background ? 'Waiting for the next run (about every minute)' : 'Waiting'
    case 'running': return 'Importing now'
    case 'paused':
      if (isImportParkedAfterErrors(state)) return 'Paused after repeated errors — Resume to try again'
      return state.background ? (state.last_error ? (Number(state.error_count) > 1 ? 'Paused after an error — will retry automatically' : 'Paused after an error — will retry in about a minute') : 'Paused — will retry in about a minute') : 'Paused'
    case 'stopped': return 'Stopped'
    case 'done': return 'Import finished'
    default: return String(state.status || 'Unknown')
  }
}

// ISO timestamp → 'Nov 16, 2:05 PM' in Central ('' when missing / invalid).
export function centralDateTimeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export const importRangeLabel = state => {
  if (!state) return ''
  const a = state.start_date || 'beginning'
  const b = state.end_date || 'today'
  return `${a} – ${b}`
}
