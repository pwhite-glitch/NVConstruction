import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

const ROLE_LABELS = {
  pm: 'Project Manager',
  apm: 'Assistant Project Manager',
  super: 'Superintendent',
  admin: 'Office Admin',
}

export async function POST(request) {
  const { email, full_name, role, phone } = await request.json()
  if (!email || !role) {
    return Response.json({ error: 'Email and role are required.' }, { status: 400 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvconstruction.vercel.app'

  let userId = null
  let inviteUrl = null

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: `${siteUrl}/set-password`,
      data: { full_name, role },
    },
  })

  if (error) {
    // User already exists — look them up and generate a recovery link instead
    if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
      const { data: { users } } = await adminSupabase.auth.admin.listUsers()
      const existing = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (!existing) return Response.json({ error: error.message }, { status: 400 })
      userId = existing.id
      const { data: linkData } = await adminSupabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${siteUrl}/set-password` },
      })
      inviteUrl = linkData?.properties?.action_link
    } else {
      return Response.json({ error: error.message }, { status: 400 })
    }
  } else {
    userId = data.user.id
    inviteUrl = data.properties?.action_link
  }

  await adminSupabase.from('profiles').upsert({
    id: userId,
    full_name: full_name || null,
    role,
    phone: phone || null,
  }, { onConflict: 'id' })

  await adminSupabase.from('profiles').update({ role, full_name: full_name || null, phone: phone || null }).eq('id', userId)
  const roleLabel = ROLE_LABELS[role] || role
  const firstName = full_name ? full_name.split(' ')[0] : 'there'

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: email,
    subject: "You've been invited to NV Construction",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #222;border-radius:16px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#141414;border-bottom:1px solid #222;padding:28px 40px;text-align:center;">
            <img src="${siteUrl}/logo.png" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Hey ${firstName}, you're invited</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">
              You've been added to the NV Construction project management platform as a <strong style="color:#e8590c;">${roleLabel}</strong>. Click below to set your password and get started.
            </p>

            <!-- Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Set My Password</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy this link into your browser:</p>
            <p style="margin:0 0 32px;font-size:12px;color:#444;word-break:break-all;">${inviteUrl}</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:0;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#555;text-transform:uppercase;">Your access</p>
                  <p style="margin:0;font-size:14px;color:#f1f1f1;">${roleLabel} · ${email}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">This invite was sent by NV Construction management. If you weren't expecting this, you can ignore it.</p>
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

export async function PATCH(request) {
  const { user_id, email, full_name, role } = await request.json()
  if (!user_id || !email) return Response.json({ error: 'user_id and email required' }, { status: 400 })

  const { error } = await adminSupabase.auth.admin.updateUserById(user_id, { email })
  if (error) return Response.json({ error: error.message }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvconstruction.vercel.app'
  const roleLabel = ROLE_LABELS[role] || role
  const firstName = full_name ? full_name.split(' ')[0] : 'there'

  const { data: linkData } = await adminSupabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${siteUrl}/set-password` },
  })
  const resetUrl = linkData?.properties?.action_link

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: email,
    subject: 'Your NV Construction login email has been updated',
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
            <img src="${siteUrl}/logo.png" alt="NV Construction" width="60" height="60" style="object-fit:contain;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:4px;color:#555;text-transform:uppercase;">NV Construction</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f1f1f1;">Hey ${firstName}, your email was updated</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;">Your login email has been changed to <strong style="color:#f1f1f1;">${email}</strong>. Click below to set a new password and continue as <strong style="color:#e8590c;">${roleLabel}</strong>.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#e8590c;border-radius:8px;">
                  <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Set New Password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy this link:</p>
            <p style="margin:0;font-size:12px;color:#444;word-break:break-all;">${resetUrl}</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1e1e1e;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#444;">If you didn't expect this change, contact your project manager immediately.</p>
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

export async function DELETE(request) {
  const { user_id } = await request.json()
  if (!user_id) return Response.json({ error: 'user_id required' }, { status: 400 })
  const { error } = await adminSupabase.auth.admin.deleteUser(user_id)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ ok: true })
}
