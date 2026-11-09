import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { denyUnlessOnJob, atLeastPM } from '../../../../lib/roles'
import {
  PRIME_CO_ACTIONS, PRIME_CO_EDIT_ACTIONS, PRIME_CO_APPLIED_NO_DELETE, canReviewPrimeCO, normalizeSov, normalizeRevision,
  primeCOLineIds, primeCORpcError, requestInPreview, isUuid,
} from '../../../../lib/prime-co-review'
import { coDeleteBlock, coDbErrorMessage } from '../../../../lib/co-number'
import { writeWithMissingColumnRetry, isMissingColumnError, missingColumnName } from '../../../../lib/missing-column-retry'
import { DAYS_ADDED_NEEDS_069, CONTRACT_TIME_MIGRATION } from '../../../../lib/contract-time'
import { logChange } from '../../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const isResidential = job => String(job?.job_type ?? '').trim().toLowerCase() === 'residential'

// POST { co_id, action: 'approve' | 'apply' | 'reject', sov?, budget_item_id? }
//   approve: sov (commercial — lines assigned while approving; [] / null clears) and
//            budget_item_id (residential — line picked when the CO has none).
// The CO's real job is read from the database (never the body); the caller must be a
// reviewer on that job. Status, SOV and budget lines change together in one
// transaction (public.prime_co_review, migration 049): all or nothing.
// Also (commercial job page Edit / Delete):
//   revise: { description, amount, notes, sov, days_added? } — approved + applied COs go through
//           public.prime_co_revise (049) so the budget re-sync and the CO save are one
//           transaction; un-applied COs are saved with a still-not-applied guard.
//   delete: unnumbered, not-applied COs only; applied COs are refused.
// See lib/prime-co-review.js for the state transitions.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  // middleware.js already blocks mutations in role preview; refuse here too.
  if (requestInPreview(request)) {
    return Response.json({ error: 'This action is disabled in role preview mode.' }, { status: 403 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { co_id: coId, action } = body || {}
  if (!isUuid(coId)) return Response.json({ error: 'co_id required' }, { status: 400 })
  if (!PRIME_CO_ACTIONS.includes(action) && !PRIME_CO_EDIT_ACTIONS.includes(action)) return Response.json({ error: 'action must be approve, apply, reject, revise or delete' }, { status: 400 })

  const { data: co, error: coErr } = await adminSupabase.from('prime_change_orders')
    .select('*').eq('id', coId).maybeSingle()
  if (coErr) return Response.json({ error: coErr.message }, { status: 500 })
  if (!co) return Response.json({ error: 'Change order not found.' }, { status: 404 })

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('id, job_type').eq('id', co.job_id).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
  const residential = isResidential(job)

  if (!canReviewPrimeCO(auth.role, residential)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, job.id)
  if (denied) return denied

  if (action === 'revise') return revise(body, co, job, residential, auth)
  if (action === 'delete') return remove(co)

  // Optional inputs (approve only).
  let setSov = false
  let sov = null
  if (action === 'approve' && body.sov !== undefined) {
    if (residential) return Response.json({ error: 'sov is not accepted for residential approvals.' }, { status: 400 })
    const r = normalizeSov(body.sov)
    if (r.error) return Response.json({ error: r.error }, { status: 400 })
    setSov = true
    sov = r.sov
  }
  let budgetItemId = null
  if (action === 'approve' && body.budget_item_id != null && body.budget_item_id !== '') {
    if (!residential) return Response.json({ error: 'budget_item_id is only used for residential approvals.' }, { status: 400 })
    if (!isUuid(body.budget_item_id)) return Response.json({ error: 'Invalid budget line.' }, { status: 400 })
    budgetItemId = body.budget_item_id
  }

  // Quick state checks so the common mistakes answer clearly (the database
  // function re-checks everything under row locks).
  if (action === 'approve' && co.status !== 'pending') return Response.json({ error: 'This change order was already reviewed. Refresh to see its current status.' }, { status: 409 })
  if (action === 'apply') {
    if (co.status !== 'approved') return Response.json({ error: 'This change order is not approved, so it can’t be applied to the budget.' }, { status: 409 })
    if (co.budget_applied) return Response.json({ error: 'This change order is already applied to the budget. Nothing was changed.' }, { status: 409 })
  }
  const allowReverse = action === 'reject' && residential && atLeastPM(auth.role)
  const reversing = action === 'reject' && co.status === 'approved' && !!co.budget_applied
  if (reversing && !allowReverse) return Response.json({ error: 'This approved change order is already on the budget and can’t be rejected here.' }, { status: 409 })

  // Every budget line it would move must be on this CO's job (checked before
  // anything is written).
  const moves = action === 'apply' || (action === 'approve') || reversing
  if (moves) {
    const ids = primeCOLineIds(co, { residential, sov: setSov ? (sov || []) : undefined, budgetItemId })
    if (!ids.length && (action !== 'approve' || residential)) {
      return Response.json({ error: residential ? 'Pick a budget line for this change order first. Nothing was changed.' : 'This change order has no budget lines assigned. Edit the CO to add budget line assignments. Nothing was changed.' }, { status: 400 })
    }
    if (ids.some(i => !isUuid(i))) return Response.json({ error: 'A budget line on this change order is invalid. Nothing was changed.' }, { status: 400 })
    if (ids.length) {
      const { data: lines, error: lineErr } = await adminSupabase.from('budget_items').select('id, job_id').in('id', ids)
      if (lineErr) return Response.json({ error: lineErr.message }, { status: 500 })
      const ok = new Set((lines || []).filter(l => l.job_id === job.id).map(l => l.id))
      if (ids.some(i => !ok.has(i))) return Response.json({ error: 'A budget line on this change order is missing or belongs to a different job. Nothing was changed.' }, { status: 400 })
    }
  }

  const { data, error } = await adminSupabase.rpc('prime_co_review', {
    p_co_id: co.id,
    p_job_id: job.id,
    p_action: action,
    p_sov: sov,
    p_set_sov: setSov,
    p_budget_item_id: budgetItemId,
    p_residential: residential,
    p_allow_reverse: allowReverse,
  })
  if (error) {
    const e = primeCORpcError(error)
    return Response.json({ error: e.error, ...(e.migration_required ? { migration_required: e.migration_required } : {}) }, { status: e.status })
  }
  return Response.json({ ok: true, ...(data && typeof data === 'object' ? data : {}) })
}

// Guard for writes that must only land while the CO is still in the state we read
// and NOT applied to the budget (a concurrent apply makes them match no row).
function stillNotApplied(q, co) {
  q = q.eq('id', co.id).eq('job_id', co.job_id).eq('status', co.status)
  return co.budget_applied === null || co.budget_applied === undefined ? q.is('budget_applied', null) : q.eq('budget_applied', false)
}

const CHANGED = 'This change order was changed by someone else (it may have just been applied to the budget). Refresh and try again. Nothing was changed.'

// revise: edit description / amount / notes / SOV of a commercial prime CO.
async function revise(body, co, job, residential, auth) {
  if (residential) return Response.json({ error: 'Residential change orders can’t be edited here.' }, { status: 400 })
  const r = normalizeRevision(body)
  if (r.error) return Response.json({ error: r.error }, { status: 400 })
  const fields = r.fields
  const daysAdded = r.daysAdded

  // Every budget line the new SOV names must be on this CO's job.
  const ids = [...new Set((fields.sov || []).map(x => x.budget_item_id).filter(Boolean))]
  if (ids.length) {
    const { data: lines, error: lineErr } = await adminSupabase.from('budget_items').select('id, job_id').in('id', ids)
    if (lineErr) return Response.json({ error: lineErr.message }, { status: 500 })
    const ok = new Set((lines || []).filter(l => l.job_id === job.id).map(l => l.id))
    if (ids.some(i => !ok.has(i))) return Response.json({ error: 'A budget line on this change order is missing or belongs to a different job. Nothing was changed.' }, { status: 400 })
  }

  if (co.status === 'approved' && co.budget_applied) {
    // Money moves: one transaction (migration 049). No fallback.
    const { data, error } = await adminSupabase.rpc('prime_co_revise', {
      p_co_id: co.id, p_job_id: job.id,
      p_description: fields.description, p_amount: fields.amount, p_notes: fields.notes, p_sov: fields.sov,
    })
    if (error) {
      const e = primeCORpcError(error, { revise: true })
      return Response.json({ error: e.error, ...(e.migration_required ? { migration_required: e.migration_required } : {}) }, { status: e.status })
    }
    const days = await saveDaysAdded(co, daysAdded, auth)
    return Response.json({ ok: true, resynced: true, ...(data && typeof data === 'object' ? data : {}), ...days })
  }

  // Not applied: no budget line moves. Never sets status / budget_applied.
  const { data: saved, error } = await stillNotApplied(
    adminSupabase.from('prime_change_orders').update({ description: fields.description, amount: fields.amount, notes: fields.notes, sov: fields.sov }), co,
  ).select('id')
  if (error) return Response.json({ error: coDbErrorMessage(error.message) }, { status: 500 })
  if (!saved || saved.length !== 1) return Response.json({ error: CHANGED }, { status: 409 })
  const days = await saveDaysAdded(co, daysAdded, auth)
  return Response.json({ ok: true, resynced: false, status: co.status, budget_applied: !!co.budget_applied, ...days })
}

// days_added (prompt 71, migration 069): contract time, not money — saved in its own
// update after the CO save (the prime_co_revise RPC is unchanged). Before 069 the
// column is missing: the CO edit still stands and the answer carries a warning.
async function saveDaysAdded(co, daysAdded, auth) {
  if (daysAdded === undefined) return {}
  const before = Number(co.days_added || 0)
  // Unchanged (incl. 0 before 069, when the column is absent): no write, no log.
  if (before === daysAdded) return { days_added: daysAdded }
  // One-column row: the retry helper never sends an empty update, so a missing column
  // comes back as the error naming days_added.
  const { error } = await writeWithMissingColumnRetry(
    row => adminSupabase.from('prime_change_orders').update(row).eq('id', co.id).eq('job_id', co.job_id),
    { days_added: daysAdded }, { fallbackCols: ['days_added'] })
  if (error && isMissingColumnError(error) && missingColumnName(error) === 'days_added') {
    return { warning: DAYS_ADDED_NEEDS_069, migration_required: CONTRACT_TIME_MIGRATION }
  }
  if (error) return { warning: `The change order was saved, but its days could not be: ${error.message}` }
  if (before !== daysAdded) {
    await logChange({
      job_id: co.job_id, entity_type: 'prime_change_order', entity_id: co.id, field_name: 'days_added',
      old_value: before, new_value: daysAdded, changed_by: auth?.userId || null,
    })
  }
  return { days_added: daysAdded }
}

// delete: only an unnumbered CO that is not applied to the budget (moves no money).
async function remove(co) {
  const blocked = coDeleteBlock(co)
  if (blocked) return Response.json({ error: blocked }, { status: 409 })
  if (co.budget_applied) return Response.json({ error: PRIME_CO_APPLIED_NO_DELETE }, { status: 409 })
  const { data: gone, error } = await stillNotApplied(adminSupabase.from('prime_change_orders').delete(), co).select('id')
  if (error) {
    const msg = coDbErrorMessage(error.message)
    return Response.json({ error: msg }, { status: /numbered/.test(msg) ? 409 : 500 })
  }
  if (!gone || gone.length !== 1) return Response.json({ error: CHANGED }, { status: 409 })
  return Response.json({ ok: true, deleted: true })
}
