/**
 * Calculate the total billed amount for an estimate.
 * Per-line markup_pct/markup_flat override the estimate-level global when set.
 * Tax (8.25%) applies to raw cost only when est.taxable is true.
 */
export function calcTotal(est) {
  const globalPct = Number(est.markup_pct || 0)
  const globalFlat = Number(est.markup_flat || 0)
  const lines = est.estimate_line_items || []

  const raw    = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
  const billed = lines.reduce((a, l) => {
    const pct  = l.markup_pct  != null ? Number(l.markup_pct)  : globalPct
    const flat = l.markup_flat != null ? Number(l.markup_flat) : 0
    return a + Number(l.amount || 0) * (1 + pct / 100) + flat
  }, 0)

  return billed + globalFlat + (est.taxable ? raw * 0.0825 : 0)
}

export function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}
