import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import {
  validateDailyReportInput, buildDailyReportRow, buildDraftPatch, wantsFinalize,
  draftStatusFields, finalStatusFields, isDraftReport, MIGRATION_075_MESSAGE,
  mergeDraftBody, pickDraftPatch, changedFields,
} from '../../../lib/daily-report-payload'
import {
  loadReport, createDeliveriesOnce, mayManageReport, FINALIZED_MESSAGE, NOT_AUTHOR_MESSAGE,
  canDeleteReport, DELETE_AUTHOR_MESSAGE, unlinkReportDeliveries,
} from '../../../lib/daily-report-server'
import { removeReportOnlyPhotoFiles } from '../../../lib/report-photo-links'
import { isMissingColumnError } from '../../../lib/missing-column-retry'
import { logChange } from '../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Daily reports — field app (supers / APMs) and job pages (Owner / admin / PM / APM).
// daily_reports RLS cannot see job assignment, so the job rule is enforced here:
// principal/admin any job; pm/apm/super only on their job (denyUnlessOnJob).
// super_id is the session user — never taken from the body. Same day twice is allowed.
// No email / notify (field sends none).
//
// Prompt 85 (migration 075): a report is a DRAFT until finalized.
//   POST { job_id, report_date, ...fields, finalize?: true | status?: 'final' }
//     finalize → inserted as final (work_performed required) and logged materials become
//                received deliveries (once). A deliveries failure does not undo the report.
//     otherwise → inserted as a draft (work_performed may be blank); no deliveries.
//     Before 075: a draft → 503 MIGRATION_075_MESSAGE (nothing saved); a finalize → the
//     pre-075 insert (no status columns), same as today.
//   PATCH { id, ...fields } — edit a draft. Author, or Owner / admin / PM on the job.
//     Partial: only the keys sent change; omitted fields keep their stored values.
//     404 missing · 403 not on the job / not allowed · 409 already final. No deliveries.
//     A REOPENED report (reopened_at set — it was final before, prompt 86) logs each changed
//     content field to change_log (entity_type 'daily_report', old / new). Never-finalized
//     drafts are not logged.
// Finalize an existing draft: POST /api/daily-reports/finalize. Reopen: /reopen.
// Prompt 91: DELETE { id } — permanent, logged delete (see DELETE below).
// → { ok, report, warning? }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const finalize = wantsFinalize(body)
  const v = validateDailyReportInput(body, { draft: !finalize })
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const denied = await denyUnlessOnJob(adminSupabase, auth, body.job_id.trim())
  if (denied) return denied

  const now = new Date()
  const base = buildDailyReportRow({ authUserId: auth.userId, body, draft: !finalize })
  const row = { ...base, ...(finalize ? finalStatusFields(auth.userId, now) : draftStatusFields()), updated_at: now.toISOString() }
  let { data: report, error } = await adminSupabase.from('daily_reports').insert(row).select().single()
  if (error && isMissingColumnError(error)) {
    if (!finalize) return Response.json({ error: MIGRATION_075_MESSAGE, migration_required: '075' }, { status: 503 })
    // Pre-075: publish exactly like before (the row is official as soon as it exists).
    ;({ data: report, error } = await adminSupabase.from('daily_reports').insert(base).select().single())
  }
  if (error) return Response.json({ error: `Could not save daily report: ${error.message}` }, { status: 500 })

  let warning
  if (finalize) {
    const d = await createDeliveriesOnce(adminSupabase, report, auth.userId, now)
    warning = d.warning
  }
  return Response.json({ ok: true, report, ...(warning ? { warning } : {}) })
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request.' }, { status: 400 })

  const { report, response } = await loadReport(adminSupabase, body.id)
  if (response) return response
  const denied = await denyUnlessOnJob(adminSupabase, auth, report.job_id)
  if (denied) return denied
  if (body.job_id != null && String(body.job_id).trim() !== String(report.job_id)) return Response.json({ error: 'This report belongs to a different project.' }, { status: 403 })
  if (!isDraftReport(report)) return Response.json({ error: FINALIZED_MESSAGE }, { status: 409 })
  if (!mayManageReport(auth, report)) return Response.json({ error: NOT_AUTHOR_MESSAGE }, { status: 403 })

  // Partial update: only keys present in the body change; omitted fields keep the stored value.
  const merged = mergeDraftBody(report, body)
  const v = validateDailyReportInput(merged, { draft: true })
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const patch = { ...pickDraftPatch(buildDraftPatch(merged), body), updated_at: new Date().toISOString() }
  // Only while it is still a draft (a finalize racing this edit wins; the edit gets 409).
  const { data: rows, error } = await adminSupabase.from('daily_reports').update(patch).eq('id', report.id).eq('status', 'draft').select()
  if (error) return Response.json({ error: `Could not save daily report: ${error.message}` }, { status: 500 })
  if (!rows || rows.length === 0) return Response.json({ error: FINALIZED_MESSAGE }, { status: 409 })
  if (report.reopened_at) {
    for (const c of changedFields(report, patch)) {
      await logChange({
        job_id: report.job_id, entity_type: 'daily_report', entity_id: report.id, field_name: c.field,
        old_value: c.old_value, new_value: c.new_value, changed_by: auth.userId,
        note: `Edited reopened report for ${rows[0].report_date}`,
      })
    }
  }
  return Response.json({ ok: true, report: rows[0] })
}

