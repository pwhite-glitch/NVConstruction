import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const logoSrc = () => `${process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'}/logo.png`

export async function GET(request, { params }) {
  const { token } = params
  const { searchParams } = new URL(request.url)
  const includeHtml = searchParams.get('html') === '1'

  const selectFields = includeHtml
    ? 'id, token, job_id, subcontract_id, signer_email, signer_name, document_title, document_html, status, signed_at, signer_ip, created_at'
    : 'id, token, job_id, subcontract_id, signer_email, signer_name, document_title, status, signed_at, signer_ip, created_at'

  const { data, error } = await adminSupabase
    .from('signing_requests')
    .select(selectFields)
    .eq('token', token)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ data })
}

export async function POST(request, { params }) {
  const { token } = params
  const { signature_text, signer_ip } = await request.json()

  if (!signature_text?.trim()) {
    return Response.json({ error: 'signature_text is required' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await adminSupabase
    .from('signing_requests')
    .select('id, signer_email, signer_name, document_title, job_id, status')
    .eq('token', token)
    .single()

  if (fetchErr || !existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'signed') return Response.json({ error: 'Already signed' }, { status: 400 })

  const signedAt = new Date().toISOString()

  const { error: updateErr } = await adminSupabase
    .from('signing_requests')
    .update({
      status: 'signed',
      signature_text: signature_text.trim(),
      signed_at: signedAt,
      signer_ip: signer_ip || null,
    })
    .eq('token', token)

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'
  const logo = logoSrc()
  const title = existing.document_title || 'Subcontract Agreement'
  const signerDisplay = existing.signer_name || existing.signer_email
  const firstName = existing.signer_name?.split(' ')[0] || 'there'
  const signedDate = new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const jobPortalLink = `${siteUrl}/jobdetail?id=${existing.job_id}&tab=contracts`

  // Email to signer
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: existing.signer_email,
    subject: `Signed: ${title}`,
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
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#0a2a0a;border:2px solid #1a4a1a;border-radius:50%;width:60px;height:60px;line-height:60px;font-size:28px;text-align:center;">&#10003;</div>
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;text-align:center;">Document Signed, ${firstName}</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;text-align:center;">You have successfully signed the document below.</p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed By</p>
              <p style="margin:0 0 16px;font-size:14px;color:#f1f1f1;">${signerDisplay}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed At</p>
              <p style="margin:0;font-size:14px;color:#4ade80;">${signedDate}</p>
            </div>
            <p style="margin:0;font-size:12px;color:#444;">Please keep this email for your records. NV Construction has been notified.</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Questions? Reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  // Email to PM
  const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: pmEmail,
    subject: `${signerDisplay} signed: ${title}`,
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
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#4ade80;">Contract Signed</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">
              <strong style="color:#f1f1f1;">${signerDisplay}</strong> has electronically signed a contract.
            </p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed By</p>
              <p style="margin:0 0 16px;font-size:14px;color:#f1f1f1;">${signerDisplay}</p>
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Signed At</p>
              <p style="margin:0;font-size:14px;color:#4ade80;">${signedDate}</p>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td align="center">
                  <a href="${jobPortalLink}" style="display:inline-block;background:#e8590c;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">View Job Portal</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Internal notification</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  return Response.json({ ok: true })
}
