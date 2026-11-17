import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { isDraftReport, canReopenReport, canSeeAllDrafts, has076 } from '../../../../lib/daily-report-payload'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { loadReport, REOPEN_ROLE_MESSAGE, REOPEN_AUTHOR_MESSAGE, REOPEN_MIGRATION_MESSAGE, REOPEN_076_MESSAGE } from '../../../../lib/daily-report-server'
import { logChange } from '../../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { id } — reopen a FINAL daily report (prompt 85, Peyton's decision 2; history prompt 86).
// Who: Owner (principal) / admin any job; PM on the job. Super (prompt 89) on an assigned job,
// and only a final they wrote (403 otherwise). APMs cannot reopen (403).
// Effect: status back to 'draft', reopened_at / reopened_by stamped, finalized_at /
// finalized_by CLEARED (migration 075's CHECK keeps draft rows free of finalize stamps).
// The report drops out of the owner portal, owner photos and weather-day counts until it is
// finalized again. Deliveries already created are kept (createDeliveriesOnce never duplicates).
// History (prompt 86, migration 076): 076's BEFORE UPDATE trigger snapshots the whole final
// row into daily_report_versions IN THE SAME STATEMENT as this update — if the snapshot fails,
// the reopen fails (500, nothing changed). first_finalized_* / revision_count are kept by the
// trigger, not here. A change_log entry (status final → draft) is written after success;
// logChange never throws, and the snapshot is already committed.
// Already a draft → 409. Before 075 → 409 migration_required '075'. Before 076 → 409
// migration_required '076' (no reopen without a snapshot).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canReopenReport(auth.role)) return Response.json({ error: REOPEN_ROLE_MESSAGE }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { report, response } = await loadReport(adminSupabase, body?.id)
  if (response) return response
  const denied = await denyUnlessOnJob(adminSupabase, auth, report.job_id)
  if (denied) return denied
  // Prompt 89 addendum: a super reopens only their own report (same author check as editing),
  // so a reopened draft is never left that nobody on site can edit.
  if (!canSeeAllDrafts(auth.role) && report.super_id !== auth.userId) return Response.json({ error: REOPEN_AUTHOR_MESSAGE }, { status: 403 })
  if (isDraftReport(report)) return Response.json({ error: 'This report is already a draft.' }, { status: 409 })
  // Row without a status column → 075 itself is missing (and so is 076).
  if (!Object.prototype.hasOwnProperty.call(report, 'status')) return Response.json({ error: REOPEN_MIGRATION_MESSAGE, migration_required: '075' }, { status: 409 })
  if (!has076(report)) return Response.json({ error: REOPEN_076_MESSAGE, migration_required: '076' }, { status: 409 })

  const now = new Date().toISOString()
  const { data: rows, error } = await adminSupabase.from('daily_reports')
    .update({ status: 'draft', finalized_at: null, finalized_by: null, reopened_at: now, reopened_by: auth.userId, updated_at: now })
    .eq('id', report.id).eq('status', 'final').select()
  if (error && isMissingColumnError(error)) return Response.json({ error: REOPEN_MIGRATION_MESSAGE, migration_required: '075' }, { status: 409 })
  if (error) return Response.json({ error: 'Could not reopen the daily report — its earlier version could not be saved, so nothing was changed. ' + error.message }, { status: 500 })
  if (!rows || rows.length === 0) return Response.json({ error: 'This report is already a draft (or needs database migration 075).' }, { status: 409 })
  await logChange({
    job_id: report.job_id, entity_type: 'daily_report', entity_id: report.id, field_name: 'status',
    old_value: 'final', new_value: 'draft', changed_by: auth.userId,
    note: `Reopened the final report for ${report.report_date}; saved as version rev ${report.revision_count ?? 0}`,
  })
  return Response.json({ ok: true, report: rows[0] })
}
