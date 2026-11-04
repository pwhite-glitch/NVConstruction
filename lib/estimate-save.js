// Shared logic for saving estimates safely (stale-write guard, dirty tracking,
// local drafts). Used by app/api/estimates/route.js and EstimateWorkspace.

// ── Timestamps ────────────────────────────────────────────────────────────────
// Postgres returns microsecond timestamps ("2026-11-04T12:00:00.123456+00:00")
// while JS produces millisecond ISO strings ("...00.123Z"). Compare by instant,
// to the microsecond, so formatting differences never cause false conflicts.
function toMicros(v) {
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/)
  if (!m) return null
  const tz = m[4] ? m[4].trim() : ''
  const secMs = Date.parse(`${m[1]}T${m[2]}${tz || 'Z'}`)
  if (Number.isNaN(secMs)) return null
  const frac = (m[3] || '').padEnd(6, '0').slice(0, 6)
  return secMs * 1000 + Number(frac)
}

export function sameUpdatedAt(a, b) {
  const aNull = a === null || a === undefined || a === ''
  const bNull = b === null || b === undefined || b === ''
  if (aNull || bNull) return aNull && bNull
  const ma = toMicros(a)
  const mb = toMicros(b)
  if (ma === null || mb === null) return String(a) === String(b)
  return ma === mb
}

// ── Save payload (workspace) ─────────────────────────────────────────────────
const num = (v, fallback) => (v !== '' && v != null ? Number(v) : fallback)

export function estimateSavePayload(form, lines, estimateId, statusOverride) {
  const fields = {
    project_name:   form.project_name,
    address:        form.address        || null,
    owner_name:     form.owner_name     || null,
    owner_company:  form.owner_company  || null,
    owner_email:    form.owner_email    || null,
    owner_phone:    form.owner_phone    || null,
    notes:          form.notes          || null,
    markup_pct:     num(form.markup_pct, 0),
    markup_flat:    num(form.markup_flat, 0),
    taxable:        !!form.taxable,
    square_footage: num(form.square_footage, null),
    project_type:   form.project_type || null,
    status:         statusOverride || form.status,
  }
  const line_items = (lines || []).filter(l => l.description).map((l, i) => ({
    estimate_id: estimateId,
    description: l.description || '',
    amount:      l.amount !== '' && l.amount != null ? Number(l.amount) : 0,
    scope:       l.scope || null,
    sort_order:  i,
    markup_pct:  num(l.markup_pct, null),
    markup_flat: num(l.markup_flat, null),
  }))
  return { fields, line_items }
}

// ── Local drafts ─────────────────────────────────────────────────────────────
// Offer a draft only if it was made on top of the exact version the DB has now
// and actually differs from it. Anything else (older base, legacy draft with no
// base, identical content) should be deleted silently.
export function shouldOfferDraft(draft, estimate) {
  if (!draft || typeof draft !== 'object' || !draft.form) return false
  if (!Object.prototype.hasOwnProperty.call(draft, 'base_updated_at')) return false
  if (!sameUpdatedAt(draft.base_updated_at, estimate?.updated_at)) return false
  const dbLines = [...(estimate.estimate_line_items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const mine = estimateSavePayload(draft.form, draft.lines || [], estimate.id)
  const theirs = estimateSavePayload(estimate, dbLines, estimate.id)
  return JSON.stringify(mine) !== JSON.stringify(theirs)
}

// ── Dirty / auto-save state ──────────────────────────────────────────────────
// Only an explicit 'edit' action marks the estimate dirty. Loading, refetching,
// restoring a draft or saving never do: they simply don't dispatch 'edit'.
export function initialSaveState(updatedAt) {
  return { dirty: false, editSeq: 0, base: updatedAt ?? null, conflict: false }
}

export function saveStateReducer(state, action) {
  switch (action.type) {
    case 'edit':
      return { ...state, dirty: true, editSeq: state.editSeq + 1 }
    case 'saved':
      // Still dirty only if the user edited while the save was in flight.
      return { ...state, base: action.updated_at ?? null, dirty: state.editSeq !== action.seqAtStart }
    case 'conflict':
      return { ...state, conflict: true }
    default:
      return state
  }
}

export function shouldAutoSave(state, { canEdit, isArchived }) {
  return !!(state.dirty && !state.conflict && canEdit && !isArchived)
}

export const STALE_MESSAGE = 'Someone else saved this estimate. Reload to see the latest.'
