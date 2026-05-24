import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  const { co_id, response, dispute_reason, sub_user_id } = await request.json()
  if (!co_id || !response || !sub_user_id) {
    return Response.json({ error: 'co_id, response, and sub_user_id required' }, { status: 400 })
  }
  if (response !== 'approved' && response !== 'disputed') {
    return Response.json({ error: 'response must be approved or disputed' }, { status: 400 })
  }

  // Verify the CO belongs to a subcontract owned by this sub
  const { data: co } = await adminSupabase
    .from('change_orders')
    .select('*, subcontracts(sub_id, vendor_name, jobs(job_number, project_name))')
    .eq('id', co_id)
    .single()

  if (!co) return Response.json({ error: 'Change order not found' }, { status: 404 })
  if (co.subcontracts?.sub_id !== sub_user_id) {
    return Response.json({ error: 'Not authorized' }, { status: 403 })
  }
  if (co.direction !== 'pm_to_sub') {
    return Response.json({ error: 'Only PM-to-sub change orders require sub approval' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('change_orders')
    .update({
      status: response,
      reviewed_by: sub_user_id,
      reviewed_at: new Date().toISOString(),
      ...(dispute_reason ? { dispute_reason } : {}),
    })
    .eq('id', co_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Notify PM
  const job = co.subcontracts?.jobs
  const vendor = co.subcontracts?.vendor_name || 'Subcontractor'
  const amt = parseFloat(co.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'
  const color = response === 'approved' ? '#4ade80' : '#ff6b6b'
  const label = response === 'approved' ? 'Approved' : 'Disputed'

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
    to: pmEmail,
    subject: `Change order ${label.toLowerCase()} — ${vendor} · #${job?.job_number}`,
    html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
      <p style="color:${color};font-size:16px;font-weight:700;margin:0 0 8px">${response === 'approved' ? '✓' : '⚠'} Change order ${label}</p>
      <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${vendor}</strong> has ${label.toLowerCase()} a change order for <strong style="color:#f1f1f1">#${job?.job_number} — ${job?.project_name}</strong>.</p>
      <p style="font-size:24px;font-weight:800;color:#e8590c;margin:16px 0">${amt}</p>
      <p style="color:#666;font-size:13px;margin:0 0 4px">Description: ${co.description}</p>
      ${dispute_reason ? `<p style="color:#ff6b6b;font-size:13px;margin:8px 0 0">Dispute reason: ${dispute_reason}</p>` : ''}
    </div>`,
  }).catch(() => {})

  return Response.json({ ok: true })
}
