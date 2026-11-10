import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import { validateDailyReportInput, buildDailyReportRow, buildDeliveriesFromMaterials } from '../../../lib/daily-report-payload'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Daily report filed from the job page (commercial + residential). The field app keeps
// its own browser insert; this route exists because daily_reports RLS is open, so job
// assignment must be enforced here.
// Job rule: principal/admin any job; pm/apm/super only on their job (denyUnlessOnJob).
// super_id is the session user — never taken from the body. Same day twice is allowed
// (matches field). Logged materials also become received deliveries, like field; a
// deliveries failure does not undo the report. No email / notify (field sends none).
// POST { job_id, report_date, work_performed, ...logs, photos } → { ok, report, warning? }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const v = validateDailyReportInput(body)
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const denied = await denyUnlessOnJob(adminSupabase, auth, body.job_id.trim())
  if (denied) return denied

  const row = buildDailyReportRow({ authUserId: auth.userId, body })
  const { data: report, error } = await adminSupabase.from('daily_reports').insert(row).select().single()
  if (error) return Response.json({ error: `Could not save daily report: ${error.message}` }, { status: 500 })

  let warning
  const deliveries = buildDeliveriesFromMaterials(row.job_id, auth.userId, row.report_date, body.materials_delivered)
  if (deliveries.length) {
    const { error: delErr } = await adminSupabase.from('deliveries').insert(deliveries)
    if (delErr) warning = `Report saved, but the delivered materials were not added to Deliveries: ${delErr.message}`
  }

  return Response.json({ ok: true, report, ...(warning ? { warning } : {}) })
}
