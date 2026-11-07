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

// A new item (GC entry, PM-entered billing) may only be created onto a draw that exists,
// is on the same job, and is open. `draw` is the fetched row (or null). Null when OK.
export function drawTargetError(draw, jobId) {
  if (!draw) return { status: 404, error: 'That draw request no longer exists. Refresh and pick another.' }
  if (draw.job_id !== jobId) return { status: 422, error: 'That draw request is on a different job.' }
  if (draw.status !== 'open') return { status: 409, error: `Draw #${draw.draw_number} is ${draw.status || 'not open'}. Pick an open draw (or reopen it first).` }
  return null
}

// ── General conditions on a draw ────────────────────────────────────────────
// While a GC entry is tagged to a draw (open or closed) its money and identity are part of
// that draw package: amount, description, budget line and date are locked, and it can't be
// deleted. Take it off the draw first (Draws tab / draw-requests remove_gc_ids).
export const GC_LOCKED_FIELDS = ['amount', 'description', 'budget_item_id', 'entry_date']

const cents = v => Math.round(Number(v || 0) * 100)
const same = {
  amount: (a, b) => Number.isFinite(Number(b)) && cents(a) === cents(b),
  description: (a, b) => String(a ?? '').trim() === String(b ?? '').trim(),
  budget_item_id: (a, b) => (a || null) === (b || null),
  entry_date: (a, b) => String(a || '').slice(0, 10) === String(b || '').slice(0, 10),
}

// Locked fields the request would actually change (unchanged form values are fine).
export function gcLockedChanges(entry, fields = {}) {
  return GC_LOCKED_FIELDS.filter(k => fields[k] !== undefined && !same[k](entry?.[k], fields[k]))
}

export function gcEditLockError(entry, fields = {}) {
  if (!entry?.draw_request_id) return null
  const changed = gcLockedChanges(entry, fields)
  if (!changed.length) return null
  return { status: 409, error: `This entry is on a draw request, so its ${changed.join(', ').replace(/_/g, ' ')} can't change. Take it off the draw first (Draws tab), then edit it.` }
}

export function gcDeleteLockError(entry) {
  if (!entry?.draw_request_id) return null
  return { status: 409, error: 'This entry is on a draw request and can’t be deleted. Take it off the draw first (Draws tab).' }
}
