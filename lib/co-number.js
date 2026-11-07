// Change order numbers shown on screen, on printouts, in emails and in the owner portal.
// No imports: used by the job pages, the owner portal and tests.
//
// The number is STORED, never derived from list position:
//   prime_change_orders.co_number  → PCO-001, numbered per job
//   change_orders.co_number        → SCO-001, numbered per subcontract
// Both columns are PROPOSED in migrations/045_billing_integrity_co_numbers_lookahead.sql
// (not applied yet). The database assigns the number on INSERT under a lock, it can't be
// changed afterwards, and a numbered CO can't be hard-deleted (reject it instead), so a
// number is never reused. The browser never sends or computes a number.
//
// Rows from before 045 (or before it is applied) have no number. They get a stable
// "Legacy CO <id suffix>" label — never a made-up PCO/SCO number, never list position.
// Historical numbering is separate approval work.

export const CO_PREFIX = { prime: 'PCO', sub: 'SCO' }

// Last 6 characters of the row id, upper-cased. Stable for the life of the row.
export const legacyCoSuffix = id => String(id || '').replace(/-/g, '').slice(-6).toUpperCase() || '??????'

export function hasStoredCoNumber(co) {
  const n = Number(co?.co_number)
  return co?.co_number != null && co.co_number !== '' && Number.isInteger(n) && n > 0
}

// 'PCO-007' / 'SCO-012', or 'Legacy CO 3F9A1C' for an unnumbered row.
export function coNumberLabel(co, kind = 'prime') {
  if (hasStoredCoNumber(co)) return `${CO_PREFIX[kind] || 'CO'}-${String(Number(co.co_number)).padStart(3, '0')}`
  return `Legacy CO ${legacyCoSuffix(co?.id)}`
}

// After an insert that returned the new row: null when it got a number, else a message
// that says plainly why not (column missing = migration 045 not applied).
export function coNumberMissingMessage(row) {
  if (hasStoredCoNumber(row)) return null
  const why = row && !('co_number' in row)
    ? 'CO numbering (migration 045) is not applied yet'
    : 'the database did not assign a CO number'
  return `Change order saved, but ${why}. It shows as "${coNumberLabel(row)}" until it has a stored number. No number was guessed from the list.`
}

// A numbered CO is permanent: reject it instead of deleting it. Unnumbered (legacy) rows
// keep the old delete behaviour.
export function coDeleteBlock(co) {
  if (!hasStoredCoNumber(co)) return null
  return `${coNumberLabel(co, co?.subcontract_id ? 'sub' : 'prime')} is a numbered change order and can't be deleted (its number must never be reused). Reject it instead.`
}

// Database messages from the 045 triggers, turned into something a PM can act on.
export function coDbErrorMessage(message) {
  const m = String(message || '')
  if (/co_number_immutable/.test(m)) return 'A change order number can’t be changed once assigned.'
  if (/co_numbered_no_delete/.test(m)) return 'This is a numbered change order and can’t be deleted. Reject it instead.'
  return m
}
