// Retry a write when the database is missing one of the columns in the row
// (a migration that isn't applied yet). Drops ONLY the column the error names, and only
// if that column is on the caller's optional list (fallbackCols); any other named column
// (is_credit, amount, job_id, status, a typo, a stray '0' key …) stops the retry and the
// original error is returned. Never drops a column twice; stops after at most one retry
// per key in the row. Pure: the caller passes `run(row) → { data, error }`.
// `row` may be an object or an array of rows (bulk insert): a dropped column is removed
// from EVERY row.
//
// Error shapes handled:
//   PostgREST PGRST204: Could not find the 'X' column of 'direct_costs' in the schema cache
//   Postgres 42703:     column "X" of relation "direct_costs" does not exist
//                       column direct_costs.X does not exist

// Never dropped by the name-less fallback strip: money / identity / status and the
// columns whose loss would silently change what the row means.
export const NEVER_FALLBACK_STRIP = new Set(['purchase_order_id', 'is_credit', 'amount', 'job_id', 'status'])
// Never dropped at all, even when named and listed: the row would mean something else without them.
const CORE_COLS = new Set(['amount', 'job_id', 'status', 'is_credit'])

export function missingColumnName(error) {
  if (!error) return null
  const msg = String(error.message || '')
  let m = msg.match(/Could not find the '([^']+)' column/i)
  if (m) return m[1]
  m = msg.match(/column "([^"]+)"(?: of relation "[^"]+")? does not exist/i)
  if (m) return m[1]
  m = msg.match(/column (?:"?[\w]+"?\.)?"?([\w]+)"? does not exist/i)
  if (m) return m[1]
  return null
}

export function isMissingColumnError(error) {
  if (!error) return false
  const msg = String(error.message || '')
  return error.code === 'PGRST204' || error.code === '42703' || msg.includes('schema cache') || /column .+ does not exist/i.test(msg)
}

// fallbackCols: the optional columns that may be dropped (by name, or as a group when the
// error doesn't name a column; the group strip still skips NEVER_FALLBACK_STRIP).
// Returns { data, error, row, dropped }: row is what was last sent, dropped the keys removed.
export async function writeWithMissingColumnRetry(run, row, { fallbackCols = [] } = {}) {
  const optional = new Set(fallbackCols)
  const isArr = Array.isArray(row)
  let current = isArr ? row.map(r => ({ ...r })) : { ...row }
  const rowsOf = c => (isArr ? c : [c])
  const keysOf = c => [...new Set(rowsOf(c).flatMap(r => Object.keys(r || {})))]
  const without = (c, strip) => {
    const omit = r => Object.fromEntries(Object.entries(r || {}).filter(([k]) => !strip.includes(k)))
    return isArr ? c.map(omit) : omit(c)
  }
  const dropped = []
  const maxRetries = keysOf(current).length
  let res = await run(current)
  for (let i = 0; i < maxRetries && res?.error && isMissingColumnError(res.error); i++) {
    const col = missingColumnName(res.error)
    const keys = keysOf(current)
    let strip
    if (col) {
      // Can't help if it isn't in the row, was already dropped, isn't optional, or is a core column.
      if (!keys.includes(col) || dropped.includes(col) || !optional.has(col) || CORE_COLS.has(col)) break
      strip = [col]
    } else {
      strip = keys.filter(k => optional.has(k) && !NEVER_FALLBACK_STRIP.has(k))
      if (!strip.length) break
    }
    const next = without(current, strip)
    if (rowsOf(next).some(r => !Object.keys(r).length)) break
    dropped.push(...strip)
    current = next
    res = await run(current)
  }
  return { data: res?.data ?? null, error: res?.error ?? null, row: current, dropped }
}

// True when the caller asked to set a PO link and the retry had to drop it.
// For a bulk insert: true when any row asked for a link.
export function poLinkDropped(requestedRow, dropped) {
  if (!dropped.includes('purchase_order_id')) return false
  const rows = Array.isArray(requestedRow) ? requestedRow : [requestedRow]
  return rows.some(r => !!(r && r.purchase_order_id))
}
