import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'
import { fetchAll } from '../../../lib/budget-line-refs'
import { jobEacSummary, signedCost } from '../../../lib/eac-forecast'
import { unlinkedContracts, contractRevisedValue } from '../../../lib/residential-money'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Only a missing TABLE (not migrated in this database) reads as empty. A missing column
// (42703 / PGRST204) or relationship/embed (PGRST200), or any other failure, stays an
// error → 500 (prompt63: a failed read must not silently drop costs).
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
const NOT_A_MISSING_TABLE_CODES = new Set(['42703', 'PGRST204', 'PGRST200'])
function isMissingTable(error) {
  if (!error) return false
  if (MISSING_TABLE_CODES.has(error.code)) return true
  if (NOT_A_MISSING_TABLE_CODES.has(error.code)) return false
  const msg = error.message || ''
  return /relation .* does not exist/i.test(msg) || /could not find the table/i.test(msg)
}
async function optional(p) {
  const r = await p
  return r.error && isMissingTable(r.error) ? { data: [], error: null } : r
}

// fetchAll over an id list in chunks (keeps the in() URL short).
async function fetchInChunks(ids, build, size = 200) {
  const out = []
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size)
    const r = await fetchAll(() => build(chunk))
    if (r.error) return r
    out.push(...(r.data || []))
  }
  return { data: out, error: null }
}

// EAC per line uses lib/eac-forecast.js, the same code as the job page's Budget → EAC Forecast:
// auto EAC = max(budget, committed, spent); committed = contracts (explicit or SOV-line
// allocations, revised amounts) + approved sub COs + labor + approved direct costs (credits
// negative) + issued/received POs; an override (forecast_eac) wins.
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
    const [itemsRes, costsRes, contractsRes, summaryRes, jobsRes, posRes, allocRes] = await Promise.all([
      fetchAll(() => adminSupabase.from('budget_items')
        .select('id, job_id, budget_amount, owner_amount, forecast_eac, cost_code, description')
        .in('job_id', job_ids)
        .order('id')),
      // is_credit: returns / credits subtract (migration 022; read without fallback, like ask-ai).
      fetchAll(() => adminSupabase.from('direct_costs')
        .select('id, job_id, budget_item_id, amount, status, is_credit')
        .in('job_id', job_ids)
        .eq('status', 'approved')
        .order('id')),
      // Base table: budget line / allocations / status of each contract, and its original value.
      // Drafts are counted, as on the job page (loadContracts reads every contract on the job).
      fetchAll(() => adminSupabase.from('subcontracts')
        .select('id, job_id, budget_item_id, budget_allocations, status, contract_value')
        .in('job_id', job_ids)
        .order('id')),
      // Revised value (approved sub COs included) lives only on the subcontract_summary view.
      fetchAll(() => adminSupabase.from('subcontract_summary')
        .select('id, adjusted_contract_value')
        .in('job_id', job_ids)
        .order('id')),
      fetchAll(() => adminSupabase.from('jobs')
        .select('id, contract_value')
        .in('id', job_ids)
        .order('id')),
      // Issued / received POs count as committed on their budget line.
      optional(fetchAll(() => adminSupabase.from('purchase_orders')
        .select('id, job_id, budget_item_id, amount, status')
        .in('job_id', job_ids)
        .in('status', ['issued', 'received'])
        .order('id'))),
      // Labor: same rows GET /api/employee-allocations?job_id= gives the job page (Owner view).
      optional(fetchAll(() => adminSupabase.from('employee_job_allocations')
        .select('id, job_id, allocation_type, percentage, start_date, end_date, budget_item_id, budget_line, employees(weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes)')
        .in('job_id', job_ids)
        .eq('allocation_type', 'pm_allocation')
        .order('id'))),
    ])
    const reads = { budget_items: itemsRes, direct_costs: costsRes, subcontracts: contractsRes, subcontract_summary: summaryRes, jobs: jobsRes, purchase_orders: posRes, employee_job_allocations: allocRes }
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
    const baseContracts = contractsRes.data || []

    // SOV-line budget assignments (used when a contract has no explicit budget_allocations)
    // and approved sub change orders with their SOV rows — as the job page loads them.
    const contractIds = baseContracts.map(c => c.id)
    const [sovRes, cosRes] = await Promise.all([
      optional(fetchInChunks(contractIds, ids => adminSupabase.from('subcontract_sov_lines')
        .select('id, subcontract_id, budget_item_id, scheduled_value')
        .in('subcontract_id', ids)
        .order('id'))),
      optional(fetchInChunks(contractIds, ids => adminSupabase.from('change_orders')
        .select('id, subcontract_id, status, amount, sov')
        .in('subcontract_id', ids)
        .eq('status', 'approved')
        .order('id'))),
    ])
    for (const [name, r] of Object.entries({ subcontract_sov_lines: sovRes, change_orders: cosRes })) {
      if (r.error) {
        console.error(`job-profit ${name}:`, r.error.message)
        return Response.json({ error: 'Could not load job profit numbers. Please try again.' }, { status: 500 })
      }
    }
    const sovAllocByContract = {}
    for (const l of sovRes.data || []) {
      if (!l.budget_item_id) continue
      const m = (sovAllocByContract[l.subcontract_id] ||= {})
      m[l.budget_item_id] = (m[l.budget_item_id] || 0) + Number(l.scheduled_value || 0)
    }
    // Same merge as the job page's loadContracts: explicit allocations, else SOV-line ones.
    // No summary row for a contract → its original contract_value (prompt63).
    const contracts = baseContracts.map(c => {
      const explicit = Array.isArray(c.budget_allocations) ? c.budget_allocations : []
      const sovAllocs = Object.entries(sovAllocByContract[c.id] || {}).map(([budget_item_id, amount]) => ({ budget_item_id, amount }))
      return { ...c, budget_allocations: explicit.length > 0 ? explicit : sovAllocs, adjusted_contract_value: adjustedById.get(c.id) ?? null }
    })
    const subCOs = cosRes.data || []
    const pos = posRes.data || []
    const allocations = allocRes.data || []
    const now = new Date()

    const jobContractValue = {}
    for (const j of jobsData) {
      jobContractValue[j.id] = Number(j.contract_value ?? 0)
    }

    const profits = {}
    for (const job_id of job_ids) {
      const jobItems = items.filter(i => i.job_id === job_id)
      const jobContracts = contracts.filter(c => c.job_id === job_id)
      const jobCosts = costs.filter(c => c.job_id === job_id).map(c => ({ ...c, status: c.status || 'approved' }))
      const { totals } = jobEacSummary({
        items: jobItems,
        contracts: jobContracts,
        subCOs: subCOs.filter(co => jobContracts.some(c => c.id === co.subcontract_id)),
        directCosts: jobCosts,
        purchaseOrders: pos.filter(p => p.job_id === job_id),
        allocations: allocations.filter(a => a.job_id === job_id),
        now,
      })
      let totalEac = totals.costEac  // profit line is revenue, not a cost to complete
      const totalRevenue = totals.revenue

      // Add unassigned costs and commitments — they count against profit even without a budget line
      const unassignedCost = jobCosts.filter(c => !c.budget_item_id).reduce((a, c) => a + signedCost(c), 0)
      const unassignedContract = unlinkedContracts(jobContracts)
        .reduce((a, c) => a + Number(c.adjusted_contract_value ?? contractRevisedValue(c, subCOs)), 0)
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
