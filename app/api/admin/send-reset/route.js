import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  if (!email) return Response.json({ error: 'email param required' }, { status: 400 })

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const resetLink = data.properties?.action_link
  if (!resetLink) return Response.json({ error: 'Could not generate reset link' }, { status: 500 })

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: email,
    subject: 'Set your NV Construction password',
    html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
      <p style="color:#e8590c;font-size:18px;font-weight:800;margin:0 0 12px">NV Construction Portal</p>
      <p style="color:#aaa;margin:0 0 20px;font-size:14px;line-height:1.6">Click the button below to set your password and access the portal. This link expires in 24 hours.</p>
      <table cellpadding="0" cellspacing="0"><tr><td style="background:#e8590c;border-radius:8px">
        <a href="${resetLink}" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">Set My Password</a>
      </td></tr></table>
      <p style="color:#555;font-size:12px;margin:20px 0 0">If you didn't request this, ignore this email.</p>
    </div>`,
  })

  return Response.json({ ok: true, sent_to: email })
}
