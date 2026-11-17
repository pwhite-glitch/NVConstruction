import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import {
  validateDailyReportInput, buildDailyReportRow, buildDraftPatch, wantsFinalize,
  draftStatusFields, finalStatusFields, isDraftReport, MIGRATION_075_MESSAGE,
  mergeDraftBody, pickDraftPatch, changedFields,
} from '../../../lib/daily-report-payload'
import { loadReport, createDeliveriesOnce, mayManageReport, FINALIZED_MESSAGE, NOT_AUTHOR_MESSAGE } from '../../../lib/daily-report-server'
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
