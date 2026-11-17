// One time-boxed batch of a CompanyCam project import (prompt 82 Addendum A, moved here in
// prompt 84 so the POST /api/companycam/import route and the per-minute background cron
// /api/companycam/import-cron share it). SERVER ONLY — never import from a page
// (lib/companycam-import.js holds the browser-safe helpers).
//
// Guarantees (unchanged from prompt 82/83):
//   • Claim: the state is written as 'running' only if it is still exactly what the caller read
//     (compare-and-set on companycam_import_state) AND the job is still linked to the project.
//   • Every later save is compare-and-set on the job still being linked to that project; after a
//     relink / unlink the save matches nothing and the batch answers 'project_changed'.
//   • Photos that fail are recorded in companycam_photo_inbox (status 'failed') so the Owner can
//     retry them from the Unmatched / failed list. New rows are owner-visible
//     (CC_IMPORT_INTERNAL_ONLY, prompt 90); existing rows keep their internal_only.
// Prompt 84:
//   • start_date / end_date are never sent to CompanyCam (the list call answered 422). Every page
//     is read and filtered locally (inImportRange); no early stop on dates (order not guaranteed).
//   • page_done_ids: when a batch runs out of time it keeps its cursor (the page is re-read next
//     time) and stores the ids it already handled on that page; the re-read passes over them
//     without counting them, so "skipped" only counts photos that were already in the portal
//     before this run touched them (webhook / earlier import) plus 23505 duplicates. Cleared
//     whenever the cursor advances.
//   • The final save is compare-and-set on the exact 'running' state this batch claimed. If the
//     user pressed Stop meanwhile, the save re-reads and keeps 'stopped' (with this batch's
//     counts and cursor merged in) instead of flipping it back to queued / paused.
//   • Background runs (state.background === true) end a batch as 'queued' (more to do), 'done',
//     or 'paused' + last_error (CompanyCam / DB error; the cron retries it next minute).
// Prompt 84 follow-up:
//   • Every claim stamps claim_id (this batch) and last_batch_at (when a batch last really ran:
//     the cron's round-robin order). A batch with no download budget never claims.
//   • The final save never drops this batch's counts. If the CAS misses, it re-reads: Stop →
//     merge into 'stopped'; still our own claim (another batch only added its counts) → save
//     ours with the counts added; another batch of the SAME run (same started_at) took over
//     (Stop then a quick Resume) → only this batch's imported / skipped / failed are added to
//     that state, its cursor / status are left alone. Nothing is imported twice (unique
//     companycam_photo_id). A different run (Start over) → 'lost', nothing merged.
//   • A DB error on the final save is reported as { kind: 'db_error' } (and logged), not ok.
//   • Failure counters (error_count, permanent_error_count, last_failed_at,
//     last_error_retryable) drive the cron's backoff and, after IMPORT_MAX_PERMANENT_FAILURES
//     permanent failures in a row, park the run (paused, background false, paused_reason
//     'repeated_errors'). See lib/companycam-import.js. A successful batch resets them.

import { isMissingColumnError } from './missing-column-retry'
import { ccFetch, normalizeCcPhoto, importCcPhotoToJob, recordInbox, isCcId, DOWNLOAD_BUDGET_MS } from './companycam'
import { randomUUID } from 'crypto'
import { validateImportRange, inImportRange, IMPORT_MAX_PERMANENT_FAILURES } from './companycam-import'

