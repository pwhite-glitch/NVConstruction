import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { atLeastPM, denyUnlessOnJob } from '../../../../lib/roles'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { ccFetch, normalizeCcPhoto, importCcPhotoToJob, recordInbox, hasCcColumn, isCcId, DOWNLOAD_BUDGET_MS } from '../../../../lib/companycam'
import { validateImportRange, inImportRange, isImportRunning } from '../../../../lib/companycam-import'

// One-time import of a linked CompanyCam project's existing photos (prompt 82, Addendum A).
// POST { job_id, start_date?, end_date?, resume? } — dates are YYYY-MM-DD in America/Chicago.
// Each call runs ONE time-boxed batch (page limit 20, no new downloads after ~35 s, each
// CompanyCam call / download capped at 15 s) and saves the cursor + counts in
// jobs.companycam_import_state, so a run survives a closed page.
//   Every state save is compare-and-set on the job still being linked to the project the batch
//   started with; after a relink / unlink the save is dropped and the call answers 409.
//   Photos that fail are recorded in companycam_photo_inbox (status 'failed') so they show on
//   the Owner's Unmatched / failed list and can be retried there.
//   resume:true → continue from the saved cursor and range; otherwise the new range resets it.
//   A second request while the state is 'running' and fresh (< 90 s) → 409. Overlapping runs
//   can't double-import anyway: unique companycam_photo_id, 23505 counts as skipped.
// Imported rows are internal_only. No Change History (photos are not job fields).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PAGE_SIZE = 20
const TIME_BUDGET_MS = DOWNLOAD_BUDGET_MS // 35 s: well under maxDuration 60
const need074 = () => Response.json({ error: 'Apply migration 074 first', migration_required: '074' }, { status: 409 })
const projectChanged = () => Response.json({ error: 'project changed', detail: 'The CompanyCam link on this job changed while the import was running. Nothing more was saved for the old project.' }, { status: 409 })

