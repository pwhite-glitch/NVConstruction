import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from '../../../../lib/server-auth'
import { buildMaintenanceReportHtml } from '../../../../lib/maintenance-report-print'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'
const REPORT_RECIPIENTS = ['vivek@nvim.co', 'pwhite@nvim.co']

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { report_id } = body
  if (!report_id) return Response.json({ error: 'report_id required' }, { status: 400 })

  const { data: report, error: fetchErr } = await adminSupabase
    .from('maintenance_reports')
    .select('*')
    .eq('id', report_id)
    .maybeSingle()

  if (fetchErr || !report) return Response.json({ error: 'Report not found' }, { status: 404 })

  if (report.performed_by !== auth.userId && !['pm', 'apm', 'admin'].includes(auth.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const paths = (report.photos || []).map(p => p.path || p).filter(Boolean)
  let signedUrls = {}
  if (paths.length) {
    const { data } = await adminSupabase.storage
      .from('daily-report-photos')
      .createSignedUrls(paths, 3600)
    if (data) paths.forEach((path, i) => {
      if (data[i]?.signedUrl) signedUrls[path] = data[i].signedUrl
    })
  }

  // Strip the auto-print script before sending as email
  const html = buildMaintenanceReportHtml(report, signedUrls)
    .replace(/<script>window\.onload[^<]*<\/script>/, '')

  const dateStr = report.report_date
    ? new Date(report.report_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  await resend.emails.send({
    from: FROM,
    to: REPORT_RECIPIENTS,
    subject: `Maintenance Report — ${report.equipment_name}${dateStr ? ` — ${dateStr}` : ''}`,
    html,
  })

  return Response.json({ ok: true })
}
