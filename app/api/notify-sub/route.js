import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const logoSrc = () => `${process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'}/logo.png`

export async function POST(request) {
  const { to_email, to_name, company_name, subject, message } = await request.json()
  if (!to_email || !subject || !message) return Response.json({ error: 'Missing required fields' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'
  const firstName = to_name?.split(' ')[0] || 'there'
  const logo = logoSrc()

  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: to_email,
    subject: subject,
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
            <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#f1f1f1;">Hello, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:13px;color:#555;">Message from NV Construction${company_name ? ` · ${company_name}` : ''}</p>
            <div style="background:#0f0f0f;border:1px solid #2a2a2a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0;font-size:14px;color:#ccc;line-height:1.8;white-space:pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
            </div>
            <p style="margin:0;font-size:13px;color:#555;">Questions? Reply to this email or log in to your portal at <a href="${siteUrl}/login" style="color:#e8590c;">${siteUrl}/login</a></p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">NV Construction · This message was sent by your project manager.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
