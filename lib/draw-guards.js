// Draw requests (draw_requests): status rules and what may be tagged to a draw.
// Pure functions; the draw-requests and sub-portal billing routes do the reads.

export const DRAW_STATUSES = ['open', 'closed']

// What a PATCH body is trying to change on a draw.
export const DRAW_ITEM_KEYS = ['add_dc_ids', 'remove_dc_ids', 'add_po_ids', 'remove_po_ids', 'add_gc_ids', 'remove_gc_ids', 'add_billing_ids', 'remove_billing_ids']

// Null when the PATCH may go ahead, else { status, error }.
// A closed draw only accepts an explicit Reopen (status 'open' and nothing else).
export function drawPatchError(draw, body = {}) {
  if (!draw) return { status: 404, error: 'Draw request not found.' }
  if (body.status !== undefined && !DRAW_STATUSES.includes(body.status)) {
    return { status: 400, error: `status must be one of: ${DRAW_STATUSES.join(', ')}` }
  }
  if (draw.status === 'closed') {
    const touchesItems = DRAW_ITEM_KEYS.some(k => Array.isArray(body[k]) && body[k].length > 0)
    const reopening = body.status === 'open'
    if (!reopening || touchesItems || body.title !== undefined) {
      return { status: 409, error: `Draw #${draw.draw_number} is closed. Reopen it before changing it.` }
    }
  }
  return null
}

export function drawDeleteError(draw) {
  if (!draw) return { status: 404, error: 'Draw request not found.' }
  if (draw.status === 'closed') return { status: 409, error: `Draw #${draw.draw_number} is closed and can't be deleted. Reopen it first.` }
  return null
}

// Check rows about to be added to / removed from a draw. `rows` are the
// fetched rows for `ids` (id, job_id, draw_request_id, and status where it
// applies). `okStatus(row)` says whether the row's status allows drawing.
// Returns a list of problems (empty = fine).
export function drawItemProblems({ ids, rows, draw, mode, label, okStatus = null }) {
  const problems = []
  const byId = new Map((rows || []).map(r => [r.id, r]))
  for (const id of new Set(ids || [])) {
    const r = byId.get(id)
    if (!r) { problems.push(`${label} ${id} not found`); continue }
    if (r.job_id !== draw.job_id) { problems.push(`${label} ${id} is on a different job`); continue }
    if (mode === 'add') {
      if (r.draw_request_id && r.draw_request_id !== draw.id) problems.push(`${label} ${id} is already on another draw`)
      else if (okStatus && !okStatus(r)) problems.push(`${label} ${id} is not approved`)
    } else if (r.draw_request_id !== draw.id) {
      problems.push(`${label} ${id} is not on this draw`)
    }
  }
  return problems
}

// Statuses that may go on a draw, per item type.
export const DRAWABLE = {
  dc: r => r.status === 'approved' && !r.drawn_application_id,
  po: r => r.status === 'issued' || r.status === 'received',
  gc: null,
  billing: r => r.status === 'approved',
}
