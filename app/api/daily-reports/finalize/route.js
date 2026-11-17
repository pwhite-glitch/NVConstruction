import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { isDraftReport, finalStatusFields } from '../../../../lib/daily-report-payload'
import { loadReport, createDeliveriesOnce, mayManageReport, NOT_AUTHOR_MESSAGE } from '../../../../lib/daily-report-server'
import { logChange } from '../../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { id } — "Finalize – 100% complete" (prompt 85). Publishes a draft: status 'final',
// finalized_at / finalized_by stamped; the report becomes visible to the owner portal,
// weather-day counts and photo galleries. Logged materials become received deliveries —
// only those with no delivery for this report yet (first finalize, or materials added while
// the report was reopened); never duplicated.
// Who: the draft's author, or Owner / admin / PM, on the job (requirePM + denyUnlessOnJob).
// Already final → { ok, report, already_final: true } for those same people (no deliveries).
// work_performed must not be blank. No email / notify.
// Re-finalize after a reopen (prompt 86): logged to change_log (status draft → final).
// first_finalized_* and revision_count belong to migration 076's trigger — never written here.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { report, response } = await loadReport(adminSupabase, body?.id)
  if (response) return response
  const denied = await denyUnlessOnJob(adminSupabase, auth, report.job_id)
  if (denied) return denied
  if (!mayManageReport(auth, report)) return Response.json({ error: NOT_AUTHOR_MESSAGE }, { status: 403 })

  if (!isDraftReport(report)) return Response.json({ ok: true, report, already_final: true })
  if (typeof report.work_performed !== 'string' || !report.work_performed.trim()) {
    return Response.json({ error: 'Work performed is required.' }, { status: 400 })
  }

  const now = new Date()
  const { data: rows, error } = await adminSupabase.from('daily_reports')
    .update({ ...finalStatusFields(auth.userId, now), updated_at: now.toISOString() })
    .eq('id', report.id).eq('status', 'draft').select()
  if (error) return Response.json({ error: `Could not finalize the daily report: ${error.message}` }, { status: 500 })
  if (!rows || rows.length === 0) {
    // Finalized by someone else between our read and write.
    const again = await loadReport(adminSupabase, report.id)
    if (again.response) return again.response
    return Response.json({ ok: true, report: again.report, already_final: true })
  }
  const finalReport = rows[0]
  if (report.reopened_at) {
    await logChange({
      job_id: report.job_id, entity_type: 'daily_report', entity_id: report.id, field_name: 'status',
      old_value: 'draft', new_value: 'final', changed_by: auth.userId,
      note: `Re-finalized the report for ${finalReport.report_date} (rev ${finalReport.revision_count ?? '?'})`,
    })
  }
  const d = await createDeliveriesOnce(adminSupabase, finalReport, auth.userId, now)
  return Response.json({ ok: true, report: finalReport, ...(d.warning ? { warning: d.warning } : {}) })
}