// DELETE { id } (JSON body) or ?id= — permanently delete a daily report, draft or final
// (prompt 91; Peyton 11/18: "Delete permanently, no recovery").
// Who (canDeleteReport): Owner (principal) / admin any job; PM / APM any report on a job they
// are on; Super only a report they wrote, on a job they are on (403 DELETE_AUTHOR_MESSAGE).
// Subs, owner clients, sales and anyone else: 403 (requirePM).
// 401 no token · 404 unknown id (also a second delete of the same id) · 403 not allowed.
// Order:
//   1. change_log entry FIRST (entity_type 'daily_report', field_name 'deleted', old_value =
//      the whole row as JSON). If it cannot be written, nothing is deleted (500) — the
//      snapshot is the only record left after a hard delete.
//   2. Deliveries are KEPT: daily_report_id is cleared on rows linked to this report (no FK).
//      Legacy deliveries (daily_report_id NULL, matched by received_date) are untouched.
//   3. The row is hard-deleted with the service role (no soft-delete column). Its
//      daily_report_versions rows go with it (migration 076: ON DELETE CASCADE).
//      Weather-delay days are counted live from daily_reports (lib/contract-time.js
//      weatherDelayCount / weatherDelayRows — no stored count), so they drop at once on the
//      job page, the weather-day log PDF and the owner view.
//   4. Storage objects of photos uploaded directly to the report (no job_photo_id) are removed
//      best effort (same rule as /api/delete-photo); a storage error is logged, not returned.
//      job_photos rows and their files are never touched.
// If step 2 or 3 fails after the log entry, a second entry records that the report was kept.
// → { ok, id, deliveries_kept, files_removed, files_kept, warning? }
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let id = new URL(request.url).searchParams.get('id')
  if (!id) {
    let body = null
    try {
      const text = await request.text()
      body = text ? JSON.parse(text) : null
    } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
    id = body && typeof body === 'object' && !Array.isArray(body) ? body.id : null
  }

  const { report, response } = await loadReport(adminSupabase, id)
  if (response) return response
  const denied = await denyUnlessOnJob(adminSupabase, auth, report.job_id)
  if (denied) return denied
  if (!canDeleteReport(auth, report)) return Response.json({ error: DELETE_AUTHOR_MESSAGE }, { status: 403 })

  const logged = await logChange({
    job_id: report.job_id, entity_type: 'daily_report', entity_id: report.id, field_name: 'deleted',
    old_value: JSON.stringify(report), new_value: null, changed_by: auth.userId,
    note: `Deleted daily report for ${report.report_date}`,
  })
  if (logged && logged.ok === false) return Response.json({ error: `Could not record the deletion in the change history, so nothing was deleted. ${logged.error || ''}`.trim() }, { status: 500 })
  const logKept = msg => logChange({
    job_id: report.job_id, entity_type: 'daily_report', entity_id: report.id, field_name: 'delete_failed',
    old_value: null, new_value: null, changed_by: auth.userId,
    note: `Delete of the daily report for ${report.report_date} did not complete; the report was kept. ${msg}`.trim(),
  })

  // Legacy deliveries (no daily_report_id; select('*') so a pre-075 table works) — kept and
  // untouched, only counted for the response. Counted BEFORE the unlink, or the rows just
  // unlinked (now daily_report_id NULL, same date) would be counted twice.
  const legacy = await adminSupabase.from('deliveries').select('*').eq('job_id', report.job_id).eq('source', 'daily_report').eq('received_date', report.report_date)
  const legacyCount = !legacy.error && Array.isArray(legacy.data) ? legacy.data.filter(d => d && d.daily_report_id == null).length : 0

  const unlink = await unlinkReportDeliveries(adminSupabase, report)
  if (unlink.error) {
    await logKept(unlink.error.message)
    return Response.json({ error: `Could not detach this report's deliveries, so nothing was deleted. ${unlink.error.message}` }, { status: 500 })
  }

  const { data: gone, error } = await adminSupabase.from('daily_reports').delete().eq('id', report.id).select('id')
  if (error) {
    await logKept(error.message)
    return Response.json({ error: `Could not delete the daily report: ${error.message}` }, { status: 500 })
  }
  if (!gone || gone.length === 0) return Response.json({ error: 'Daily report not found.' }, { status: 404 })

  // Best effort, after the row is gone: a storage error never fails the delete.
  let files = { removed: [], kept: [], errors: [] }
  try { files = await removeReportOnlyPhotoFiles(adminSupabase, report) } catch (e) { files.errors.push(e?.message || String(e)) }
  if (files.errors.length) console.error('[daily-reports DELETE] photo storage removal failed', report.id, files.errors)

  return Response.json({
    ok: true, id: report.id,
    deliveries_kept: unlink.unlinked + legacyCount,
    files_removed: files.removed.length, files_kept: files.kept.length,
    ...(files.errors.length ? { warning: 'The report was deleted, but some of its photo files could not be removed from storage.' } : {}),
  })
}
