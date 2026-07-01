import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  const { email } = await request.json()
  if (!email) return Response.json({ error: 'Email is required.' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${siteUrl}/set-password` },
  })

  if (error) {
    // User not found in auth
    return Response.json({ error: 'No account found for that email address.' }, { status: 404 })
  }

  const resetUrl = data.properties?.action_link
  const logoUrl = `${siteUrl}/logo.png`

  const { error: emailError } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: email,
    subject: 'Reset your NV Construction password',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            <img src="${logoUrl}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Reset your password</h1>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">
              Click the button below to set a new password for your NV Construction account. This link expires in 1 hour.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Set New Password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy this link into your browser:</p>
            <p style="margin:0;font-size:12px;color:#444;word-break:break-all;">${resetUrl}</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">If you didn't request a password reset, you can ignore this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })

  if (emailError) return Response.json({ error: `Account found but email failed to send: ${emailError.message}` }, { status: 500 })
  return Response.json({ ok: true })
}
