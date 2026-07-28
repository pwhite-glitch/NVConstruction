import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Returns subcontracts for a job this user can bill against:
// 1. sub_id match (legacy direct link)
// 2. company_id match (preferred — all users in the company can bill)
// 3. vendor_name ilike fallback (for any not yet migrated)
// Pass all=1 (no job_id) to get all contracts across jobs for the sub portal contracts tab
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const user_id = searchParams.get('user_id')
  const company_id = searchParams.get('company_id') || ''
  const company_name = searchParams.get('company_name') || ''
  const all = searchParams.get('all')

  // All-contracts mode: load subcontract_summary for the sub portal contracts tab
  if (all && user_id) {
    // Collect all subcontract IDs this user can access
    const idQueries = [
      adminSupabase.from('subcontracts').select('id').eq('sub_id', user_id),
    ]
    if (company_id) {
      idQueries.push(
        adminSupabase.from('subcontracts').select('id').eq('company_id', company_id)
      )
    }
    if (company_name.trim()) {
      idQueries.push(
        adminSupabase.from('subcontracts').select('id').ilike('vendor_name', company_name.trim())
      )
    }
    const idResults = await Promise.all(idQueries)
    const allIds = [...new Set(idResults.flatMap(r => (r.data || []).map(c => c.id)))]

    if (allIds.length === 0) return Response.json({ all_contracts: [] })

    const [{ data: summaries }, { data: rawContracts }] = await Promise.all([
      adminSupabase.from('subcontract_summary').select('*').in('id', allIds).order('created_at', { ascending: false }),
      adminSupabase.from('subcontracts').select('id, signed_contract_url').in('id', allIds),
    ])

    const contracts = summaries || []
    const signedUrlMap = Object.fromEntries((rawContracts || []).map(r => [r.id, r.signed_contract_url]))
    const jobIds = [...new Set(contracts.map(c => c.job_id))]
    const { data: jobs } = await adminSupabase.from('jobs').select('id, job_number, project_name').in('id', jobIds)
    const jobMap = Object.fromEntries((jobs || []).map(j => [j.id, j]))
    return Response.json({ all_contracts: contracts.map(c => ({ ...c, job: jobMap[c.job_id], signed_contract_url: signedUrlMap[c.id] || null })) })
  }

  if (!job_id || !user_id) return Response.json({ contracts: [] })

  const { data: byId } = await adminSupabase
    .from('subcontracts')
    .select('id, description, retainage_pct, contract_value')
    .eq('job_id', job_id)
    .eq('sub_id', user_id)

  let contracts = byId || []

  if (contracts.length === 0 && company_id) {
    const { data: byCompany } = await adminSupabase
      .from('subcontracts')
      .select('id, description, retainage_pct, contract_value')
      .eq('job_id', job_id)
      .eq('company_id', company_id)
    contracts = byCompany || []
  }

  if (contracts.length === 0 && company_name.trim()) {
    const { data: byName } = await adminSupabase
      .from('subcontracts')
      .select('id, description, retainage_pct, contract_value')
      .eq('job_id', job_id)
      .ilike('vendor_name', company_name.trim())
    contracts = byName || []
  }

  return Response.json({ contracts })
}
