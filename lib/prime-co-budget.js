// Owner (prime) change orders move budget_items.budget_amount / owner_amount by
// their SOV lines once applied. These helpers work out the per-line change.
// No imports: used by the job page and tests. jobs.contract_value is never touched.

const linked = sov => (Array.isArray(sov) ? sov : []).filter(r => r && r.budget_item_id && Number(r.amount))

// { budget_item_id: amount } summed over a CO's SOV lines that point at a budget line.
export function sovByBudgetItem(sov) {
  const out = {}
  for (const r of linked(sov)) out[r.budget_item_id] = (out[r.budget_item_id] || 0) + Number(r.amount)
  return out
}

// Change to apply to each budget line when an applied CO's SOV goes from
// oldSov to newSov (reverse old, apply new). Zero changes are left out.
export function sovBudgetDeltas(oldSov, newSov) {
  const before = sovByBudgetItem(oldSov)
  const after = sovByBudgetItem(newSov)
  const out = {}
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = Math.round(((after[id] || 0) - (before[id] || 0)) * 100) / 100
    if (d !== 0) out[id] = d
  }
  return out
}