export const IMPORT_PAGE_SIZE = 20
// Cron timing (maxDuration 60 s). Worst case, measured from the start of the invocation:
//   • A batch starts only while ≥ CRON_MIN_BATCH_BUDGET_MS (5 s) of download budget is left,
//     i.e. never after CRON_START_CUTOFF_MS = 20 s.
//   • Its CompanyCam list call is cut so it ends by CRON_LIST_DEADLINE_MS = 35 s (it starts by
//     20 s and is capped at 15 s anyway). A list that ends after 25 s downloads nothing.
//   • No photo download (original, or the optional thumbnail) STARTS after
//     CRON_DOWNLOAD_CUTOFF_MS = 25 s. A download is capped at DOWNLOAD_TIMEOUT_MS = 15 s for the
//     whole transfer → every download is over by 25 + 15 = 40 s.
//   • The original's Storage upload is capped at CRON_UPLOAD_TIMEOUT_MS = 8 s → by 48 s. The
//     thumbnail upload only happens if we are still before the 25 s cutoff (≤ 25 + 8 = 33 s).
//   • Then the job_photos insert, the inbox mark and the final state save (CAS, at worst a few
//     re-read + CAS rounds): ordinary small DB round trips, with ~12 s of margin left before 60 s.
//   48 s + DB round trips < 60 s. The checks between photos are done by the batch itself
//   (startedAt + budgetMs) and the existence check / insert per photo are single-row queries.
export const CRON_DOWNLOAD_CUTOFF_MS = 25000
export const CRON_MIN_BATCH_BUDGET_MS = 5000
export const CRON_START_CUTOFF_MS = CRON_DOWNLOAD_CUTOFF_MS - CRON_MIN_BATCH_BUDGET_MS
export const CRON_LIST_DEADLINE_MS = 35000
export const CRON_UPLOAD_TIMEOUT_MS = 8000

const num = v => Number(v) || 0
// CompanyCam answers worth retrying with backoff (rate limit, server error, timeout / network).
const retryableStatus = st => st === 0 || st === 408 || st === 429 || st >= 500
// What a successful batch writes back: the failure counters start over.
export const IMPORT_FAILURES_CLEARED = { error_count: 0, permanent_error_count: 0, last_failed_at: null, last_error_retryable: null, paused_reason: null }

export const importStateOf = job => {
  const st = job?.companycam_import_state
  return st && typeof st === 'object' && !Array.isArray(st) ? st : null
}

// Compare-and-set of jobs.companycam_import_state: only when the job is still linked to `pid`
// and the state is still exactly `prev` (null → still null). → { ok } | { error }
export async function casImportState(db, jobId, pid, prev, next) {
  let q = db.from('jobs').update({ companycam_import_state: next }).eq('id', jobId).eq('companycam_project_id', pid)
  q = prev ? q.eq('companycam_import_state', JSON.stringify(prev)) : q.is('companycam_import_state', null)
  const { data, error } = await q.select('id')
  if (error) return { error }
  return { ok: !!data?.length }
}

// Counts / cursor of a saved state, ready to continue from.
export function baseFromState(prev) {
  return {
    ...prev,
    start_date: prev.start_date || null,
    end_date: prev.end_date || null,
    cursor: prev.cursor || null,
    imported: num(prev.imported),
    skipped: num(prev.skipped),
    failed: num(prev.failed),
    page_done_ids: Array.isArray(prev.page_done_ids) ? prev.page_done_ids.map(String) : [],
  }
}

