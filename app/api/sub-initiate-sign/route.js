import { createClient } from '@supabase/supabase-js'
import { buildSubcontractHtml } from '../../../lib/buildSubcontractHtml'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { subcontract_id, sub_user_id } = await request.json()
    if (!subcontract_id || !sub_user_id) {
      return Response.json({ error: 'subcontract_id and sub_user_id required' }, { status: 400 })
    }

    // Verify the subcontract belongs to this sub
    const { data: sc } = await adminSupabase
      .from('subcontracts')
      .select('*, jobs(job_number, project_name, location, owner_name, owner_company)')
      .eq('id', subcontract_id)
      .single()

    if (!sc) return Response.json({ error: 'Subcontract not found' }, { status: 404 })
    if (sc.sub_id !== sub_user_id) {
      const { data: userProfile } = await adminSupabase.from('profiles').select('company_id').eq('id', sub_user_id).single()
      if (!userProfile?.company_id || sc.company_id !== userProfile.company_id) {
        return Response.json({ error: 'Not authorized' }, { status: 403 })
      }
    }

    // Return existing pending/signed request if one exists
    const { data: existing } = await adminSupabase
      .from('signing_requests')
      .select('token, status')
      .eq('subcontract_id', subcontract_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) return Response.json({ token: existing.token, status: existing.status })

    // Build form data from the subcontract + job
    const job = sc.jobs || {}
    const yr = new Date().getFullYear()
    const jobNum = job.job_number || '000'
    const f = {
      date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      sub_name: sc.vendor_name || 'Subcontractor',
      sub_address: '',
      entity_type: 'sole proprietorship',
      trade: sc.description || '',
      project_name: job.project_name || '',
      project_address: job.location || '',
      owner_name: job.owner_company || job.owner_name || '',
      owner_address: '',
      contract_amount: String(sc.contract_value || 0),
      pay_pct: '100',
      scope_of_work: sc.description || '',
      job_number: jobNum,
      subcontract_number: `${yr}-${jobNum}-001`,
      pm_name: 'Peyton White',
      superintendent: 'Landon Moore',
      cover_letter_body: 'Please carefully review paragraphs # 5 and #23 of the enclosed contract. All change orders must have written authorization (defined as a formal NV Construction change order or an email approval defining scope and cost) from the Project Manager before work is commenced in order to ensure you will be paid for the work. All payment requests including claims for additional work must include a formal signed NV Construction Change Order in order for your draw to be processed and paid.\n\nWhile I understand that in the heat of battle, a NV Construction employee may ask you to perform work with a verbal authorization; you must get that authorization in writing before proceeding. Any work done with only a verbal agreement will result in not being paid. Also, please note in paragraph #23 that the NV superintendent is not authorized to approve change orders for additional work. That approval must come from the Project Manager.\n\nI highlight these paragraphs to protect you as a subcontractor and to ensure that at the end of the job there are no surprises for any of us, including our client.\n\nWe appreciate your cooperation in this matter and look forward to working with you on this project. Please acknowledge your agreement and understanding of this requirement by signing this letter in the space provided below, and then return the signed copy with your contract.',
      contract_documents: 'Subcontractor Proposal\nLink to Current Plan Sheets\nExhibit A Attached\nExhibit B Attached\nSchedule',
      scope_notes: '* Change Orders: You must receive written authorization from the Project Manager before you begin the work.\n* Daily broom swept clean-up of all trash & debris\n* Comply with all OSHA regulations. *PPE will be required at all times for this job\n* Time is of the essence for this project. Complete work per schedule provided below.',
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'
    const document_html = buildSubcontractHtml(f, baseUrl)
    const document_title = `Subcontract — ${sc.vendor_name || 'Sub'} · #${jobNum}`

    // Fetch sub's email from profile
    const { data: prof } = await adminSupabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', sub_user_id)
      .maybeSingle()

    const { data: row, error: insertErr } = await adminSupabase
      .from('signing_requests')
      .insert({
        job_id: sc.job_id,
        subcontract_id,
        signer_email: prof?.email || '',
        signer_name: sc.vendor_name || null,
        document_html,
        document_title,
        created_by: sub_user_id,
      })
      .select('token')
      .single()

    if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 })
    return Response.json({ token: row.token })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
