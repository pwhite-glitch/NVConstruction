import { createClient } from '@supabase/supabase-js'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { buildSubcontractHtml } from '../../../lib/buildSubcontractHtml'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  // Sub must be authenticated — derive identity from session, never from body
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const { subcontract_id } = await request.json()
    if (!subcontract_id) return Response.json({ error: 'subcontract_id required' }, { status: 400 })

    const sub_user_id = auth.userId  // always from verified session

    // Verify the subcontract belongs to this sub (or their company)
    const { data: sc } = await adminSupabase
      .from('subcontracts')
      .select('*, jobs(job_number, project_name, location, owner_name, owner_company)')
      .eq('id', subcontract_id)
      .single()

    if (!sc) return Response.json({ error: 'Subcontract not found' }, { status: 404 })

    const isDirectSub = sc.sub_id === sub_user_id
    let isCompanySub = false
    if (!isDirectSub && auth.companyId) {
      isCompanySub = sc.company_id === auth.companyId
    }
    if (!isDirectSub && !isCompanySub) {
      return Response.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Return existing request if one exists
    const { data: existing } = await adminSupabase
      .from('signing_requests')
      .select('token, status')
      .eq('subcontract_id', subcontract_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) return Response.json({ token: existing.token, status: existing.status })

    // Build subcontract HTML
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
      cover_letter_body: 'Please carefully review paragraphs # 5 and #23 of the enclosed contract. All change orders must have written authorization (defined as a formal NV Construction change order or an email approval defining scope and cost) from the Project Manager before work is commenced in order to ensure you will be paid for the work.',
      contract_documents: 'Subcontractor Proposal\nLink to Current Plan Sheets\nExhibit A Attached\nExhibit B Attached\nSchedule',
      scope_notes: '* Change Orders: You must receive written authorization from the Project Manager before you begin the work.\n* Daily broom swept clean-up of all trash & debris\n* Comply with all OSHA regulations.',
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nvim.co'
    const document_html = buildSubcontractHtml(f, baseUrl)
    const document_title = `Subcontract — ${sc.vendor_name || 'Sub'} · #${jobNum}`

    // Get sub email from auth — never from profiles.email which may be stale
    const { data: authUser } = await adminSupabase.auth.admin.getUserById(sub_user_id)
    const signer_email = authUser?.user?.email || ''

    const { data: row, error: insertErr } = await adminSupabase
      .from('signing_requests')
      .insert({
        job_id: sc.job_id,
        subcontract_id,
        signer_email,
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
