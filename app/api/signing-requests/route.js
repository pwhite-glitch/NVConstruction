import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const logoSrc = () => `${process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'}/logo.png`

export async function POST(request) {
  const { job_id, subcontract_id, signer_email, signer_name, document_html, document_title, created_by } = await request.json()
  if (!job_id || !signer_email || !document_html) {
    return Response.json({ error: 'job_id, signer_email, and document_html are required' }, { status: 400 })
  }

  const { data: row, error: insertErr } = await adminSupabase
    .from('signing_requests')
    .insert({
      job_id,
      subcontract_id: subcontract_id || null,
      signer_email: signer_email.trim().toLowerCase(),
      signer_name: signer_name || null,
      document_html,
      document_title: document_title || null,
      created_by: created_by || null,
    })
    .select()
    .single()

  if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'
  const signingLink = `${siteUrl}/sign?token=${row.token}`
  const logo = logoSrc()
  const firstName = signer_name?.split(' ')[0] || 'there'
  const title = document_title || 'Subcontract Agreement'

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: signer_email,
    subject: `Action Required: Please sign — ${title}`,
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
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Signature Requested, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              NV Construction has sent you a document to review and sign electronically.
            </p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Document</p>
              <p style="margin:0;font-size:16px;font-weight:700;color:#f1f1f1;">${title}</p>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="${signingLink}" style="display:inline-block;background:#e8590c;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.5px;">Review &amp; Sign Document</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#444;line-height:1.6;">Or copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:12px;color:#e8590c;word-break:break-all;">${signingLink}</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction &middot; Questions? Reply to this email or contact your project manager.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  return Response.json({ data: row })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('signing_requests')
    .select('id, token, job_id, subcontract_id, signer_email, signer_name, document_title, status, signed_at, signer_ip, created_at, created_by')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data || [] })
}
