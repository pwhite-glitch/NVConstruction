// Drawing a direct cost onto an owner pay app (G703 line) and undoing it.
// Pure, in integer cents. Used by /api/aia-draw (server decides) and the job page
// (applies the server's answer to its unsaved screen copy). No imports.
//
// Rules
// - Signed amount: an expense adds, a Return / Credit (is_credit, or a negative amount)
//   subtracts. Markup and rounding are the same both ways:
//     cents = round(|amount| * 100 * (1 + markup% / 100)), then the sign.
//   $100 expense @10% → +$110.00; $100 credit @10% → −$110.00.
// - Bounds: the line's total completed to date (previous apps + this period) stays within
//   0 … scheduled value. A draw only moves "this period" toward that range; it never pulls a
//   hand-typed amount that is already outside it back in (manual G703 amounts are kept).
// - What was ACTUALLY applied (after the bound) is stored on the cost
//   (direct_costs.drawn_aia_delta, PROPOSED in migration 045). Undo subtracts exactly that,
//   so Draw then Undo always returns the line to where it was.
// - A $0 scheduled line or a line missing from the budget: nothing can be applied, so the
//   draw is refused with a reason instead of tagging the cost with no G703 effect.

export const toCents = n => Math.round(Number(n || 0) * 100)
export const fromCents = c => Math.round(Number(c || 0)) / 100

export const isCreditCost = cost => !!cost?.is_credit || Number(cost?.amount) < 0

// Signed cents this cost adds to (or takes off) a G703 line, with markup.
export function signedDrawCents(cost, markupPct) {
  const base = Math.abs(toCents(cost?.amount))
  const m = Number(markupPct)
  const mult = 1 + (Number.isFinite(m) ? m : 0) / 100
  const withMarkup = Math.round(base * mult)
  return isCreditCost(cost) ? -withMarkup : withMarkup
}

// Apply `deltaCents` to a line. All inputs in cents.
// Returns { appliedCents, newThisCents } or { error } (nothing applied).
export function applyDrawDelta({ thisCents, prevCents, scheduledCents, deltaCents }) {
  const cur = Math.round(Number(thisCents || 0))
  const prev = Math.round(Number(prevCents || 0))
  const sched = Math.round(Number(scheduledCents || 0))
  const delta = Math.round(Number(deltaCents || 0))
  if (!(sched > 0)) return { error: 'This budget line has a $0 scheduled value on the pay app, so nothing can be drawn to it.' }
  if (delta === 0) return { error: 'This cost is $0, so there is nothing to draw.' }
  const lo = -prev          // total to date can't go below 0
  const hi = sched - prev   // total to date can't go above the scheduled value
  let next
  if (delta > 0) next = Math.max(cur, Math.min(cur + delta, hi))
  else next = Math.min(cur, Math.max(cur + delta, lo))
  const applied = next - cur
  if (applied === 0) {
    return { error: delta > 0
      ? 'This line is already billed to its full scheduled value, so the draw would add nothing.'
      : 'This line has nothing billed to date to take a credit against, so the draw would change nothing.' }
  }
  return { appliedCents: applied, newThisCents: next }
}

// Exact inverse of a recorded draw.
export function undoDrawDelta({ thisCents, appliedCents }) {
  return { newThisCents: Math.round(Number(thisCents || 0)) - Math.round(Number(appliedCents || 0)) }
}

// pct_this_period for a this-period dollar amount (same formula saveAiaLines uses).
export function pctOf(thisCents, scheduledCents) {
  const sched = Math.round(Number(scheduledCents || 0))
  return sched > 0 ? (Math.round(Number(thisCents || 0)) / sched) * 100 : 0
}

// The screen copy of a G703 line after the server applied `appliedCents` (signed).
// Keeps dollar_this / pct_this aligned; recalcPinnedLines runs after this on the page.
export function shiftScreenLine(line, appliedCents) {
  const sched = toCents(line.budget_amount)
  const cur = line.dollar_this !== undefined && line.dollar_this !== null
    ? toCents(line.dollar_this)
    : Math.round(sched * (parseFloat(line.pct_this) || 0) / 100)
  const next = cur + Math.round(Number(appliedCents || 0))
  return { ...line, dollar_this: fromCents(next), pct_this: String(pctOf(next, sched)) }
}
