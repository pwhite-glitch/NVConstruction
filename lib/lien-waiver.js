// Conditional lien waiver email for an approved sub billing, and the ONE writer of
// billing_submissions.lien_waiver_sent_at. Used by POST /api/lien-waiver (Send / Resend
// buttons) and by /api/billing-entry when a billing is approved, so every screen that
// approves sends the waiver the same way.
//
// Without `resend`, a billing that already has a waiver sent (or signed) is skipped, and
// the "sent" stamp is claimed BEFORE emailing (conditional on it still being blank), so two
// near-simultaneous callers (approve + an older dashboard's follow-up POST) email once.
// If the email then fails, the claim is released so a later send can try again.
import { getSiteUrl } from './site-url'
import { escapeHtml } from './email'

const SELECT = 'id, job_id, sub_id, sub_email, contact_name, company_name, amount_billed, billing_period, status, lien_waiver_sent_at, lien_waiver_signed_at, jobs(job_number, project_name, location, owner_name, owner_company)'

export function lienWaiverEmailHtml(sub, { siteUrl = getSiteUrl(), pmEmail = process.env.PM_EMAIL || 'management@nvim.co' } = {}) {
  const logo = siteUrl ? `${siteUrl}/logo.png` : ''
  const amt = parseFloat(sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const period = sub.billing_period
    ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const firstName = escapeHtml(sub.contact_name?.split(' ')[0] || 'there')
  const ownerName = escapeHtml(sub.jobs?.owner_company || sub.jobs?.owner_name || 'Project Owner')
  const jobNumber = escapeHtml(sub.jobs?.job_number ?? '')
  const projectName = escapeHtml(sub.jobs?.project_name ?? '')
  const company = escapeHtml(sub.company_name ?? '')
  const pm = escapeHtml(pmEmail)
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            ${logo ? `<img src="${logo}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Lien Waiver Required, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              Your billing of <strong style="color:#e8590c;">${amt}</strong> for <strong style="color:#f1f1f1;">#${jobNumber} — ${projectName}</strong> (${period}) has been approved. Please print, sign, and return the conditional lien waiver below before payment can be issued.
            </p>

            <!-- Lien Waiver Document -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;margin-bottom:28px;">
              <tr><td style="padding:24px 28px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Conditional Waiver and Release on Progress Payment</p>
                <p style="margin:0 0 20px;font-size:10px;color:#444;font-style:italic;">Effective upon receipt of payment in good funds</p>

                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                  <tr>
                    <td width="50%" style="padding-bottom:12px;padding-right:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Claimant</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">${company}</p>
                    </td>
                    <td width="50%" style="padding-bottom:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Hiring Party</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">NV Construction</p>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%" style="padding-bottom:12px;padding-right:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Project</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">#${jobNumber} — ${projectName}</p>
                    </td>
                    <td width="50%" style="padding-bottom:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Owner</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">${ownerName}</p>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%" style="padding-right:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Conditional Payment Amount</p>
                      <p style="margin:0;font-size:16px;font-weight:800;color:#e8590c;">${amt}</p>
                    </td>
                    <td width="50%">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Through Date</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;">${period}</p>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 16px;font-size:12px;color:#666;line-height:1.7;">
                  This document, when signed below, conditionally waives and releases any mechanic's lien, stop payment notice, or payment bond right the Claimant has for labor, services, equipment, or materials furnished to the Job through the Through Date, conditioned on receipt of the Conditional Payment Amount in good funds.
                </p>

                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                  <tr>
                    <td width="50%" style="padding-right:16px;">
                      <p style="margin:0 0 20px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Authorized Signature</p>
                      <div style="border-bottom:1px solid #444;margin-bottom:4px;height:28px;"></div>
                      <p style="margin:0;font-size:10px;color:#444;">Signature / Date</p>
                    </td>
                    <td width="50%">
                      <p style="margin:0 0 20px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Printed Name &amp; Title</p>
                      <div style="border-bottom:1px solid #444;margin-bottom:4px;height:28px;"></div>
                      <p style="margin:0;font-size:10px;color:#444;">Name / Title</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;color:#666;">Please return the signed waiver to <a href="mailto:${pm}" style="color:#e8590c;">${pm}</a> or deliver it to our office before payment will be processed.</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction · Questions? Reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function loadWaiverSubmission(db, submissionId) {
  const { data, error } = await db.from('billing_submissions').select(SELECT).eq('id', submissionId).maybeSingle()
  return { sub: data || null, error }
}

// Send the waiver for one billing. `sub` may be passed when the caller already loaded it
// with loadWaiverSubmission. Returns:
//   { ok: true, sent_at }                       emailed and stamped
//   { ok: true, skipped: 'already_sent' | 'signed', sent_at }   nothing emailed (no resend asked)
//   { ok: false, status, error }                nothing emailed (or the email failed)
export async function sendLienWaiver({ db, resend, submissionId, sub = null, resendRequested = false }) {
  if (!sub) {
    const loaded = await loadWaiverSubmission(db, submissionId)
    if (loaded.error) return { ok: false, status: 500, error: loaded.error.message }
    sub = loaded.sub
  }
  if (!sub) return { ok: false, status: 404, error: 'Submission not found' }
  if (sub.status !== 'approved') return { ok: false, status: 422, error: 'Only an approved billing gets a lien waiver.' }
  if (!resendRequested && sub.lien_waiver_signed_at) return { ok: true, skipped: 'signed', sent_at: sub.lien_waiver_sent_at || null }
  if (!resendRequested && sub.lien_waiver_sent_at) return { ok: true, skipped: 'already_sent', sent_at: sub.lien_waiver_sent_at }

  // Fall back to the sub's profile email when the submission has none
  let recipientEmail = sub.sub_email?.trim() || null
  if (!recipientEmail && sub.sub_id) {
    const { data: prof } = await db.from('profiles').select('email').eq('id', sub.sub_id).maybeSingle()
    recipientEmail = prof?.email || null
  }
  if (!recipientEmail) return { ok: false, status: 400, error: 'No email on file for this sub' }

  const stamp = new Date().toISOString()
  if (!resendRequested) {
    // Claim the send: only one caller gets to stamp a blank waiver.
    const { data: claimed, error: claimErr } = await db.from('billing_submissions')
      .update({ lien_waiver_sent_at: stamp }).eq('id', sub.id).is('lien_waiver_sent_at', null).select('id')
    if (claimErr) return { ok: false, status: 500, error: claimErr.message }
    if (!claimed?.length) return { ok: true, skipped: 'already_sent', sent_at: null }
  }

  let emailErr = null
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      reply_to: process.env.PM_EMAIL || 'management@nvim.co',
      to: recipientEmail,
      subject: `Lien Waiver Required — #${sub.jobs?.job_number ?? ''} ${sub.jobs?.project_name ?? ''}`,
      html: lienWaiverEmailHtml(sub),
    })
    emailErr = error ? (error.message || 'Email failed') : null
  } catch (e) {
    emailErr = e?.message || 'Email failed'
  }

  if (emailErr) {
    // Release our claim so the waiver shows NOT SENT and can be sent again.
    if (!resendRequested) await db.from('billing_submissions').update({ lien_waiver_sent_at: null }).eq('id', sub.id).eq('lien_waiver_sent_at', stamp)
    return { ok: false, status: 500, error: emailErr }
  }
  if (resendRequested) {
    const { error: stampErr } = await db.from('billing_submissions').update({ lien_waiver_sent_at: stamp }).eq('id', sub.id)
    if (stampErr) return { ok: true, sent_at: null, warning: 'Waiver emailed, but the sent date was not saved: ' + stampErr.message }
  }
  return { ok: true, sent_at: stamp }
}
