import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  const { submission_id, signer_name, signature } = await request.json()
  if (!submission_id || !signer_name)
    return Response.json({ error: 'submission_id and signer_name required' }, { status: 400 })

  const { error } = await adminSupabase
    .from('billing_submissions')
    .update({
      lien_waiver_signed_at: new Date().toISOString(),
      lien_waiver_signer_name: signer_name,
      lien_waiver_signature: signature || null,
    })
    .eq('id', submission_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify PM
  const { data: sub } = await adminSupabase
    .from('billing_submissions')
    .select('*, jobs(job_number, project_name)')
    .eq('id', submission_id)
    .single()

  if (sub) {
    const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
    const amt = parseFloat(sub.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: pmEmail,
      subject: `Lien waiver signed — ${sub.company_name} · #${sub.jobs?.job_number}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
        <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 8px">✓ Lien waiver signed</p>
        <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${sub.company_name}</strong> has signed their conditional lien waiver for <strong style="color:#f1f1f1">#${sub.jobs?.job_number} — ${sub.jobs?.project_name}</strong>.</p>
        <p style="font-size:24px;font-weight:800;color:#e8590c;margin:16px 0">${amt}</p>
        <p style="color:#666;font-size:13px">Signed by: ${signer_name}<br/>Date: ${new Date().toLocaleDateString()}</p>
      </div>`,
    }).catch(() => {})
  }

  return Response.json({ ok: true })
}
