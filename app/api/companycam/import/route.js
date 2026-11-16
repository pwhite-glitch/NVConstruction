import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { atLeastPM, denyUnlessOnJob } from '../../../../lib/roles'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { hasCcColumn, DOWNLOAD_BUDGET_MS } from '../../../../lib/companycam'
import { validateImportRange, isImportRunning } from '../../../../lib/companycam-import'
import { runCcImportBatch, casImportState, importStateOf, baseFromState, IMPORT_FAILURES_CLEARED } from '../../../../lib/companycam-import-batch'

// Import of a linked CompanyCam project's existing photos (prompt 82 Addendum A; background
// runs prompt 84). Dates are YYYY-MM-DD in America/Chicago, both optional (blank = open).
// The batch itself is lib/companycam-import-batch.js runCcImportBatch (shared with the cron).
//
// POST { job_id, start_date?, end_date?, background: true }
//   → new background run: state { range, cursor null, counts 0, background, status 'queued',
//     started_by, started_at } is written (compare-and-set on what was read), then ONE batch runs
//     now so the user sees progress; /api/companycam/import-cron continues it every minute.
// POST { job_id, resume: true } → a stopped / paused (or stale running) run is re-queued as a
//     background run and one batch runs now. Resume clears the failure counters (a run parked
//     after repeated errors starts retrying again).
// Background start / resume: once 'queued' is saved the run IS going. If a cron tick claims it
//     before this request's own batch does, the answer is still 200 { queued: true, state }.
// POST { job_id, stop: true } → compare-and-set status 'stopped' (the cron never picks it up).
//     A batch already mid-flight finishes and keeps 'stopped' (see the batch's final save).
// POST { job_id, start_date?, end_date? } (no background) → old shape: one batch, ends
//     'paused' / 'done'. Kept so older clients keep working; the UI no longer uses it.
// GET ?job_id= → { companycam_project_id, state } for the bar's ~20 s refresh.
// Auth: Owner or PM, and on the job. A second request while the state is 'running' and fresh
// (< 90 s) → 409. A relink / unlink mid-batch → 409 'project changed'.
// Imported rows are internal_only. No Change History (photos are not job fields).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TIME_BUDGET_MS = DOWNLOAD_BUDGET_MS // 35 s: well under maxDuration 60
const need074 = extra => Response.json({ error: 'Apply migration 074 first', migration_required: '074', ...(extra || {}) }, { status: 409 })
const projectChanged = () => Response.json({ error: 'project changed', detail: 'The CompanyCam link on this job changed while the import was running. Nothing more was saved for the old project.' }, { status: 409 })
const alreadyRunning = () => Response.json({ error: 'An import is already running for this job. Try again in a minute.' }, { status: 409 })