// Run ONE batch for `job` (a jobs row with id, companycam_project_id, companycam_import_state).
//   actorId     → updated_by on every save (null from the cron)
//   startedAt   → epoch ms the time budget counts from
//   budgetMs    → no new photo download starts after startedAt + budgetMs
//   listTimeoutMs → optional shorter cap for the CompanyCam list call
//   uploadTimeoutMs → optional cap on each Storage upload (the cron)
//   base        → optional fresh state to claim instead of continuing job's saved state
//                 (legacy non-background "new range" request)
// → { kind: 'ok', imported, skipped, out_of_range, failed: [...], next_cursor, done, state, stopped? }
//   | { kind: 'claim_lost' } | { kind: 'project_changed' } | { kind: 'migration', state? }
//   | { kind: 'api_error', status, error, state } | { kind: 'db_error', error, state? }
//   | { kind: 'bad_range', error } | { kind: 'no_state' } | { kind: 'lost', state }
//   | { kind: 'no_budget' } (nothing claimed or written)
export async function runCcImportBatch(db, job, { actorId = null, startedAt = Date.now(), budgetMs = DOWNLOAD_BUDGET_MS, listTimeoutMs, uploadTimeoutMs = null, base: baseOverride = null } = {}) {
  const pid = job?.companycam_project_id
  if (!job?.id || !pid) return { kind: 'project_changed' }
  // No time to download anything: do not claim, list or save (that would only bump this job's
  // timestamps and cost a CompanyCam call).
  if (!(budgetMs > 0)) return { kind: 'no_budget' }
  const prev = importStateOf(job)
  const base = baseOverride ? { ...baseOverride, page_done_ids: baseOverride.page_done_ids || [] } : prev ? baseFromState(prev) : null
  if (!base) return { kind: 'no_state' }
  const range = validateImportRange({ start_date: base.start_date, end_date: base.end_date })
  if (!range.ok) return { kind: 'bad_range', error: range.error }

  const stamp = () => ({ updated_at: new Date().toISOString(), updated_by: actorId })
  const claimId = randomUUID()
  const claimed = { ...base, status: 'running', claim_id: claimId, ...stamp() }
  claimed.last_batch_at = claimed.updated_at
  const c = await casImportState(db, job.id, pid, prev, claimed)
  if (c.error) return isMissingColumnError(c.error) ? { kind: 'migration' } : { kind: 'db_error', error: c.error.message }
  if (!c.ok) return { kind: 'claim_lost' }

  // Final save: CAS on the exact state claimed above. If that misses, re-read and merge (see the
  // header): Stop wins; this batch's counts are never dropped while the run is the same run.
  const sameRun = st => (st?.started_at ?? null) === (claimed.started_at ?? null)
  const finish = async next => {
    const saved = { ...next, claim_id: claimId, last_batch_at: claimed.last_batch_at, ...stamp() }
    const delta = { imported: num(saved.imported) - num(claimed.imported), skipped: num(saved.skipped) - num(claimed.skipped), failed: num(saved.failed) - num(claimed.failed) }
    const plus = st => ({ imported: num(st.imported) + delta.imported, skipped: num(st.skipped) + delta.skipped, failed: num(st.failed) + delta.failed })
    const dbFail = (what, e) => {
      console.error(`[companycam import] ${what} failed for job`, job.id, e.message)
      return { ok: false, kind: 'db_error', error: `Could not save the import progress: ${e.message}` }
    }
    let expected = claimed
    let want = saved
    let stopped = false
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await casImportState(db, job.id, pid, expected, want)
      if (r.error) return dbFail('state save', r.error)
      if (r.ok) return { ok: true, state: want, stopped }
      const { data: cur, error } = await db.from('jobs').select('companycam_project_id, companycam_import_state').eq('id', job.id).maybeSingle()
      if (error) return dbFail('state re-read', error)
      if (!cur || String(cur.companycam_project_id ?? '') !== String(pid)) return { ok: false, kind: 'project_changed' }
      const now = importStateOf(cur)
      if (!now || !sameRun(now)) return { ok: false, kind: 'lost', state: now }
      if (now.status === 'stopped') {
        stopped = true
        want = { ...saved, ...plus(now), status: next.status === 'done' ? 'done' : 'stopped', stopped_by: now.stopped_by ?? null, stopped_at: now.stopped_at ?? null }
      } else if (now.status === 'running' && now.claim_id === claimId) {
        stopped = false
        want = { ...saved, ...plus(now) }
      } else {
        // Another batch of this run took over (Stop then a quick Resume): hand over the counts only.
        stopped = false
        want = { ...now, ...plus(now) }
      }
      expected = now
    }
    return { ok: false, kind: 'lost', state: null }
  }
  const failed = f => (f.kind === 'project_changed' ? { kind: 'project_changed' }
    : f.kind === 'db_error' ? { kind: 'db_error', error: f.error, state: null }
      : { kind: 'lost', state: f.state })
  // A failed batch: paused + last_error + the failure counters (backoff / parking, see header).
  const failure = (st, error, retryable) => {
    const permanent = retryable ? num(base.permanent_error_count) : num(base.permanent_error_count) + 1
    const parked = base.background === true && permanent >= IMPORT_MAX_PERMANENT_FAILURES
    return {
      ...st,
      status: 'paused',
      last_error: error,
      error_count: num(base.error_count) + 1,
      permanent_error_count: permanent,
      last_failed_at: new Date().toISOString(),
      last_error_retryable: !!retryable,
      ...(parked ? { background: false, paused_reason: 'repeated_errors' } : {}),
    }
  }

  const q = new URLSearchParams({ limit: String(IMPORT_PAGE_SIZE) })
  if (base.cursor) q.set('after', base.cursor)
  const list = await ccFetch(`/projects/${pid}/photos?${q.toString()}`, listTimeoutMs ? { timeoutMs: listTimeoutMs } : undefined)
  if (!list.ok) {
    const error = `Could not read CompanyCam photos: ${list.error}`
    const f = await finish(failure(base, error, retryableStatus(list.status)))
    if (!f.ok) return failed(f)
    return { kind: 'api_error', status: list.status, error, state: f.state }
  }
  const items = (Array.isArray(list.data) ? list.data : []).map(normalizeCcPhoto).filter(p => isCcId(p.id))
  const meta = list.meta || {}
  const nextCursor = meta.has_next && meta.next_cursor ? String(meta.next_cursor) : null

  const inRange = items.filter(p => inImportRange(p.capturedAt, range))
  const outOfRange = items.length - inRange.length
  // Ids this run already handled on this same page (an earlier batch ran out of time here).
  const pageIds = new Set(items.map(p => p.id))
  const handled = base.page_done_ids.filter(id => pageIds.has(id))
  const doneBefore = new Set(handled)
  const todo = inRange.filter(p => !doneBefore.has(p.id))

  let imported = 0
  let skipped = 0
  const failedList = []
  const progress = extra => ({
    ...base,
    imported: base.imported + imported,
    skipped: base.skipped + skipped,
    failed: base.failed + failedList.length,
    ...extra,
  })

  let have = new Set()
  if (todo.length) {
    const { data, error } = await db.from('job_photos').select('companycam_photo_id').in('companycam_photo_id', todo.map(p => p.id))
    if (error) {
      const missing = isMissingColumnError(error)
      const f = await finish(failure(base, missing ? 'Apply migration 074 first' : `Could not check existing photos: ${error.message}`, !missing))
      if (!f.ok) return failed(f)
      return missing ? { kind: 'migration', state: f.state } : { kind: 'db_error', error: error.message, state: f.state }
    }
    have = new Set((data || []).map(r => String(r.companycam_photo_id)))
  }

  const deadline = startedAt + budgetMs
  let outOfTime = false
  for (const photo of todo) {
    // Already in the portal before this run touched it (webhook or an earlier import).
    if (have.has(photo.id)) { skipped++; handled.push(photo.id); continue }
    if (budgetMs <= 0 || Date.now() > deadline) { outOfTime = true; break }
    if (!photo.projectId) photo.projectId = String(pid)
    const r = await importCcPhotoToJob(db, { job, photo, downloadDeadline: deadline, uploadTimeoutMs })
    if (r.status === 'imported') { imported++; handled.push(photo.id) }
    else if (r.status === 'duplicate') { skipped++; handled.push(photo.id) } // 23505 / raced in
    else if (r.migrationRequired) {
      const f = await finish(failure(progress({ page_done_ids: handled }), 'Apply migration 074 first', false))
      if (!f.ok) return failed(f)
      return { kind: 'migration', state: f.state }
    } else {
      const error = r.error || 'Import failed'
      // Same as a webhook failure: the cursor moves past this page, so the inbox row is the
      // only way back to this photo (Owner's Unmatched / failed list → Assign retries it).
      const ib = await recordInbox(db, photo, { status: 'failed', error })
      if (ib.error) console.error('[companycam import] inbox write failed:', ib.error)
      failedList.push({ id: photo.id, error, inbox: !ib.error && !ib.skipped })
      handled.push(photo.id)
    }
  }

  // Out of time: keep this page's cursor so the next batch re-reads it, and remember what was
  // handled on it (at most one page of ids). Cursor advanced → page_done_ids cleared.
  const done = !outOfTime && !nextCursor
  const status = done ? 'done' : base.background === true ? 'queued' : 'paused'
  const next = progress({
    cursor: done ? null : (outOfTime ? base.cursor : nextCursor),
    page_done_ids: outOfTime ? [...new Set(handled)].slice(0, Math.max(IMPORT_PAGE_SIZE, pageIds.size)) : [],
    status,
    last_error: null,
    ...IMPORT_FAILURES_CLEARED,
  })
  const f = await finish(next)
  if (!f.ok) return failed(f)
  return { kind: 'ok', imported, skipped, out_of_range: outOfRange, failed: failedList, next_cursor: f.state.cursor, done: f.state.status === 'done', state: f.state, stopped: !!f.stopped }
}
