import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { emailWrap, escapeHtml } from '../../../../lib/email'
import { buildDailyReportPdf } from '../../../../lib/daily-report-pdf'
import { streamedBytesResponse } from '../../../../lib/stream-response'
import {
  canExportReports, EXPORT_ROLE_MESSAGE, validateRecipients, validateMessage, defaultSubject, exportFilename,
  datesLabel, jobTitle, EMAIL_MAX_PDF_BYTES, isValidRecipient,
} from '../../../../lib/daily-report-export'
import {
  resolveExportReports, collectReportPhotos, saveOwnerEmailIfEmpty, logReportSends, loadLatestSends,
} from '../../../../lib/daily-report-export-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>'

export const maxDuration = 60

// Daily report PDF export + "Email to owner" (prompt 92). Session-authenticated (Bearer), same as
// the other daily-report routes. Who: Owner (principal) / admin any job; PM / APM only on jobs
// they are on. Supers / subs / owner clients → 403. Only FINAL reports (drafts → 400).
//
// GET ?job_id=  → { sends: { [reportId]: { to, at, by } } } — latest successful email per report
//   (from change_log; no migration). A lookup failure returns { sends: {} } so the page simply
//   shows no "Sent to" line.
// POST { report_ids: [...] }                → application/pdf (attachment), one report or several
// POST { job_id, from, to } | { job_id, range: { from, to } } → one combined PDF of the FINAL
//   reports in that range (≤ 31 days, ≤ 31 reports), cover page first.
// POST { mode: 'email', report_ids | job_id + range, to: [...], subject?, note? }
//   → builds the same PDF and emails it (Resend, PDF attached). 1–20 valid recipients, subject
//   ≤ 200, note ≤ 2000; all user text is escaped in the HTML. No cc / bcc. Each report gets a
//   change_log entry (field 'emailed_to_owner', sent or failed). On success, an EMPTY
//   jobs.owner_email is set to the first recipient (never overwritten), logged.
//   → { ok, sent_to, reports, owner_email_saved, photos_excluded_internal }
// No auto-send, no cron.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canExportReports(auth.role)) return Response.json({ error: EXPORT_ROLE_MESSAGE }, { status: 403 })
  const jobId = (new URL(request.url).searchParams.get('job_id') || '').trim()
  if (!jobId) return Response.json({ error: 'job_id is required.' }, { status: 400 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, jobId)
  if (denied) return denied
  try {
    const { sends, error } = await loadLatestSends(adminSupabase, jobId)
    if (error) console.error('[daily-reports export GET] send log lookup failed', error.message)
    return Response.json({ sends: error ? {} : sends })
  } catch (e) {
    console.error('[daily-reports export GET]', e?.message)
    return Response.json({ sends: {} })
  }
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canExportReports(auth.role)) return Response.json({ error: EXPORT_ROLE_MESSAGE }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request.' }, { status: 400 })
  const email = body.mode === 'email'

  const resolved = await resolveExportReports(adminSupabase, auth, body)
  if (resolved.response) return resolved.response
  const { reports, job, range } = resolved
  const dates = reports.map(r => r.report_date)

  let recipients = [], subject = '', note = ''
  if (email) {
    const rv = validateRecipients(body.recipients ?? body.to)
    if (!rv.ok) return Response.json({ error: rv.error }, { status: 400 })
    recipients = rv.recipients
    const mv = validateMessage(body, defaultSubject(job, dates, range))
    if (!mv.ok) return Response.json({ error: mv.error }, { status: 400 })
    subject = mv.subject
    note = mv.note
  }

  let pdf, excludedInternal = 0
  try {
    const photos = await collectReportPhotos(adminSupabase, job, reports)
    excludedInternal = photos.excludedInternal
    pdf = await buildDailyReportPdf(reports, photos.photoData, range ? { range } : {})
  } catch (e) {
    console.error('[daily-reports export] PDF build failed', e?.message)
    return Response.json({ error: `Could not build the PDF: ${e?.message || 'unknown error'}` }, { status: 500 })
  }
  const filename = exportFilename(job, dates, range)

  if (!email) {
    return streamedBytesResponse(pdf, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Report-Count': String(reports.length),
    })
  }

  const logBase = { to: recipients, subject, range, userId: auth.userId }
  if (pdf.length > EMAIL_MAX_PDF_BYTES) {
    const error = 'The PDF is too large to email. Export a shorter date range, or download it instead.'
    await logReportSends(reports, { ...logBase, result: 'failed', error: 'PDF too large to email' })
    return Response.json({ error }, { status: 413 })
  }

  const { data: me } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
  const sender = (typeof me?.full_name === 'string' && me.full_name.trim()) || auth.email || ''
  const project = jobTitle(job)
  const n = reports.length
  const html = emailWrap(`
      <h2 style="color:#f1f1f1;margin:0 0 8px;font-size:18px">${escapeHtml(subject)}</h2>
      <p style="color:#aaa;margin:0 0 16px;font-size:14px;line-height:1.6">
        The daily report${n === 1 ? '' : 's'} for <strong style="color:#f1f1f1">${escapeHtml(project)}</strong>
        (${escapeHtml(datesLabel(dates, range || {}))}) ${n === 1 ? 'is' : 'are'} attached as a PDF.
      </p>
      ${note ? `<div style="color:#ddd;margin:0 0 16px;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(note)}</div>` : ''}
      ${sender ? `<p style="color:#777;font-size:12px;margin:0">Sent by ${escapeHtml(sender)}</p>` : ''}
    `)

  let sendError = null
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
      ...(isValidRecipient(auth.email || '') ? { replyTo: auth.email } : {}),
      attachments: [{ filename, content: Buffer.from(pdf) }],
    })
    if (error) sendError = error.message || 'the email provider refused the message'
  } catch (e) {
    sendError = e?.message || 'the email provider could not be reached'
  }

  if (sendError) {
    await logReportSends(reports, { ...logBase, result: 'failed', error: sendError })
    return Response.json({ error: `Email not sent: ${sendError}` }, { status: 502 })
  }
  await logReportSends(reports, { ...logBase, result: 'sent' })
  const owner = await saveOwnerEmailIfEmpty(adminSupabase, job, recipients[0], auth.userId)
  return Response.json({
    ok: true, sent_to: recipients, reports: n, owner_email_saved: owner.saved ? owner.email : null,
    photos_excluded_internal: excludedInternal,
  })
}
