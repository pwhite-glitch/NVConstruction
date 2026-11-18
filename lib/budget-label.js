// Budget line labels for tags / chips (prompt94).
//
// Long budget line descriptions ("Site utilities: storm drain (inlets, JB, RCP) + water tap/service ...")
// pushed the subcontract card wider than the viewport. Tags show a truncated label and carry the
// full text in a title attribute; the styles below keep them from widening their flex row.

// "22/33 · Site utilities ..." — cost code (if any) + description.
export function budgetLineLabel(item) {
  if (!item) return ''
  const desc = String(item.description || '').trim()
  const code = String(item.cost_code || '').trim()
  return code ? (desc ? `${code} · ${desc}` : code) : desc
}

// Cut text to at most `max` characters (ellipsis included). Whitespace is collapsed first.
export function truncateBudgetLabel(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!(max > 1) || s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

// Props for a budget tag: shortened display text + full text for the hover title.
export function budgetTagText(item, amount, max = 80) {
  const full = budgetLineLabel(item)
  const amt = amount != null && amount !== '' && Number.isFinite(Number(amount)) ? `$${Number(amount).toLocaleString()}` : ''
  return { text: truncateBudgetLabel(full, max), title: amt ? `${full} — ${amt}` : full }
}

// Tag that can shrink inside a flex row: never wider than its container (or ~420px), single line with ellipsis.
export const budgetTagStyle = {
  display: 'inline-flex', alignItems: 'baseline', gap: '4px',
  minWidth: 0, maxWidth: 'min(100%, 420px)', overflow: 'hidden',
}
// The text part of the tag — shrinks and ends in an ellipsis.
export const budgetTagTextStyle = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

// Budget item <select>s: long option labels must not widen the form.
export const budgetSelectStyle = { minWidth: 0, maxWidth: '100%', width: '100%', textOverflow: 'ellipsis' }

// Allocations as saved: same filter as before (budget line + amount set), plus drop amounts that
// aren't numbers; amounts are saved as numbers instead of the input's strings.
export function normalizeBudgetAllocations(allocs) {
  return (allocs || [])
    .filter(a => a && a.budget_item_id && a.amount)
    .filter(a => Number.isFinite(Number(a.amount)))
    .map(a => ({ ...a, amount: Number(a.amount) }))
}
