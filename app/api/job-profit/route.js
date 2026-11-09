import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'
import { fetchAll } from '../../../lib/budget-line-refs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  // Job profit / margins are Owner-only (principal).
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Only Owners can see job profit.' }, { status: 403 })

  try {
    const { job_ids } = await request.json()
    if (!job_ids?.length) return Response.json({ profits: {} })
    // Every read is paged (PostgREST caps a response at 1,000 rows) with a stable order, and
    // every error stops the request: a dropped or failed read would show confident margins
    // that leave out costs, budget lines or subcontracts.
    const [itemsRes, costsRes, contractsRes, summaryRes, jobsRes] = await Promise.all([
      fetchAll(() => adminSupabase.from('budget_items')
        .select('id, job_id, budget_amount, owner_amount, forecast_eac, cost_code, description')
        .in('job_id', job_ids)
        .order('id')),
      fetchAll(() => adminSupabase.from('direct_costs')
        .select('id, job_id, budget_item_id, amount')
        .in('job_id', job_ids)
        .eq('status', 'approved')
        .order('id')),
      // Base table: which budget line each contract sits on, and its original value.
      fetchAll(() => adminSupabase.from('subcontracts')
        .select('id, job_id, budget_item_id, contract_value')
        .in('job_id', job_ids)
        .order('id')),
      // Revised value (approved sub COs included) lives only on the subcontract_summary view.
      fetchAll(() => adminSupabase.from('subcontract_summary')
        .select('id, adjusted_contract_value')
        .in('job_id', job_ids)
        .order('id')),
      adminSupabase.from('jobs')
        .select('id, contract_value')
        .in('id', job_ids),
    ])
    const reads = { budget_items: itemsRes, direct_costs: costsRes, subcontracts: contractsRes, subcontract_summary: summaryRes, jobs: jobsRes }
    for (const [name, r] of Object.entries(reads)) {
      if (r.error) {
        console.error(`job-profit ${name}:`, r.error.message)
        return Response.json({ error: 'Could not load job profit numbers. Please try again.' }, { status: 500 })
      }
    }
    const items = itemsRes.data || []
    const costs = costsRes.data || []
    const jobsData = jobsRes.data || []
    const adjustedById = new Map((summaryRes.data || []).map(s => [s.id, s.adjusted_contract_value]))
    // No summary row for a contract → its original contract_value.
    const contracts = (contractsRes.data || []).map(c => ({ ...c, adjusted_contract_value: adjustedById.get(c.id) ?? null }))

    // Build lookup maps — include items without budget_item_id in an "unassigned" bucket
    const spentByItem = {}
    const unassignedCostByJob = {}
    for (const c of costs) {
      if (c.budget_item_id) {
        spentByItem[c.budget_item_id] = (spentByItem[c.budget_item_id] || 0) + Number(c.amount || 0)
      } else {
        unassignedCostByJob[c.job_id] = (unassignedCostByJob[c.job_id] || 0) + Number(c.amount || 0)
      }
    }

    const contractedByItem = {}
    const unassignedContractByJob = {}
    for (const sub of contracts) {
      const val = Number(sub.adjusted_contract_value ?? sub.contract_value ?? 0)
      if (sub.budget_item_id) {
        contractedByItem[sub.budget_item_id] = (contractedByItem[sub.budget_item_id] || 0) + val
      } else {
        unassignedContractByJob[sub.job_id] = (unassignedContractByJob[sub.job_id] || 0) + val
      }
    }

    const jobContractValue = {}
    for (const j of jobsData) {
      jobContractValue[j.id] = Number(j.contract_value ?? 0)
    }

    const profits = {}
    for (const job_id of job_ids) {
      const jobItems = items.filter(i => i.job_id === job_id)
      let totalEac = 0
      let totalRevenue = 0

      for (const item of jobItems) {
        const isProfitLine = item.cost_code === '1111' ||
          item.description?.trim().toLowerCase() === 'profit'
        const spent = spentByItem[item.id] || 0
        const contracted = contractedByItem[item.id] || 0
        const autoEac = contracted > 0
          ? Math.max(contracted, spent)
          : Math.max(spent, Number(item.budget_amount ?? 0))
        const eac = item.forecast_eac != null ? Number(item.forecast_eac) : autoEac
        const revenue = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount ?? 0)
        totalRevenue += revenue
        if (!isProfitLine) totalEac += eac  // profit line is revenue, not a cost to complete
      }

      // Add unassigned costs and commitments — they count against profit even without a budget line
      const unassignedCost = unassignedCostByJob[job_id] || 0
      const unassignedContract = unassignedContractByJob[job_id] || 0
      const unassignedEac = Math.max(unassignedContract, unassignedCost)
      totalEac += unassignedEac

      const contractVal = jobContractValue[job_id] ?? 0
      const revenue = contractVal || totalRevenue
      const projectedProfit = revenue - totalEac
      const marginPct = revenue > 0 ? Math.round((projectedProfit / revenue) * 100) : 0

      profits[job_id] = {
        contract_value: revenue,
        eac: Math.round(totalEac),
        projected_profit: Math.round(projectedProfit),
        margin_pct: marginPct,
        has_budget: jobItems.length > 0,
        unassigned_cost: Math.round(unassignedEac),
      }
    }

    return Response.json({ profits })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
