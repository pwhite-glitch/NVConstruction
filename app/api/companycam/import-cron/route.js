import { createClient } from '@supabase/supabase-js'
import { verifyCronSecret } from '../../../../lib/server-auth'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { DOWNLOAD_BUDGET_MS } from '../../../../lib/companycam'
import { isBackgroundRunnable, isImportBackingOff } from '../../../../lib/companycam-import'
import {
  runCcImportBatch, importStateOf,
  CRON_START_CUTOFF_MS, CRON_DOWNLOAD_CUTOFF_MS, CRON_LIST_DEADLINE_MS, CRON_MIN_BATCH_BUDGET_MS, CRON_UPLOAD_TIMEOUT_MS,
} from '../../../../lib/companycam-import-batch'

// Background CompanyCam imports (prompt 84). Vercel Cron, every minute (vercel.json).
// Picks linked jobs whose import state is background + queued / paused, or 'running' but stale
// (> 90 s, a batch died), and runs batches one after another while time is left.
// Fair round-robin: jobs go in order of last_batch_at (when a batch last really ran for them;
// never-run first), so a job processed this tick goes behind the ones that waited. A batch only
// starts with ≥ 5 s of download budget left, so a job is never "touched" by a batch that could
// do no work (that would have pushed it behind the job that used up the time).
// Timing (worst case < 60 s) is documented at CRON_DOWNLOAD_CUTOFF_MS in
// lib/companycam-import-batch.js: no batch starts after 20 s, no photo download starts after
// 25 s, each download ≤ 15 s, each Storage upload ≤ 8 s, the list call ends by 35 s.
// 'stopped' and 'done' runs are never picked up; nor are non-background (legacy or parked)
// states. A CompanyCam error saves that job 'paused' + last_error and the cron moves on; it is
// retried next minute, with backoff after repeated retryable errors (isImportBackingOff), and
// parked after 10 permanent ones in a row (lib/companycam-import.js).
// Pre-074 → 200 { skipped: 'migration_074' }. No COMPANYCAM_API_TOKEN → 200, nothing done.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MAX_JOBS = 50

const ms = iso => {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}
// Least recently processed first (never-run = 0), then oldest update.
const byLastBatch = (a, b) => {
  const sa = importStateOf(a) || {}
  const sb = importStateOf(b) || {}
  return ms(sa.last_batch_at) - ms(sb.last_batch_at) || ms(sa.updated_at) - ms(sb.updated_at)
}

export async function GET(request) {
  const t0 = Date.now()
  if (!verifyCronSecret(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!String(process.env.COMPANYCAM_API_TOKEN || '').trim()) {
    return Response.json({ ok: true, skipped: 'not_configured', reason: 'COMPANYCAM_API_TOKEN is not set', jobs: [] })
  }

  const { data, error } = await adminSupabase.from('jobs')
    .select('id, project_name, job_number, job_type, companycam_project_id, companycam_import_state')
    .not('companycam_project_id', 'is', null)
    .eq('companycam_import_state->>background', 'true')
    .in('companycam_import_state->>status', ['queued', 'paused', 'running'])
    .order('companycam_import_state->>last_batch_at', { ascending: true, nullsFirst: true })
    .order('companycam_import_state->>updated_at', { ascending: true })
    .limit(MAX_JOBS)
  if (error) {
    if (isMissingColumnError(error)) return Response.json({ ok: true, skipped: 'migration_074', jobs: [] })
    console.error('[companycam import-cron] job read failed:', error.message)
    return Response.json({ error: 'Could not read jobs' }, { status: 500 })
  }
  // Re-checked here: fresh 'running' (another batch is mid-flight) is skipped, and so is a run
  // backing off after repeated retryable errors.
  const now = Date.now()
  const queue = (data || [])
    .filter(j => isBackgroundRunnable(importStateOf(j), now) && !isImportBackingOff(importStateOf(j), now))
    .sort(byLastBatch)

  const summary = new Map()
  const record = (job, patch) => {
    const s = summary.get(job.id) || { job_id: job.id, imported: 0, skipped: 0, failed: 0, batches: 0, status: null }
    s.imported += patch.imported || 0
    s.skipped += patch.skipped || 0
    s.failed += patch.failed || 0
    s.batches += 1
    s.status = patch.status
    if (patch.error) s.error = patch.error
    else delete s.error
    summary.set(job.id, s)
  }

  let timeUp = false
  while (queue.length) {
    const batchStart = Date.now()
    const budgetMs = Math.min(DOWNLOAD_BUDGET_MS, t0 + CRON_DOWNLOAD_CUTOFF_MS - batchStart)
    // Not enough time for a useful batch: stop here, so the waiting jobs keep their place.
    if (batchStart - t0 >= CRON_START_CUTOFF_MS || budgetMs < CRON_MIN_BATCH_BUDGET_MS) { timeUp = true; break }
    const job = queue.shift()
    const before = importStateOf(job)
    const listTimeoutMs = Math.max(1000, Math.min(15000, t0 + CRON_LIST_DEADLINE_MS - batchStart))
    let r
    try {
      r = await runCcImportBatch(adminSupabase, job, { actorId: null, startedAt: batchStart, budgetMs, listTimeoutMs, uploadTimeoutMs: CRON_UPLOAD_TIMEOUT_MS })
    } catch (e) {
      console.error('[companycam import-cron] batch threw for job', job.id, e?.message || e)
      record(job, { status: 'error', error: 'Batch failed' })
      continue
    }
    if (r.kind === 'no_budget') { queue.unshift(job); timeUp = true; break }
    if (r.kind === 'ok') {
      record(job, { imported: r.imported, skipped: r.skipped, failed: r.failed.length, status: r.state.status })
      // Time left and real progress → go round again after the other jobs.
      const moved = r.state.cursor !== (before?.cursor || null) || (r.state.page_done_ids || []).length > (before?.page_done_ids || []).length
      const left = t0 + CRON_DOWNLOAD_CUTOFF_MS - Date.now()
      if (r.state.status === 'queued' && moved && left >= CRON_MIN_BATCH_BUDGET_MS) queue.push({ ...job, companycam_import_state: r.state })
    } else if (r.kind === 'db_error' && !r.state) {
      // The final save itself failed: nothing was saved for this batch (the state stays
      // 'running' and is picked up again once stale). Reported as an error, never as success.
      console.error('[companycam import-cron] state save failed for job', job.id, r.error)
      record(job, { status: 'error', error: r.error || 'Could not save the import progress' })
    } else if (r.kind === 'api_error' || r.kind === 'migration' || r.kind === 'db_error') {
      record(job, { status: r.state?.status || 'paused', error: r.error || r.state?.last_error || r.kind })
    } else {
      // claim_lost (stopped / started elsewhere since the read), project_changed, lost, bad_range.
      record(job, { status: 'skipped', error: r.kind })
    }
  }

  const jobs = [...summary.values()]
  if (jobs.length) console.info('[companycam import-cron]', JSON.stringify({ jobs: jobs.map(j => ({ job_id: j.job_id, imported: j.imported, skipped: j.skipped, failed: j.failed, status: j.status })), ms: Date.now() - t0 }))
  const errors = jobs.filter(j => j.status === 'error').length
  return Response.json({ ok: errors === 0, errors: errors || undefined, jobs, time_up: timeUp || undefined, waiting: timeUp ? queue.length : undefined })
}
