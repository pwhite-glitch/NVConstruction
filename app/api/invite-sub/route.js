import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const logoSrc = () => `${process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'}/logo.png`

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  try {
    const { directory_id, email: rawEmail, company_id } = await request.json()
    if (!directory_id && !rawEmail) return Response.json({ error: 'directory_id or email required' }, { status: 400 })

    let dir = { email: null, company_name: null, contact_name: null }
    if (directory_id) {
      const { data } = await adminSupabase.from('sub_directory').select('email, company_name, contact_name').eq('id', directory_id).single()
      if (data) dir = data
    } else {
      const normalEmail = rawEmail.toLowerCase().trim()
      const { data: existing } = await adminSupabase.from('sub_directory').select('email, company_name, contact_name').eq('email', normalEmail).maybeSingle()
      dir = existing || { email: normalEmail, company_name: null, contact_name: null }
    }

    if (!dir?.email) return Response.json({ error: 'No email on file for this subcontractor' }, { status: 400 })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'
    const logo = logoSrc()
    const firstName = dir.contact_name?.split(' ')[0] || 'there'

    let userId = null
    let inviteUrl = null
    let action = 'invited'

    const { data, error } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email: dir.email,
      options: {
        redirectTo: `${siteUrl}/set-password`,
        data: { full_name: dir.contact_name || '', role: 'subcontractor', company_name: dir.company_name || '' },
      },
    })

    if (error) {
      if (error.message?.includes('already been registered') || error.message?.includes('already exists') || error.status === 422) {
        // User already has an account — send a password reset link instead
        const { data: { users } } = await adminSupabase.auth.admin.listUsers()
        const existing = users.find(u => u.email?.toLowerCase() === dir.email.toLowerCase())
        if (!existing) return Response.json({ error: error.message }, { status: 400 })
        userId = existing.id
        const { data: linkData } = await adminSupabase.auth.admin.generateLink({
          type: 'recovery',
          email: dir.email,
          options: { redirectTo: `${siteUrl}/set-password` },
        })
        inviteUrl = linkData?.properties?.action_link
        action = 'reset'
      } else {
        return Response.json({ error: error.message }, { status: 400 })
      }
    } else {
      userId = data.user.id
      inviteUrl = data.properties?.action_link
    }

    if (userId) {
      const profileData = { id: userId, full_name: dir.contact_name || null, role: 'subcontractor', company_name: dir.company_name || null }
      if (company_id) profileData.company_id = company_id
      await adminSupabase.from('profiles').upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
    }

    const subject = action === 'reset'
      ? `Access your NV Construction subcontractor portal — ${dir.company_name}`
      : `You've been invited to the NV Construction subcontractor portal`

    const bodyText = action === 'reset'
      ? `Your account already exists. Click below to set your password and access the portal.`
      : `You've been added to our subcontractor portal. Click below to set your password and get started.`

    const { error: emailErr } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      reply_to: process.env.PM_EMAIL || 'management@nvim.co',
      to: dir.email,
      subject,
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
            ${logo ? `<img src="${logo}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Hey ${firstName},</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">${bodyText}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">Through the portal you can submit billing, upload W-9 and COI documents, and respond to bid invitations.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Set My Password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy this link into your browser:</p>
            <p style="margin:0 0 32px;font-size:12px;color:#444;word-break:break-all;">${inviteUrl}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Your account</p>
                  <p style="margin:0;font-size:14px;color:#f1f1f1;">${dir.company_name} · ${dir.email}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">Sent by NV Construction. Questions? Reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    if (emailErr) return Response.json({ error: emailErr.message }, { status: 500 })
    return Response.json({ ok: true, action })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
