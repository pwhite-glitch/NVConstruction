// Office edits to a subcontract's schedule of values (subcontract_sov_lines), through
// /api/subcontract-sov. Pure rules; the route does the reads.
//
// Rule: once ANY billing line (billing_sov_lines) points at an SOV line — pending, approved
// or rejected, even a $0 / 0% line — that SOV line is frozen:
//   - it can't be deleted (billing_sov_lines.sov_line_id is ON DELETE CASCADE live, so a
//     delete would destroy billing detail history)
//   - scheduled value, description and budget line can't change (each would rewrite what
//     past billings meant: % billed, what was billed, which budget line it hit)
// Only sort order may change. Unreferenced lines can be edited or deleted freely.
// The same rule is enforced in the database by migration 045 (PROPOSED, not applied).

export const SOV_FROZEN_FIELDS = ['scheduled_value', 'description', 'budget_item_id']

const cents = v => Math.round(Number(v || 0) * 100)
const SAME = {
  scheduled_value: (a, b) => cents(a) === cents(b),
  description: (a, b) => String(a ?? '').trim() === String(b ?? '').trim(),
  budget_item_id: (a, b) => (a || null) === (b || null),
}

export function sovFrozenChanges(line, fields = {}) {
  return SOV_FROZEN_FIELDS.filter(k => fields[k] !== undefined && !SAME[k](line?.[k], fields[k]))
}

// refCount: number of billing_sov_lines rows for this line (any status).
export function sovEditError(line, fields, refCount) {
  if (!line) return { status: 404, error: 'SOV line not found.' }
  if ('scheduled_value' in fields) {
    const v = Number(fields.scheduled_value)
    if (fields.scheduled_value === '' || !Number.isFinite(v)) return { status: 400, error: 'Scheduled value must be a number.' }
  }
  if ('description' in fields && !String(fields.description || '').trim()) return { status: 400, error: 'Description is required.' }
  if (!refCount) return null
  const changed = sovFrozenChanges(line, fields)
  if (!changed.length) return null
  return { status: 409, error: `This SOV line has been billed (${refCount} billing line${refCount === 1 ? '' : 's'}), so its ${changed.join(', ').replace(/_/g, ' ')} can't change. Add a new line (or a change order) instead.` }
}

export function sovDeleteError(line, refCount) {
  if (!line) return { status: 404, error: 'SOV line not found.' }
  if (refCount) return { status: 409, error: `This SOV line has been billed (${refCount} billing line${refCount === 1 ? '' : 's'}, including pending / rejected / $0 lines) and can't be deleted.` }
  return null
}

// Browser hint: why a line's Edit / Delete is locked. `refCount` comes from the loaded
// billing lines (any status). '' when not locked.
export function sovLockReason(refCount) {
  return refCount ? `Billed on ${refCount} billing line${refCount === 1 ? '' : 's'} — locked so billing history stays intact.` : ''
}

// Database errors from the 045 triggers, in words.
export function sovDbErrorMessage(message) {
  const m = String(message || '')
  if (/sov_line_billed/.test(m)) return 'This SOV line has been billed and can’t be changed or deleted.'
  return m
}
