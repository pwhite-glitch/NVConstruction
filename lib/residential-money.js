// Pure money helpers for the residential job detail page.

const num = v => Number(v || 0)

// Two amounts differ when they are more than one cent apart.
export function amountsDiffer(a, b, tolerance = 0.01) {
  return Math.abs(num(a) - num(b)) > tolerance + 1e-9
}

// Packaged total for a Billing → Draw Request: linked direct costs (credits
// negative) + linked billing submissions' amount_billed.
export function packagedDrawTotal(drawId, directCosts = [], billingSubmissions = []) {
  const costs = directCosts
    .filter(c => c.draw_request_id === drawId)
    .reduce((a, c) => a + (c.is_credit ? -1 : 1) * num(c.amount), 0)
  const billings = billingSubmissions
    .filter(b => b.draw_request_id === drawId)
    .reduce((a, b) => a + num(b.amount_billed), 0)
  return costs + billings
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

// New budget_amount / owner_amount after adding `delta` to a line.
export function applyDelta(item, delta) {
  return {
    budget_amount: num(item.budget_amount) + num(delta),
    owner_amount: num(item.owner_amount ?? item.budget_amount) + num(delta),
  }
}
