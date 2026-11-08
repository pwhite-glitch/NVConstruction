// Pure money helpers for the residential job detail page.

const num = v => Number(v || 0)

// Two amounts differ when they are more than one cent apart.
export function amountsDiffer(a, b, tolerance = 0.01) {
  return Math.abs(num(a) - num(b)) > tolerance + 1e-9
}

// Packaged total for a Billing → Draw Request: linked direct costs (credits
// negative) + linked APPROVED billing submissions' amount_billed. A pending invoice a
// sub filed into the draw is "awaiting approval" (not in the total); rejected ones never count.
export function packagedDrawTotal(drawId, directCosts = [], billingSubmissions = []) {
  const costs = directCosts
    .filter(c => c.draw_request_id === drawId)
    .reduce((a, c) => a + (c.is_credit ? -1 : 1) * num(c.amount), 0)
  const billings = billingSubmissions
    .filter(b => b.draw_request_id === drawId && b.status === 'approved')
    .reduce((a, b) => a + num(b.amount_billed), 0)
  return costs + billings
}

// Billings tagged to a draw that are still pending (filed into the draw by the sub,
// not reviewed yet): listed as "awaiting approval", never in the packaged total.
export function drawAwaitingBillings(drawId, billingSubmissions = []) {
  return (billingSubmissions || []).filter(b => b.draw_request_id === drawId && b.status === 'pending')
}

export function approvedCOTotal(changeOrders = []) {
  return changeOrders
    .filter(c => c.status === 'approved')
    .reduce((a, c) => a + num(c.amount), 0)
}

// jobs.contract_value is the base contract; approved COs are added on top.
export function revisedContract(job, changeOrders = []) {
  return num(job?.contract_value) + approvedCOTotal(changeOrders)
}

// Bank (owner) amount for a budget line: owner_amount, or budget_amount when blank.
export function bankAmount(item) {
  return item?.owner_amount ?? item?.budget_amount ?? 0
}

// Budget-line deltas a prime CO applies on approval: its sov rows when present,
// otherwise the whole amount on budget_item_id.
export function coBudgetDeltas(co) {
  const sov = Array.isArray(co?.sov) ? co.sov.filter(r => r && r.budget_item_id && num(r.amount) !== 0) : []
  if (sov.length) return sov.map(r => ({ budget_item_id: r.budget_item_id, amount: num(r.amount) }))
  if (co?.budget_item_id && num(co.amount) !== 0) return [{ budget_item_id: co.budget_item_id, amount: num(co.amount) }]
  return []
}

// New budget_amount / owner_amount after adding a CO to a line. `delta` is the sale price
// (Bank / owner_amount); `costDelta` is Nv's cost (Cost / budget_amount) and defaults to
// the price, which is the commercial rule and the residential rule when nv_cost is blank.
// JS mirror of public.prime_co_review (049 / 058).
export function applyDelta(item, delta, costDelta = delta) {
  return {
    budget_amount: num(item.budget_amount) + num(costDelta),
    owner_amount: num(item.owner_amount ?? item.budget_amount) + num(delta),
  }
}

// Residential homeowner CO: Nv's cost. nv_cost null / blank = same as the sale price
// (amount), so COs from before migration 058 and COs saved with the field blank keep
// adding the sale price to Cost.
export function coNvCost(co) {
  const c = co?.nv_cost
  return c === null || c === undefined || c === '' ? num(co?.amount) : num(c)
}

// Per-line { budget_item_id, price, cost } a residential CO applies (mirror of 058).
// The cost goes on the CO's single line; with nv_cost set and more than one line the
// database refuses (no invented split), so this returns { error } for that case.
export function coResidentialDeltas(co) {
  const lines = coBudgetDeltas(co)
  const hasCost = !(co?.nv_cost === null || co?.nv_cost === undefined || co?.nv_cost === '')
  if (!hasCost) return { lines: lines.map(l => ({ budget_item_id: l.budget_item_id, price: l.amount, cost: l.amount })) }
  if (lines.length > 1) return { error: 'Residential Nv cost applies to one budget line only.', lines: [] }
  return { lines: lines.map(l => ({ budget_item_id: l.budget_item_id, price: l.amount, cost: num(co.nv_cost) })) }
}

// Base contract + approved COs at Nv's cost (nv_cost ?? amount): what the Cost column
// should add up to. Older COs (null nv_cost) count at their sale price, as they were applied.
export function expectedCostTotal(job, changeOrders = []) {
  return num(job?.contract_value) + (changeOrders || [])
    .filter(c => c.status === 'approved')
    .reduce((a, c) => a + coNvCost(c), 0)
}

