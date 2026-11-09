// EAC (Estimate at Completion) math shared by the job page's Budget → "EAC Forecast"
// view and /api/job-profit (Business Dev margins), so both show the same numbers.
// Pure: no React, no database.
import { contractCommittedForItem, contractRevisedValue } from './residential-money'

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Profit line items (cost_code 1111 or description "profit") are revenue, not costs.
export function isProfitLine(item) {
  return item?.cost_code === '1111' || item?.description?.trim().toLowerCase() === 'profit'
}

// Contract allocation share for one line: { matched, pct } (budget_allocations split, else budget_item_id).
function contractShare(c, itemId) {
  const allocs = Array.isArray(c.budget_allocations) ? c.budget_allocations : []
  if (allocs.length > 0) {
    const match = allocs.find(a => a.budget_item_id === itemId)
    if (!match) return 0
    const total = allocs.reduce((s, a) => s + num(a.amount), 0)
    return total > 0 ? num(match.amount) / total : 0
  }
  return c.budget_item_id === itemId ? 1 : 0
}

// Subcontracts + approved sub COs on one budget line (lib/residential-money
// contractCommittedForItem). A contract may also carry a revised total
// (adjusted_contract_value from subcontract_summary): any part of it not explained by
// contract_value + the approved COs passed in is spread like a CO without SOV rows
// (by the contract's allocations / budget line). When the COs are all loaded this adds 0.
export function revisedRemainderForLine(contracts = [], subCOs = [], itemId) {
  let total = 0
  for (const c of contracts || []) {
    if (c.adjusted_contract_value == null) continue
    const rest = num(c.adjusted_contract_value) - contractRevisedValue(c, subCOs)
    if (Math.abs(rest) < 0.005) continue
    total += contractShare(c, itemId) * rest
  }
  return total
}

export function contractCommittedForLine(contracts = [], subCOs = [], itemId) {
  return contractCommittedForItem(contracts, subCOs, itemId) + revisedRemainderForLine(contracts, subCOs, itemId)
}

// Labor on one line: pm_allocation rows (by budget_item_id, or by the "code — description"
// text in budget_line) × weekly rate × percentage × days elapsed (start → end_date or now).
export function laborCostForLine(allocations = [], item, now = new Date()) {
  if (!item) return 0
  const itemText = `${item.cost_code ? item.cost_code + ' — ' : ''}${item.description}`
  const nowDate = now instanceof Date ? now : new Date(now)
  return (allocations || [])
    .filter(a => {
      if (a.allocation_type !== 'pm_allocation') return false
      if (a.budget_item_id) return a.budget_item_id === item.id
      if (a.budget_line) return a.budget_line === itemText
      return false
    })
    .reduce((sum, a) => {
      const emp = a.employees
      if (!emp) return sum
      const weeklyRate = num(emp.weekly_salary) + num(emp.weekly_truck) + num(emp.weekly_healthcare) + num(emp.weekly_taxes)
      const pct = a.percentage != null ? Number(a.percentage) : 100
      const start = a.start_date ? new Date(a.start_date) : null
      const end = a.end_date ? new Date(a.end_date) : nowDate
      const days = start ? Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000))) : 0
      return sum + (weeklyRate * pct / 100 * days / 7)
    }, 0)
}

// Committed on one line = contracts (+ approved sub COs) + labor + approved direct costs
// (credits negative) + issued/received POs. Same parts as the job page's committedForItem.
// contractCommitted: the caller's contractCommittedForItem result, if it already has it
// (the revised-amount remainder is still added).
export function committedForBudgetLine({ itemId, contracts = [], subCOs = [], directCosts = [], purchaseOrders = [], laborForItem = 0, contractCommitted: given = null }) {
  const contractCommitted = given != null
    ? num(given) + revisedRemainderForLine(contracts, subCOs, itemId)
    : contractCommittedForLine(contracts, subCOs, itemId)
  const dcCommitted = (directCosts || [])
    .filter(c => c.status === 'approved' && c.budget_item_id === itemId)
    .reduce((a, c) => a + (c.is_credit ? -1 : 1) * num(c.amount), 0)
  const poCommitted = (purchaseOrders || [])
    .filter(po => (po.status === 'issued' || po.status === 'received') && po.budget_item_id === itemId)
    .reduce((a, po) => a + num(po.amount), 0)
  return contractCommitted + num(laborForItem) + dcCommitted + poCommitted
}

