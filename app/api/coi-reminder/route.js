import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'
const PM_EMAIL = process.env.PM_EMAIL || 'pwhite@nvim.co'

export async function GET(request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: subs, error } = await adminSupabase
    .from('sub_directory')
    .select('*')
    .eq('status', 'approved')
    .not('coi_expiration', 'is', null)
    .not('email', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const logo = `${SITE_URL}/logo.png`
  let totalSent = 0
  const reminders = []
  const errors = []

  for (const sub of subs || []) {
    const exp = new Date(sub.coi_expiration + 'T12:00:00')
    exp.setHours(0, 0, 0, 0)
    const daysUntil = Math.round((exp - today) / 86400000)

    if (daysUntil !== 30 && daysUntil !== 7) continue

    const color = daysUntil === 7 ? '#ff6b6b' : '#facc15'
    const expDate = exp.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const firstName = sub.contact_name?.split(' ')[0] || 'there'

    const { error: emailErr } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: sub.email,
      subject: `COI expiring in ${daysUntil} days — action required`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            <img src="${logo}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">COI expiring soon, ${firstName}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              Your Certificate of Insurance on file with NV Construction expires on
              <strong style="color:${color};">${expDate}</strong> —
              that's <strong style="color:${color};">${daysUntil} days</strong> from now.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">
              Please upload a renewed COI to your subcontractor portal as soon as possible
              to avoid any interruption to your job assignments.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${SITE_URL}/submit" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Upload new COI</a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid ${color}40;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Expiration date</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:${color};">${expDate}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">Questions? Contact NV Construction directly or log in at <a href="${SITE_URL}" style="color:#666;">${SITE_URL}</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    if (emailErr) errors.push({ email: sub.email, error: emailErr.message })
    else { totalSent++; reminders.push({ company: sub.company_name, email: sub.email, daysUntil }) }
  }

  // Notify PM of any 7-day urgent expirations
  const urgent = reminders.filter(r => r.daysUntil === 7)
  if (urgent.length > 0) {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: PM_EMAIL,
      subject: `${urgent.length} sub${urgent.length > 1 ? 's' : ''} with COI expiring in 7 days`,
      html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">
<tr><td style="padding:32px 40px;">
<h2 style="color:#ff6b6b;margin:0 0 1rem">COI expiring in 7 days</h2>
<p style="color:#aaa;margin:0 0 1rem">The following subcontractors have been automatically notified:</p>
${urgent.map(r => `<div style="padding:10px 14px;background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;margin-bottom:8px"><p style="margin:0;font-size:14px;font-weight:700;color:#f1f1f1">${r.company}</p><p style="margin:2px 0 0;font-size:12px;color:#555">${r.email}</p></div>`).join('')}
<p style="color:#555;font-size:13px;margin:1.25rem 0 0">They've been emailed. <a href="${SITE_URL}/dashboard" style="color:#e8590c">View directory →</a></p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`,
    })
  }

  return Response.json({ ok: true, sent: totalSent, reminders, errors })
}
