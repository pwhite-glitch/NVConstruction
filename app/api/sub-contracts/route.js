import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Returns subcontracts for a job that this user can bill against:
// either they are the named sub_id OR their company_name matches the vendor_name.
// This allows multiple people from the same company to bill against the same contract.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const user_id = searchParams.get('user_id')
  const company_name = searchParams.get('company_name') || ''

  if (!job_id || !user_id) return Response.json({ contracts: [] })

  const { data: byId } = await adminSupabase
    .from('subcontracts')
    .select('id, description, retainage_pct, contract_value')
    .eq('job_id', job_id)
    .eq('sub_id', user_id)

  let contracts = byId || []

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
