// Server-only. RFI emails + bell notifications.
//  - notifyRfiSubmitted: "new RFI" email to the job's PMs. Used by /api/rfi-notify
//    (field / super RFIs, called from the browser) and /api/rfis (sub RFIs,
//    called server-side after the insert, because /api/rfi-notify is office-only).
//  - notifyRfiAnswered: "your RFI was answered" email + bell to the submitter
//    (super and/or sub). Used by /api/rfi-actions.
// profiles has no email column; emails come from auth.users via the admin API.
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { escapeHtml } from './email'
import { notify } from './notify'
import { jobPmUserIds } from './lookahead-recipients'

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

// Trimmed, non-empty, de-duplicated (case-insensitive), first spelling kept.
export function dedupeEmails(list) {
  const seen = new Set()
  const out = []
  for (const raw of list || []) {
    const e = String(raw || '').trim()
    const key = e.toLowerCase()
    if (!e || seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

// auth.users email for a user id, or null. Never throws.
export async function authEmailById(userId) {
  if (!userId) return null
  try {
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId)
    if (error) return null
    return data?.user?.email || null
  } catch {
    return null
  }
}

// Who gets the new-RFI email: jobs.pm_email plus the office users assigned to
// the job (pm_job_assignments via jobPmUserIds), de-duplicated. pm_email is
// always kept even if the assignment lookup fails.
export async function rfiPmEmails(job) {
  let assignedEmails = []
  try {
    // pm_email: null — that address is added directly below, no user lookup needed
    const ids = await jobPmUserIds({ id: job.id, pm_email: null })
    assignedEmails = await Promise.all(ids.map(authEmailById))
  } catch (e) {
    console.error('[rfi-notify] assigned PM lookup failed', e?.message)
  }
  return dedupeEmails([job.pm_email, ...assignedEmails])
}

// "From" label for an RFI in the office list: "Name (Company)" for a sub,
// "Name (Super)" for a superintendent. profilesById: { id: { full_name,
// company_id, company_name } }, companiesById: { id: name }.
export function rfiSubmitterLabel(rfi, profilesById = {}, companiesById = {}) {
  if (rfi?.sub_id) {
    const p = profilesById[rfi.sub_id]
    const person = p?.full_name || 'Subcontractor'
    const company = (p?.company_id && companiesById[p.company_id]) || p?.company_name || null
    return company && company !== person ? `${person} (${company})` : person
  }
  if (rfi?.super_id) {
    const p = profilesById[rfi.super_id]
    return `${p?.full_name || 'Superintendent'} (Super)`
  }
  return null
}

// Emails the job's PMs about a new RFI. Never throws.
export async function notifyRfiSubmitted({ job_id, title, description, submitter_name }) {
  try {
    const { data: job } = await adminSupabase
      .from('jobs').select('id, project_name, job_number, pm_email').eq('id', job_id).single()
    if (!job) return { ok: false, reason: 'job not found' }
    const to = await rfiPmEmails({ ...job, id: job.id || job_id })
    if (!to.length) return { ok: false, reason: 'no PM email for job' }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
    const jobLabel = `#${job.job_number} — ${job.project_name}`
    const html = wrapRfiEmail(`
        <h2 style="color:#f1f1f1;margin:0 0 1rem">New RFI Submitted</h2>
        <p style="color:#aaa"><strong style="color:#f1f1f1">${escapeHtml(submitter_name)}</strong> submitted an RFI on <strong style="color:#f1f1f1">${escapeHtml(jobLabel)}</strong>.</p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0">
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Subject</p>
          <p style="color:#f1f1f1;font-weight:700;margin:0 0 ${description ? '12px' : '0'}">${escapeHtml(title)}</p>
          ${description ? `<p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Description</p><p style="color:#aaa;font-size:13px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(description)}</p>` : ''}
        </div>
        <a href="${siteUrl}/jobdetail?id=${encodeURIComponent(job_id)}&tab=field" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">View RFI &amp; Respond</a>
      `)
    const subject = `New RFI: ${title} — ${jobLabel}`
    // One email per recipient so one bad address doesn't sink the rest
    const results = await Promise.all(to.map(async addr => {
      try {
        const { error } = await sendRfiMail(addr, subject, html)
        return error ? `${addr}: ${error.message || error}` : null
      } catch (e) {
        return `${addr}: ${e.message}`
      }
    }))
    const errors = results.filter(Boolean)
    return { ok: !errors.length, emailError: errors.join('; ') || null, sentTo: to }
  } catch (e) {
    return { ok: false, emailError: e.message }
  }
}

// After a PM answers an RFI: email + bell to whoever submitted it — the super
// (super_id → /field) and/or the sub (sub_id → /submit). Never throws.
// Returns { ok, results: [{ user_id, email, emailError }] }.
export async function notifyRfiAnswered(rfi, response) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const recipients = []
  if (rfi?.super_id) recipients.push({ user_id: rfi.super_id, portal: '/field', portalName: 'Field Portal' })
  if (rfi?.sub_id && rfi.sub_id !== rfi.super_id) recipients.push({ user_id: rfi.sub_id, portal: '/submit', portalName: 'Sub Portal' })

  const results = await Promise.all(recipients.map(async r => {
    // Bell first: it doesn't depend on finding an email
    await notify({
      recipient_id: r.user_id,
      type:         'rfi_answered',
      title:        `RFI answered: ${rfi.title}`,
      body:         response ? String(response).slice(0, 120) : null,
      link:         'rfis',
      job_id:       rfi.job_id || null,
      entity_type:  'rfi',
      entity_id:    rfi.id || null,
      dedup_key:    rfi.id ? `rfi:answered:${rfi.id}` : null,
    })
    const email = await authEmailById(r.user_id)
    if (!email) return { user_id: r.user_id, email: null, emailError: 'no email for user' }
    try {
      const { error } = await sendRfiMail(email, `RFI Answered: ${rfi.title}`, wrapRfiEmail(`
        <h2 style="color:#4ade80;margin:0 0 1rem">Your RFI Has Been Answered</h2>
        <p style="color:#aaa">A response has been posted for your RFI: <strong style="color:#f1f1f1">${escapeHtml(rfi.title)}</strong></p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:1rem;margin:1rem 0">
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Response</p>
          <p style="color:#f1f1f1;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(response)}</p>
        </div>
        <a href="${siteUrl}${r.portal}" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">View in ${r.portalName}</a>
      `))
      return { user_id: r.user_id, email, emailError: error ? (error.message || String(error)) : null }
    } catch (e) {
      return { user_id: r.user_id, email, emailError: e.message }
    }
  }))
  return { ok: results.every(r => !r.emailError), results }
}
