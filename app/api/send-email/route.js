import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  const { to, subject, html } = await request.json()
  if (!to || !subject || !html) {
    return Response.json({ error: 'Missing fields' }, { status: 400 })
  }
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to,
      subject,
      html,
    })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
