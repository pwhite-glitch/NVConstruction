// Owner-facing General Conditions rollup for the G703 (migration 037).
// Budget lines flagged roll_into_gc are combined into one "General Conditions"
// row, placed where the first flagged line would fall. Detail lines are never
// changed in the database — this only shapes what the owner's PDF shows.

export const GC_ROLLUP_LABEL = 'General Conditions'

const r2 = n => Math.round(n * 100) / 100

// lines: computed G703 rows ({ scheduled, prevAmt, thisAmt, totalAmt, retainage, ... }).
// flaggedIds: Set of budget_item_ids marked roll_into_gc.
// Returns new rows with idx renumbered 1..n. Totals across all rows are unchanged.
export function rollupGeneralConditions(lines, flaggedIds) {
  const isGc = l => l.budget_item_id != null && flaggedIds.has(l.budget_item_id)
  if (!lines.some(isGc)) return lines

  const gcLines = lines.filter(isGc)
  const sum = key => r2(gcLines.reduce((a, l) => a + (Number(l[key]) || 0), 0))
  const scheduled = sum('scheduled')
  const totalAmt = sum('totalAmt')
  const totalPct = scheduled > 0 ? totalAmt / scheduled * 100 : 0
  const combined = {
    budget_item_id: null,
    cost_code: '',
    description: GC_ROLLUP_LABEL,
    scheduled,
    prevAmt: sum('prevAmt'),
    thisAmt: sum('thisAmt'),
    totalAmt,
    totalPct,
    // Lump-sum contracts: individual GC lines may run over; only the combined row is judged.
    isOverbilled: totalPct > 100 + 0.01,
    balance: r2(scheduled - totalAmt),
    retainage: sum('retainage'),
  }

  const out = []
  for (const l of lines) {
    if (!isGc(l)) out.push(l)
    else if (l === gcLines[0]) out.push(combined)
  }
  return out.map((l, i) => ({ ...l, idx: i + 1 }))
}
