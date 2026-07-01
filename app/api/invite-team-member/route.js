import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  try {
    const { inviter_id, company_id, email: rawEmail, full_name, role } = await request.json()
    if (!inviter_id || !company_id || !rawEmail) {
      return Response.json({ error: 'inviter_id, company_id, and email are required' }, { status: 400 })
    }

    // Verify the inviter belongs to the company they're inviting to
    const { data: inviterProfile } = await adminSupabase
      .from('profiles')
      .select('company_id, company_name, full_name, role')
      .eq('id', inviter_id)
      .single()

    const isPM = ['pm', 'apm', 'super', 'admin'].includes(inviterProfile?.role)
    if (!isPM && inviterProfile?.company_id !== company_id) {
      return Response.json({ error: 'You can only invite users to your own company.' }, { status: 403 })
    }

    const email = rawEmail.toLowerCase().trim()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nv-construction-doym.vercel.app'

    // Get company info
    const { data: company } = await adminSupabase
      .from('companies')
      .select('name')
      .eq('id', company_id)
      .single()
    const companyName = company?.name || inviterProfile?.company_name || ''

    // Get sub_directory info for this company
    const { data: dir } = await adminSupabase
      .from('sub_directory')
      .select('id')
      .ilike('email', email)
      .maybeSingle()

    // Generate invite or recovery link
    let inviteUrl = null
    let userId = null

    const { data: inviteData, error: inviteErr } = await adminSupabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${siteUrl}/set-password`,
        data: { full_name: full_name || '', role: role || 'subcontractor', company_name: companyName },
      },
    })

    if (inviteErr) {
      // Already has an account — send a login/reset link instead
      const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
      const existing = users.find(u => u.email?.toLowerCase() === email)
      if (!existing) return Response.json({ error: inviteErr.message }, { status: 400 })
      userId = existing.id
      const { data: linkData } = await adminSupabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${siteUrl}/set-password` },
      })
      inviteUrl = linkData?.properties?.action_link
    } else {
      userId = inviteData.user.id
      inviteUrl = inviteData.properties?.action_link
    }

    // Create/update profile linked to the company
    if (userId) {
      const validSubRoles = ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']
      await adminSupabase.from('profiles').upsert({
        id: userId,
        full_name: full_name || null,
        role: validSubRoles.includes(role) ? role : 'subcontractor',
        company_name: companyName,
        company_id,
        invite_email: email,
      }, { onConflict: 'id', ignoreDuplicates: false })
    }

    const inviterName = inviterProfile?.full_name || 'Your project manager'
    const firstName = full_name?.split(' ')[0] || 'there'
    const logo = `${siteUrl}/logo.png`

    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      reply_to: process.env.PM_EMAIL || 'management@nvim.co',
      to: email,
      subject: `You've been invited to join ${companyName} on the NV Construction portal`,
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
            <img src="${logo}" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Hey ${firstName},</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              ${inviterName} has invited you to join <strong style="color:#f1f1f1;">${companyName}</strong> on the NV Construction subcontractor portal.
              Click below to set your password and get started.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Accept Invitation</a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Your account</p>
                  <p style="margin:0;font-size:14px;color:#f1f1f1;">${companyName} · ${email}</p>
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

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
