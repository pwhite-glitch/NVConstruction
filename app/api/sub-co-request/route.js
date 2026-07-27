import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const subcontract_id = searchParams.get('subcontract_id')
  const user_id = searchParams.get('user_id')
  if (!subcontract_id || !user_id) return Response.json({ data: [] })

  // Verify access: sub_id match OR same company
  const { data: sc } = await adminSupabase.from('subcontracts').select('sub_id, company_id').eq('id', subcontract_id).single()
  if (!sc) return Response.json({ data: [] })
  if (sc.sub_id !== user_id) {
    const { data: prof } = await adminSupabase.from('profiles').select('company_id').eq('id', user_id).single()
    const sameCompany = prof?.company_id && sc.company_id && sc.company_id === prof.company_id
    const subIsTeammate = prof?.company_id && !sc.company_id && await (async () => {
      const { data: subProf } = await adminSupabase.from('profiles').select('company_id').eq('id', sc.sub_id).single()
      return subProf?.company_id === prof.company_id
    })()
    if (!sameCompany && !subIsTeammate) return Response.json({ data: [] })
  }

  const { data } = await adminSupabase.from('change_orders').select('*').eq('subcontract_id', subcontract_id).order('created_at', { ascending: false })
  return Response.json({ data: data || [] })
}

export async function POST(request) {
  try {
    const { subcontract_id, sub_user_id, description, amount, notes } = await request.json()
    if (!subcontract_id || !sub_user_id || !description || !amount) {
      return Response.json({ error: 'subcontract_id, sub_user_id, description, and amount required' }, { status: 400 })
    }

    // Verify the subcontract belongs to this sub
    const { data: subcontract } = await adminSupabase
      .from('subcontracts')
      .select('*, jobs(job_number, project_name)')
      .eq('id', subcontract_id)
      .single()

    if (!subcontract) return Response.json({ error: 'Subcontract not found' }, { status: 404 })
    if (subcontract.sub_id !== sub_user_id) {
      const [{ data: userProfile }, { data: subProfile }] = await Promise.all([
        adminSupabase.from('profiles').select('company_id').eq('id', sub_user_id).single(),
        adminSupabase.from('profiles').select('company_id').eq('id', subcontract.sub_id).single(),
      ])
      const userCompany = userProfile?.company_id
      const sameViaSubcontract = userCompany && subcontract.company_id && subcontract.company_id === userCompany
      const sameViaSubProfile = userCompany && subProfile?.company_id && subProfile.company_id === userCompany
      if (!sameViaSubcontract && !sameViaSubProfile) {
        return Response.json({ error: 'Not authorized' }, { status: 403 })
      }
    }

    const { data: co, error } = await adminSupabase
      .from('change_orders')
      .insert({
        subcontract_id,
        initiated_by: sub_user_id,
        direction: 'sub_to_pm',
        amount: parseFloat(amount),
        description: notes?.trim() ? `${description.trim()}\n\n${notes.trim()}` : description.trim(),
        status: 'pending',
      })
      .select('id')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })

    const job = subcontract.jobs
    const vendor = subcontract.vendor_name || 'Subcontractor'
    const fmt = parseFloat(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const pmEmail = process.env.PM_EMAIL || 'management@nvim.co'

    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to: pmEmail,
      subject: `Change order request — ${vendor} · #${job?.job_number}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:500px;margin:0 auto;border-radius:12px;">
        <p style="color:#e8590c;font-size:16px;font-weight:700;margin:0 0 8px">Change Order Request</p>
        <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${vendor}</strong> has submitted a change order request for <strong style="color:#f1f1f1">#${job?.job_number} — ${job?.project_name}</strong>.</p>
        <p style="font-size:24px;font-weight:800;color:#e8590c;margin:16px 0">${fmt}</p>
        <p style="color:#666;font-size:13px;margin:0 0 4px"><strong style="color:#aaa">Description:</strong> ${description}</p>
        ${notes ? `<p style="color:#666;font-size:13px;margin:8px 0 0"><strong style="color:#aaa">Notes:</strong> ${notes}</p>` : ''}
        <p style="color:#555;font-size:12px;margin:20px 0 0">Review and approve or reject this CO from the job detail page.</p>
      </div>`,
    }).catch(() => {})

    return Response.json({ ok: true, id: co.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
