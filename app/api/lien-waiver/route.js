import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import fs from 'fs'
import path from 'path'

function logoSrc() {
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'logo.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch { return '' }
}

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  const { submission_id } = await request.json()
  if (!submission_id) return Response.json({ error: 'submission_id required' }, { status: 400 })

  const { data: sub, error: subErr } = await adminSupabase
    .from('billing_submissions')
    .select('*, jobs(job_number, project_name, location, owner_name, owner_company)')
    .eq('id', submission_id)
    .single()

  if (subErr || !sub) return Response.json({ error: 'Submission not found' }, { status: 404 })

  // Fall back to profile email if sub_email is missing
  let recipientEmail = sub.sub_email
  if (!recipientEmail && sub.sub_id) {
    const { data: prof } = await adminSupabase.from('profiles').select('email').eq('id', sub.sub_id).single()
    recipientEmail = prof?.email
  }
  if (!recipientEmail) return Response.json({ error: 'No email on file for this sub' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'
  const logo = logoSrc()
  const amt = parseFloat(sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const period = sub.billing_period
    ? new Date(sub.billing_period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const firstName = sub.contact_name?.split(' ')[0] || 'there'
  const ownerName = sub.jobs?.owner_company || sub.jobs?.owner_name || 'Project Owner'

  const { error: emailErr } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    reply_to: process.env.PM_EMAIL || 'management@nvim.co',
    to: recipientEmail,
    subject: `Lien Waiver Required — #${sub.jobs?.job_number} ${sub.jobs?.project_name}`,
    html: `
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
              Your billing of <strong style="color:#e8590c;">${amt}</strong> for <strong style="color:#f1f1f1;">#${sub.jobs?.job_number} — ${sub.jobs?.project_name}</strong> (${period}) has been approved. Please print, sign, and return the conditional lien waiver below before payment can be issued.
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
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">${sub.company_name}</p>
                    </td>
                    <td width="50%" style="padding-bottom:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Hiring Party</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">NV Construction</p>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%" style="padding-bottom:12px;padding-right:12px;">
                      <p style="margin:0 0 3px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;">Project</p>
                      <p style="margin:0;font-size:13px;color:#f1f1f1;border-bottom:1px solid #2a2a2a;padding-bottom:4px;">#${sub.jobs?.job_number} — ${sub.jobs?.project_name}</p>
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

            <p style="margin:0 0 8px;font-size:13px;color:#666;">Please return the signed waiver to <a href="mailto:${process.env.PM_EMAIL || 'management@nvim.co'}" style="color:#e8590c;">${process.env.PM_EMAIL || 'management@nvim.co'}</a> or deliver it to our office before payment will be processed.</p>
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
</html>`,
  })

  if (emailErr) return Response.json({ error: emailErr.message }, { status: 500 })

  await adminSupabase
    .from('billing_submissions')
    .update({ lien_waiver_sent_at: new Date().toISOString() })
    .eq('id', submission_id)

  return Response.json({ ok: true })
}