export async function POST(request) {
  const started = Date.now()
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!atLeastPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const jobId = body?.job_id
  if (!jobId || typeof jobId !== 'string') return Response.json({ error: 'job_id required' }, { status: 400 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, jobId)
  if (denied) return denied

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  if (!hasCcColumn(job) || !('companycam_import_state' in job)) return need074()
  const pid = job.companycam_project_id
  if (!pid) return Response.json({ error: 'Link a CompanyCam project first' }, { status: 400 })

  const prev = job.companycam_import_state && typeof job.companycam_import_state === 'object' ? job.companycam_import_state : null
  const resume = body?.resume === true
  let range
  let base
  if (resume) {
    if (!prev || prev.status === 'done') return Response.json({ error: 'There is no paused import to resume.' }, { status: 400 })
    range = validateImportRange({ start_date: prev.start_date, end_date: prev.end_date })
    if (!range.ok) return Response.json({ error: range.error }, { status: 400 })
    base = { start_date: range.start, end_date: range.end, cursor: prev.cursor || null, imported: Number(prev.imported) || 0, skipped: Number(prev.skipped) || 0, failed: Number(prev.failed) || 0 }
  } else {
    range = validateImportRange({ start_date: body?.start_date, end_date: body?.end_date })
    if (!range.ok) return Response.json({ error: range.error }, { status: 400 })
    base = { start_date: range.start, end_date: range.end, cursor: null, imported: 0, skipped: 0, failed: 0 }
  }
  if (isImportRunning(prev)) return Response.json({ error: 'An import is already running for this job. Try again in a minute.' }, { status: 409 })

  // Claim the run: only if the state is still what we read (no other request got in between).
  const stamp = () => ({ updated_at: new Date().toISOString(), updated_by: auth.userId })
  let claim = adminSupabase.from('jobs').update({ companycam_import_state: { ...base, status: 'running', ...stamp() } }).eq('id', jobId).eq('companycam_project_id', pid)
  claim = prev ? claim.eq('companycam_import_state', JSON.stringify(prev)) : claim.is('companycam_import_state', null)
  const { data: claimed, error: claimErr } = await claim.select('id')
  if (claimErr) return isMissingColumnError(claimErr) ? need074() : Response.json({ error: claimErr.message }, { status: 500 })
  if (!claimed?.length) return Response.json({ error: 'An import is already running for this job. Try again in a minute.' }, { status: 409 })

  // Compare-and-set on the link: → false when the job is no longer linked to `pid` (relinked or
  // unlinked mid-batch). setJobCcProject already nulled the state then; never write it back.
  const save = async state => {
    const { data, error } = await adminSupabase.from('jobs').update({ companycam_import_state: { ...state, ...stamp() } })
      .eq('id', jobId).eq('companycam_project_id', pid).select('id')
    if (error) { console.error('[companycam import] state save failed:', error.message); return true }
    return !!data?.length
  }

  const q = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (base.cursor) q.set('after', base.cursor)
  if (range.startEpoch !== null) q.set('start_date', String(range.startEpoch))
  if (range.endEpoch !== null) q.set('end_date', String(range.endEpoch))
  const list = await ccFetch(`/projects/${pid}/photos?${q.toString()}`)
  if (!list.ok) {
    if (!(await save({ ...base, status: 'paused' }))) return projectChanged()
    return Response.json({ error: `Could not read CompanyCam photos: ${list.error}` }, { status: list.status === 404 ? 400 : 503 })
  }
  const items = (Array.isArray(list.data) ? list.data : []).map(normalizeCcPhoto).filter(p => isCcId(p.id))
  const meta = list.meta || {}
  const nextCursor = meta.has_next && meta.next_cursor ? String(meta.next_cursor) : null

  const inRange = items.filter(p => inImportRange(p.capturedAt, range))
  const outOfRange = items.length - inRange.length
  const ids = inRange.map(p => p.id)
  let have = new Set()
  if (ids.length) {
    const { data, error } = await adminSupabase.from('job_photos').select('companycam_photo_id').in('companycam_photo_id', ids)
    if (error) {
      if (!(await save({ ...base, status: 'paused' }))) return projectChanged()
      return isMissingColumnError(error) ? need074() : Response.json({ error: error.message }, { status: 500 })
    }
    have = new Set((data || []).map(r => String(r.companycam_photo_id)))
  }

  let imported = 0
  let skipped = 0
  const failed = []
  let outOfTime = false
  for (const photo of inRange) {
    if (have.has(photo.id)) { skipped++; continue }
    if (Date.now() - started > TIME_BUDGET_MS) { outOfTime = true; break }
    if (!photo.projectId) photo.projectId = String(pid)
    const r = await importCcPhotoToJob(adminSupabase, { job, photo, downloadDeadline: started + TIME_BUDGET_MS })
    if (r.status === 'imported') imported++
    else if (r.status === 'duplicate') skipped++
    else if (r.migrationRequired) { if (!(await save({ ...base, status: 'paused' }))) return projectChanged(); return need074() }
    else {
      const error = r.error || 'Import failed'
      // Same as a webhook failure: the cursor moves past this page, so the inbox row is the
      // only way back to this photo (Owner's Unmatched / failed list → Assign retries it).
      const ib = await recordInbox(adminSupabase, photo, { status: 'failed', error })
      if (ib.error) console.error('[companycam import] inbox write failed:', ib.error)
      failed.push({ id: photo.id, error, inbox: !ib.error && !ib.skipped })
    }
  }

  // Out of time: keep this page's cursor so the next batch re-reads it (finished photos skip).
  const cursor = outOfTime ? base.cursor : nextCursor
  const done = !outOfTime && !nextCursor
  const state = {
    start_date: base.start_date,
    end_date: base.end_date,
    cursor: done ? null : cursor,
    imported: base.imported + imported,
    skipped: base.skipped + skipped,
    failed: base.failed + failed.length,
    status: done ? 'done' : 'paused',
  }
  if (!(await save(state))) return projectChanged()
  return Response.json({ imported, skipped, out_of_range: outOfRange, failed, next_cursor: state.cursor, done, state: { ...state } })
}
