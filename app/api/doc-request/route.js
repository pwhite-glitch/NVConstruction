import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

function wrap(body) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;padding:2rem;border-radius:12px;border:1px solid #222"><div style="margin-bottom:1.5rem"><span style="font-weight:800;font-size:15px;color:#e8590c;letter-spacing:2px;text-transform:uppercase">NV Construction</span></div>${body}<div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #222;font-size:12px;color:#555">NV Construction · Subcontractor Portal</div></div>`
}

export async function POST(request) {
  try {
    const { directory_id, type } = await request.json()
    if (!directory_id || !type) return Response.json({ error: 'directory_id and type required' }, { status: 400 })

    const { data: dir } = await adminSupabase
      .from('sub_directory')
      .select('company_name, contact_name, email')
      .eq('id', directory_id)
      .single()

    if (!dir?.email) return Response.json({ error: 'No email on file for this sub' }, { status: 400 })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
    const firstName = dir.contact_name?.split(' ')[0] || 'there'

    const docLabel = type === 'both'
      ? 'W-9 form and Certificate of Insurance (COI)'
      : type === 'w9' ? 'W-9 form' : 'Certificate of Insurance (COI)'

    const subject = type === 'both'
      ? `W-9 & COI Required — ${dir.company_name}`
      : type === 'w9'
        ? `W-9 Required — ${dir.company_name}`
        : `Certificate of Insurance Required — ${dir.company_name}`

    const coiWarning = (type === 'coi' || type === 'both') ? `
      <div style="background:#2a1200;border:1px solid #4a2200;border-radius:8px;padding:14px 16px;margin:1rem 0;font-size:13px;color:#e8590c;line-height:1.5">
        Your Certificate of Insurance on file is missing or expired. Please provide an updated COI listing <strong>NV Construction</strong> as an additional insured.
      </div>` : ''

    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      reply_to: process.env.PM_EMAIL || 'office@nvim.co',
      to: dir.email,
      subject,
      html: wrap(`
        <h2 style="color:#f1f1f1;margin:0 0 1rem">Document Required</h2>
        <p style="color:#aaa;margin:0 0 1rem">Hi <strong style="color:#f1f1f1">${firstName}</strong>,</p>
        <p style="color:#aaa;margin:0 0 0.75rem">We need your <strong style="color:#f1f1f1">${docLabel}</strong> on file before we can process upcoming payments for <strong style="color:#f1f1f1">${dir.company_name}</strong>.</p>
        ${coiWarning}
        <p style="color:#aaa;margin:0 0 1.5rem">Please upload your document(s) through the subcontractor portal below. It only takes a minute.</p>
        <a href="${siteUrl}/submit" style="display:inline-block;padding:12px 28px;background:#e8590c;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:1px">Open Sub Portal</a>
        <p style="color:#666;font-size:12px;margin-top:1.5rem;line-height:1.6">If you have already submitted these documents or have any questions, please reply to this email or contact our office directly.</p>
      `)
    })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
