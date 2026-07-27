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
    const queries = [
      adminSupabase.from('subcontract_summary').select('*').eq('sub_id', user_id).order('created_at', { ascending: false }),
    ]
    if (company_id) {
      queries.push(
        adminSupabase.from('subcontract_summary').select('*').eq('company_id', company_id).order('created_at', { ascending: false })
      )
    }
    const results = await Promise.all(queries)
    const all_contracts = results.flatMap(r => r.data || [])
    const seen = new Set()
    const contracts = all_contracts.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
    if (contracts.length === 0) return Response.json({ all_contracts: [] })
    const jobIds = [...new Set(contracts.map(c => c.job_id))]
    const { data: jobs } = await adminSupabase.from('jobs').select('id, job_number, project_name').in('id', jobIds)
    const jobMap = Object.fromEntries((jobs || []).map(j => [j.id, j]))
    return Response.json({ all_contracts: contracts.map(c => ({ ...c, job: jobMap[c.job_id] })) })
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