// Budget tab mismatch banner: Bank vs the REVISED contract (base + approved sale prices),
// Cost vs base + approved Nv cost. Cost below the revised (sale) contract because of an
// Nv cost under the price is expected and is not flagged.
export function budgetContractCheck({ job, changeOrders = [], costTotal = 0, bankTotal = 0 }) {
  const revised = revisedContract(job, changeOrders)
  const expectedCost = expectedCostTotal(job, changeOrders)
  return {
    revised,
    expectedCost,
    bankMismatch: amountsDiffer(bankTotal, revised),
    costMismatch: amountsDiffer(costTotal, expectedCost),
  }
}

// ── Direct costs ──────────────────────────────────────────────────────────────
// A cost's signed amount: returns/credits count negative.
export function signedDcAmount(c) {
  return (c?.is_credit ? -1 : 1) * num(c?.amount)
}

// Approved direct costs only (pending/rejected excluded), credits negative.
// With budgetItemId, only that budget line.
export function approvedDcTotal(directCosts = [], budgetItemId = undefined) {
  return (directCosts || [])
    .filter(c => c?.status === 'approved' && (budgetItemId === undefined || c.budget_item_id === budgetItemId))
    .reduce((a, c) => a + signedDcAmount(c), 0)
}

// ── Subcontract commitments ───────────────────────────────────────────────────
// Committed on one budget line from subcontracts plus their approved sub change
// orders. This is the commercial job page's committedForItem contract logic,
// moved here so both pages use the same code:
//  - a contract with budget_allocations is split by each allocation's share;
//    otherwise all of contract_value goes to its budget_item_id;
//  - an approved sub CO with SOV rows counts only on the rows' lines; otherwise
//    it follows its contract's allocation / budget line.
// subCOs: change_orders rows ({ subcontract_id, status, amount, sov }).
export function contractCommittedForItem(contracts = [], subCOs = [], budgetItemId) {
  return (contracts || []).reduce((total, c) => {
    const base = num(c.contract_value)
    const allocs = c.budget_allocations
    let baseAmount = 0
    if (allocs && allocs.length > 0) {
      const match = allocs.find(a => a.budget_item_id === budgetItemId)
      if (match) {
        const totalAlloc = allocs.reduce((s, a) => s + num(a.amount), 0)
        const pct = totalAlloc > 0 ? num(match.amount) / totalAlloc : 0
        baseAmount = pct * base
      }
    } else if (c.budget_item_id === budgetItemId) {
      baseAmount = base
    }
    const coAmount = (subCOs || [])
      .filter(co => co.subcontract_id === c.id && co.status === 'approved')
      .reduce((coTotal, co) => {
        const sovLines = (co.sov || []).filter(s => s.budget_item_id)
        if (sovLines.length > 0) {
          const sovMatch = sovLines.find(s => s.budget_item_id === budgetItemId)
          return coTotal + (sovMatch ? num(sovMatch.amount) : 0)
        }
        const coAmt = num(co.amount)
        if (allocs && allocs.length > 0) {
          const match = allocs.find(a => a.budget_item_id === budgetItemId)
          if (!match) return coTotal
          const totalAlloc = allocs.reduce((s, a) => s + num(a.amount), 0)
          const pct = totalAlloc > 0 ? num(match.amount) / totalAlloc : 0
          return coTotal + pct * coAmt
        }
        if (c.budget_item_id === budgetItemId) return coTotal + coAmt
        return coTotal
      }, 0)
    return total + baseAmount + coAmount
  }, 0)
}

// Contracts tied to no budget line (no allocations, no budget_item_id): they are
// not in any line's committed amount, so the page flags them.
export function unlinkedContracts(contracts = []) {
  return (contracts || []).filter(c => !(c.budget_allocations && c.budget_allocations.length > 0) && !c.budget_item_id)
}

// Committed total = sum of the per-line amounts (so card and line totals agree).
export function committedTotalForLines(contracts = [], subCOs = [], budgetItems = []) {
  return (budgetItems || []).reduce((a, b) => a + contractCommittedForItem(contracts, subCOs, b.id), 0)
}

// A contract's value with its approved sub COs (pending/rejected not counted).
export function contractRevisedValue(contract, subCOs = []) {
  return num(contract?.contract_value) + (subCOs || [])
    .filter(co => co.subcontract_id === contract?.id && co.status === 'approved')
    .reduce((a, co) => a + num(co.amount), 0)
}