async function gate(request, jobId) {
  const auth = await requireAuth(request)
  if (auth.error) return { response: auth.error }
  if (!atLeastPM(auth.role)) return { response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  if (!jobId || typeof jobId !== 'string') return { response: Response.json({ error: 'job_id required' }, { status: 400 }) }
  const denied = await denyUnlessOnJob(adminSupabase, auth, jobId)
  if (denied) return { response: denied }
  return { auth }
}

export async function GET(request) {
  const jobId = new URL(request.url).searchParams.get('job_id')
  const { response } = await gate(request, jobId)
  if (response) return response
  const { data: job, error } = await adminSupabase.from('jobs').select('id, companycam_project_id, companycam_import_state').eq('id', jobId).maybeSingle()
  if (error) return isMissingColumnError(error) ? Response.json({ state: null, migration_required: '074' }) : Response.json({ error: error.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  return Response.json({ companycam_project_id: job.companycam_project_id || null, state: importStateOf(job) })
}

// Batch result → HTTP response (same body shape as before prompt 84).
function respond(r) {
  switch (r.kind) {
    case 'ok': return Response.json({ imported: r.imported, skipped: r.skipped, out_of_range: r.out_of_range, failed: r.failed, next_cursor: r.next_cursor, done: r.done, stopped: r.stopped || undefined, state: { ...r.state } })
    case 'claim_lost': return alreadyRunning()
    case 'project_changed': return projectChanged()
    case 'migration': return need074(r.state ? { state: r.state } : null)
    case 'api_error': return Response.json({ error: r.error, state: r.state }, { status: r.status === 404 ? 400 : 503 })
    case 'bad_range': return Response.json({ error: r.error }, { status: 400 })
    case 'lost': return Response.json({ error: 'The import changed while this batch ran. Refresh and try again.', state: r.state || null }, { status: 409 })
    case 'no_state': return Response.json({ error: 'There is no paused import to resume.' }, { status: 400 })
    // The final save failed: nothing of this batch is saved; never answered as success.
    case 'db_error': return Response.json(r.state ? { error: r.error || 'Import failed', state: r.state } : { error: r.error || 'Import failed' }, { status: 500 })
    default: return Response.json({ error: r.error || 'Import failed', state: r.state || null }, { status: 500 })
  }
}

const STOPPABLE = ['queued', 'running', 'paused']

async function stopRun(auth, job) {
  const pid = job.companycam_project_id
  let prev = importStateOf(job)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (prev?.status === 'stopped') return Response.json({ stopped: true, state: prev })
    if (!prev || !STOPPABLE.includes(prev.status)) return Response.json({ error: 'There is no import running to stop.' }, { status: 400 })
    const at = new Date().toISOString()
    const next = { ...prev, status: 'stopped', stopped_by: auth.userId, stopped_at: at, updated_at: at, updated_by: auth.userId }
    const r = await casImportState(adminSupabase, job.id, pid, prev, next)
    if (r.error) return isMissingColumnError(r.error) ? need074() : Response.json({ error: r.error.message }, { status: 500 })
    if (r.ok) return Response.json({ stopped: true, state: next })
    // A batch saved in between: re-read and try again on what is there now.
    const { data: cur, error } = await adminSupabase.from('jobs').select('companycam_project_id, companycam_import_state').eq('id', job.id).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!cur || String(cur.companycam_project_id ?? '') !== String(pid)) return projectChanged()
    prev = importStateOf(cur)
  }
  return Response.json({ error: 'The import is busy. Try Stop again.' }, { status: 409 })
}

export async function POST(request) {
  const started = Date.now()
  const body = await request.json().catch(() => null)
  const jobId = body?.job_id
  const { auth, response } = await gate(request, jobId)
  if (response) return response

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  if (!hasCcColumn(job) || !('companycam_import_state' in job)) return need074()
  const pid = job.companycam_project_id
  if (!pid) return Response.json({ error: 'Link a CompanyCam project first' }, { status: 400 })

  const prev = importStateOf(job)
  if (body?.stop === true) return stopRun(auth, job)

  const batchOpts = { actorId: auth.userId, startedAt: started, budgetMs: TIME_BUDGET_MS }
  const now = () => new Date().toISOString()
  // Write `queued` (compare-and-set on what was read), then run one batch from it.
  const queueThenRun = async queued => {
    const w = await casImportState(adminSupabase, jobId, pid, prev, queued)
    if (w.error) return isMissingColumnError(w.error) ? need074() : Response.json({ error: w.error.message }, { status: 500 })
    if (!w.ok) return alreadyRunning()
    const r = await runCcImportBatch(adminSupabase, { ...job, companycam_import_state: queued }, batchOpts)
    if (r.kind === 'claim_lost') {
      // Our 'queued' was saved, then a cron tick claimed it first: the run is going. Answer with
      // what is saved now (fall back to the queued state if the re-read fails).
      const { data: cur } = await adminSupabase.from('jobs').select('companycam_import_state').eq('id', jobId).maybeSingle()
      return Response.json({ queued: true, state: importStateOf(cur) || queued })
    }
    return respond(r)
  }

  if (body?.resume === true) {
    if (!prev || prev.status === 'done') return Response.json({ error: 'There is no paused import to resume.' }, { status: 400 })
    const range = validateImportRange({ start_date: prev.start_date, end_date: prev.end_date })
    if (!range.ok) return Response.json({ error: range.error }, { status: 400 })
    if (isImportRunning(prev)) return alreadyRunning()
    const at = now()
    return queueThenRun({ ...baseFromState(prev), ...IMPORT_FAILURES_CLEARED, background: true, status: 'queued', last_error: null, started_by: prev.started_by ?? auth.userId, started_at: prev.started_at ?? at, updated_at: at, updated_by: auth.userId })
  }

  const range = validateImportRange({ start_date: body?.start_date, end_date: body?.end_date })
  if (!range.ok) return Response.json({ error: range.error }, { status: 400 })
  if (isImportRunning(prev)) return alreadyRunning()
  const fresh = { start_date: range.start, end_date: range.end, cursor: null, imported: 0, skipped: 0, failed: 0, page_done_ids: [] }

  if (body?.background === true) {
    const at = now()
    return queueThenRun({ ...fresh, background: true, status: 'queued', started_by: auth.userId, started_at: at, last_error: null, updated_at: at, updated_by: auth.userId })
  }
  // Old shape: claim straight from what was read and run one batch.
  return respond(await runCcImportBatch(adminSupabase, job, { ...batchOpts, base: fresh }))
}
