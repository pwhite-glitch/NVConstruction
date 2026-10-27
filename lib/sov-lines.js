// Subcontract SOV lines come in two kinds:
//   base lines — the sub's own schedule of values, which totals the base contract_value
//   CO lines   — one per approved change order, added automatically on approval
// CO lines carry change_order_id (migration 030). Rows from before that column
// existed are recognised by their "CO: " description prefix.

export const CO_LINE_PREFIX = 'CO: '

export function isCoLine(line) {
  return !!line?.change_order_id || String(line?.description || '').startsWith(CO_LINE_PREFIX)
}

// Set of subcontract ids that have at least one base (non-CO) line — i.e. the
// sub has set up their schedule of values.
export function contractsWithBaseSov(lines) {
  return new Set((lines || []).filter(l => !isCoLine(l)).map(l => l.subcontract_id))
}

export function coLineRow(co, sortOrder) {
  return {
    subcontract_id: co.subcontract_id,
    change_order_id: co.id,
    description: `${CO_LINE_PREFIX}${co.description}`,
    scheduled_value: parseFloat(co.amount),
    sort_order: sortOrder,
  }
}

// Inserts a CO line. Until migration 030 is applied the change_order_id column
// doesn't exist, so retry without it rather than losing the line.
export async function insertCoLine(client, row, select) {
  const run = r => {
    const q = client.from('subcontract_sov_lines').insert(r)
    return select ? q.select(select).single() : q
  }
  let res = await run(row)
  if (res.error && /change_order_id/.test(res.error.message || '')) {
    const { change_order_id, ...rest } = row
    res = await run(rest)
  }
  return res
}
