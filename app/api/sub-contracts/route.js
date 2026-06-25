import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Returns subcontracts for a job this user can bill against:
// 1. sub_id match (legacy direct link)
// 2. company_id match (preferred — all users in the company can bill)
// 3. vendor_name ilike fallback (for any not yet migrated)
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const user_id = searchParams.get('user_id')
  const company_id = searchParams.get('company_id') || ''
  const company_name = searchParams.get('company_name') || ''

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
