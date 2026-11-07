// Allowlist + validation for PUT /api/budget-items { id, fields }.
// Fields come from the existing edit callers: Budget edit (cost_code,
// description, budget_amount, owner_amount), GC roll-up toggle (roll_into_gc),
// Forecast EAC (forecast_eac) and change-order deltas (budget_amount, owner_amount).

export const BUDGET_EDITABLE_FIELDS = ['cost_code', 'description', 'budget_amount', 'owner_amount', 'roll_into_gc', 'forecast_eac']

// Returns { updates } or { error } for a PUT `fields` object.
export function validateBudgetFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { error: 'fields must be an object' }
  const keys = Object.keys(fields)
  if (!keys.length) return { error: 'No fields to update' }
  if ('job_id' in fields) return { error: 'A budget line cannot be moved to another job.' }
  const unknown = keys.filter(k => !BUDGET_EDITABLE_FIELDS.includes(k))
  if (unknown.length) return { error: `Field${unknown.length === 1 ? '' : 's'} not editable: ${unknown.join(', ')}` }
  const updates = {}
  for (const k of keys) {
    const v = fields[k]
    if (k === 'budget_amount') {
      // Same rule as POST: required number (negative CO credits are fine).
      if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'budget amount must be a number' }
    } else if (k === 'owner_amount' || k === 'forecast_eac') {
      // Optional: null clears it, otherwise a finite number.
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return { error: `${k.replace('_', ' ')} must be a number` }
    } else if (k === 'roll_into_gc') {
      if (typeof v !== 'boolean') return { error: 'roll_into_gc must be true or false' }
    } else if (k === 'description') {
      if (v !== null && typeof v !== 'string') return { error: 'description must be text' }
    } else if (k === 'cost_code') {
      if (v !== null && typeof v !== 'string') return { error: 'cost code must be text' }
    }
    updates[k] = v
  }
  return { updates }
}
