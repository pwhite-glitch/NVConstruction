import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { isDraftReport, canReopenReport } from '../../../../lib/daily-report-payload'
import { isMissingColumnError } from '../../../../lib/missing-column-retry'
import { loadReport, REOPEN_ROLE_MESSAGE, REOPEN_MIGRATION_MESSAGE } from '../../../../lib/daily-report-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { id } — reopen a FINAL daily report (prompt 85, Peyton's decision 2).
// Who: Owner (principal) / admin any job; PM on the job. Supers and APMs cannot reopen (403).
// Effect: status back to 'draft', reopened_at / reopened_by stamped, finalized_at /
// finalized_by CLEARED (migration 075's CHECK keeps draft rows free of finalize stamps;
// reopened_at records that it had been final). The report drops out of the owner portal,
// owner photos and weather-day counts until it is finalized again. Deliveries already
// created are kept; the next finalize adds deliveries only for materials that have none
// yet (createDeliveriesOnce), so nothing is duplicated.
// Already a draft → 409. Before migration 075 → 409 { error, migration_required: '075' }.
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
  if (isDraftReport(report)) return Response.json({ error: 'This report is already a draft.' }, { status: 409 })

  const now = new Date().toISOString()
  const { data: rows, error } = await adminSupabase.from('daily_reports')
    .update({ status: 'draft', finalized_at: null, finalized_by: null, reopened_at: now, reopened_by: auth.userId, updated_at: now })
    .eq('id', report.id).eq('status', 'final').select()
  if (error && isMissingColumnError(error)) return Response.json({ error: REOPEN_MIGRATION_MESSAGE, migration_required: '075' }, { status: 409 })
  if (error) return Response.json({ error: `Could not reopen the daily report: ${error.message}` }, { status: 500 })
  if (!rows || rows.length === 0) return Response.json({ error: 'This report is already a draft (or needs database migration 075).' }, { status: 409 })
  return Response.json({ ok: true, report: rows[0] })
}