// Signed amount of one cost: a credit (is_credit, or a negative amount) subtracts.
export function signedCost(c) {
  const a = num(c?.amount)
  return c?.is_credit ? -Math.abs(a) : a
}

// Approved direct costs on one line, credits subtracting.
export function spentForBudgetLine(directCosts = [], itemId) {
  return (directCosts || [])
    .filter(c => c.status === 'approved' && c.budget_item_id === itemId)
    .reduce((a, c) => a + signedCost(c), 0)
}

// Auto EAC: unbought scope still costs its budget, so never below budget unless the
// line is bought out. There is no "bought out" flag today: callers pass false.
export function autoEacForLine({ budget, committed, spent, boughtOut = false }) {
  const b = num(budget), c = num(committed), s = num(spent)
  return boughtOut ? Math.max(c, s) : Math.max(b, c, s)
}

// A typed override wins over the auto number.
export function eacForLine(item, auto) {
  return item?.forecast_eac != null && item.forecast_eac !== '' ? Number(item.forecast_eac) : auto
}

/**
 * Per-line rows and totals for one job, with the job page's definitions:
 *   revenue = owner_amount ?? budget_amount; profit lines are revenue (no EAC / variance);
 *   variance = budget − EAC; projProfit = revenue − EAC (profit line: revenue).
 * Sources: contracts, subCOs, directCosts (any status; approved used), purchaseOrders,
 * allocations (employee_job_allocations with employees), now (labor date math).
 * laborFor(item) / committedFor(item) may be passed to override the defaults.
 */
export function jobEacSummary({
  items = [], contracts = [], subCOs = [], directCosts = [], purchaseOrders = [], allocations = [],
  now = new Date(), isProfitItem = isProfitLine, laborFor = null, committedFor = null,
}) {
  const rows = (items || []).map(item => {
    const profit = !!isProfitItem(item)
    const budget = num(item.budget_amount)
    const spent = spentForBudgetLine(directCosts, item.id)
    const committed = committedFor
      ? committedFor(item)
      : committedForBudgetLine({
        itemId: item.id, contracts, subCOs, directCosts, purchaseOrders,
        laborForItem: laborFor ? laborFor(item) : laborCostForLine(allocations, item, now),
      })
    const autoEac = autoEacForLine({ budget, committed, spent, boughtOut: false })
    const eac = eacForLine(item, autoEac)
    const revenue = item.owner_amount != null ? num(item.owner_amount) : budget
    return {
      item, profit, budget, spent, committed, contracted: committed, autoEac, eac, revenue,
      variance: profit ? null : budget - eac,
      projProfit: profit ? revenue : revenue - eac,
    }
  })
  const totals = rows.reduce((t, r) => ({
    budget: t.budget + r.budget,
    revenue: t.revenue + r.revenue,
    spent: t.spent + r.spent,
    committed: t.committed + r.committed,
    contracted: t.contracted + r.committed,
    eac: t.eac + r.eac,
    costEac: t.costEac + (r.profit ? 0 : r.eac),
    variance: t.variance + (r.profit ? 0 : r.variance),
    projProfit: t.projProfit + r.projProfit,
  }), { budget: 0, revenue: 0, spent: 0, committed: 0, contracted: 0, eac: 0, costEac: 0, variance: 0, projProfit: 0 })
  return { rows, totals }
}

// What to save when the EAC input loses focus. `shown` = the text the input showed on
// focus; `typed` = its text now. Returns { save: false } or { save: true, value: number|null }
// (null clears the override), or { revert: true } for non-numeric input.
export function eacBlurAction({ shown, typed, hasOverride, autoEac }) {
  const t = typed == null ? '' : String(typed).trim()
  if (t === String(shown ?? '').trim()) return { save: false }
  if (t === '') return hasOverride ? { save: true, value: null } : { save: false }
  const n = Number(t)
  if (!Number.isFinite(n)) return { save: false, revert: true }
  const autoShown = Math.round(num(autoEac))
  if (n === autoShown || n === num(autoEac)) return hasOverride ? { save: true, value: null } : { save: false }
  return { save: true, value: n }
}
