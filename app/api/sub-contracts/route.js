import { createClient } from '@supabase/supabase-js'
import { requireAuth, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Sub portal only. The caller comes from the session; user_id / company_id /
// company_name query params are ignored. Which contracts are included is
// decided by getSubContracts (lib/sub-access.js). Drafts are never returned.
// ?all=1        → { all_contracts } for the My Contracts tab (subcontract_summary rows + job)
// ?job_id=uuid  → { contracts } on that job
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isSub(auth.role)) return Response.json({ error: 'Sub portal only' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const all = searchParams.get('all')

  const accessible = await getSubContracts(auth)

  if (all) {
    const allIds = accessible.map(c => c.id)
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

  if (!job_id) return Response.json({ contracts: [] })
  const ids = accessible.filter(c => c.job_id === job_id).map(c => c.id)
  if (ids.length === 0) return Response.json({ contracts: [] })
  const { data } = await adminSupabase
    .from('subcontracts')
    .select('id, description, retainage_pct, contract_value')
    .in('id', ids)
  return Response.json({ contracts: data || [] })
}
