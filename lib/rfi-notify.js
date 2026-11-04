// Server-only. The "new RFI" email to the job's PM. Used by /api/rfi-notify
// (field / super RFIs, called from the browser) and /api/rfis (sub RFIs,
// called server-side after the insert, because /api/rfi-notify is office-only).
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { escapeHtml } from './email'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export function wrapRfiEmail(body) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;padding:2rem;border-radius:12px;border:1px solid #222"><div style="margin-bottom:1.5rem"><span style="font-weight:800;font-size:15px;color:#e8590c;letter-spacing:2px;text-transform:uppercase">NV Construction</span></div>${body}<div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #222;font-size:12px;color:#555">NV Construction · Project Management</div></div>`
}

export async function sendRfiMail(to, subject, html) {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to, subject, html,
  })
  return { data, error }
}

// Emails jobs.pm_email about a new RFI. Never throws.
export async function notifyRfiSubmitted({ job_id, title, description, submitter_name }) {
  try {
    const { data: job } = await adminSupabase
      .from('jobs').select('project_name, job_number, pm_email').eq('id', job_id).single()
    if (!job?.pm_email) return { ok: false, reason: 'no pm_email on job' }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
    const jobLabel = `#${job.job_number} — ${job.project_name}`
    const { error: emailErr } = await sendRfiMail(job.pm_email, `New RFI: ${title} — ${jobLabel}`, wrapRfiEmail(`
        <h2 style="color:#f1f1f1;margin:0 0 1rem">New RFI Submitted</h2>
        <p style="color:#aaa"><strong style="color:#f1f1f1">${escapeHtml(submitter_name)}</strong> submitted an RFI on <strong style="color:#f1f1f1">${escapeHtml(jobLabel)}</strong>.</p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0">
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Subject</p>
          <p style="color:#f1f1f1;font-weight:700;margin:0 0 ${description ? '12px' : '0'}">${escapeHtml(title)}</p>
          ${description ? `<p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Description</p><p style="color:#aaa;font-size:13px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(description)}</p>` : ''}
        </div>
        <a href="${siteUrl}/jobdetail?id=${encodeURIComponent(job_id)}&tab=field" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">View RFI &amp; Respond</a>
      `))
    return { ok: !emailErr, emailError: emailErr?.message || null, sentTo: job.pm_email }
  } catch (e) {
    return { ok: false, emailError: e.message }
  }
}
