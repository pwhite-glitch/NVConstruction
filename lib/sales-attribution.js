// Split-sale credit (sales_attribution) validation. share_pct is a percent,
// 0 < share_pct <= 100, and an order's splits total 100.

// splits: [{ salesperson_id, salesperson_name?, share_pct }]
// staff: [{ id, full_name }] — people who may receive credit.
// Returns { rows } (insert-ready, allowed fields only) or { error }.
export function buildAttributionRows(orderId, splits, staff, recordedBy) {
  if (!Array.isArray(splits) || !splits.length) return { error: 'Add at least one rep.' }
  const byId = new Map((staff || []).map(p => [p.id, p]))
  const seen = new Set()
  const rows = []
  for (const s of splits) {
    const id = s?.salesperson_id
    if (!id) return { error: 'Each split needs a rep.' }
    if (seen.has(id)) return { error: 'A rep is listed twice.' }
    seen.add(id)
    const person = byId.get(id)
    if (!person) return { error: 'Unknown rep in splits.' }
    const pct = typeof s.share_pct === 'string' && s.share_pct.trim() !== '' ? Number(s.share_pct) : s.share_pct
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: 'Each share must be more than 0% and at most 100%.' }
    rows.push({
      order_id: orderId,
      salesperson_id: id,
      salesperson_name: person.full_name || s.salesperson_name || 'Unknown',
      share_pct: pct,
      recorded_by: recordedBy,
    })
  }
  const total = rows.reduce((a, r) => a + r.share_pct, 0)
  if (Math.abs(total - 100) > 0.01) return { error: `Splits must total 100% (now ${Math.round(total * 100) / 100}%).` }
  return { rows }
}
