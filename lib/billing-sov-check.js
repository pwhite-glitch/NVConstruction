// Sub billing vs schedule of values: the dollar figures must follow the lines.
// Pure; used by /api/sub-portal/billing, the sub's billing form and the PM review row.

export const CENT = 0.01
const r2 = n => Math.round(Number(n) * 100) / 100
// Allow a hair over a cent for floating point (0.1 + 0.2 style noise).
const within = (a, b, tol = CENT) => Math.abs(Number(a) - Number(b)) <= tol + 1e-9

// The amount a line should carry for its % this period.
export function sovLineAmount(scheduledValue, pctThisPeriod) {
  return r2(Number(scheduledValue || 0) * Number(pctThisPeriod || 0) / 100)
}

// Check the lines a sub sent (`lines`: [{ sov_line_id, amount, pct_this_period }]) against
// their schedule (`sovById`: { id: { scheduled_value, description } }) and the typed total.
// `hasSchedule`: the sub has base SOV lines on this job, so lines are required.
// Returns { error } or { lines (cleaned, zero lines dropped), total }.
export function checkSovBilling({ lines, sovById, amountBilled, hasSchedule }) {
  const raw = Array.isArray(lines) ? lines : []
  for (const l of raw) {
    const pct = Number(l?.pct_this_period ?? 0)
    const amt = Number(l?.amount ?? 0)
    if (!Number.isFinite(pct) || !Number.isFinite(amt)) return { error: 'Line % and amount must be numbers.' }
    if (pct < 0 || amt < 0) return { error: 'Line % and amount can’t be negative.' }
  }
  const used = raw
    .map(l => ({ sov_line_id: l.sov_line_id, amount: r2(l.amount || 0), pct_this_period: Number(l.pct_this_period || 0) }))
    .filter(l => l.amount > 0 || l.pct_this_period > 0)

  if (!used.length) {
    if (hasSchedule) return { error: 'Fill in at least one schedule-of-values line. The amount billed comes from your lines.' }
    return { lines: [], total: null }
  }
  const seen = new Set()
  for (const l of used) {
    if (seen.has(l.sov_line_id)) return { error: 'A schedule-of-values line was sent twice.' }
    seen.add(l.sov_line_id)
    const sov = sovById?.[l.sov_line_id]
    if (!sov) return { error: 'One or more schedule-of-values lines do not belong to your subcontract.' }
    const expected = sovLineAmount(sov.scheduled_value, l.pct_this_period)
    if (!within(l.amount, expected)) {
      return { error: `"${sov.description || 'Line'}": $${l.amount.toFixed(2)} doesn't match ${l.pct_this_period}% of $${Number(sov.scheduled_value || 0).toFixed(2)} ($${expected.toFixed(2)}).` }
    }
  }
  const total = r2(used.reduce((a, l) => a + l.amount, 0))
  const typed = Number(amountBilled)
  if (!Number.isFinite(typed) || !within(typed, total)) {
    return { error: `Amount billed ($${Number.isFinite(typed) ? typed.toFixed(2) : '?'}) must equal the total of your lines ($${total.toFixed(2)}).` }
  }
  return { lines: used, total }
}

// PM side: header amount vs the saved lines (for rows saved before this check). Null when fine.
export function billingLinesMismatch(amountBilled, savedLines) {
  if (!Array.isArray(savedLines) || savedLines.length === 0) return null
  const total = r2(savedLines.reduce((a, l) => a + Number(l.amount || 0), 0))
  if (within(amountBilled || 0, total)) return null
  return { header: r2(amountBilled || 0), lines: total, diff: r2(Number(amountBilled || 0) - total) }
}
