import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'
import { DC_APPROVER_ROLES } from '../../../lib/direct-cost-queue'
import { jobAccessError, budgetLineError } from '../../../lib/dc-guards'
import { isAiaLocked, aiaLockReason, overrideConfirmed } from '../../../lib/aia-lock'
import { toCents, fromCents, signedDrawCents, applyDrawDelta, undoDrawDelta, pctOf } from '../../../lib/aia-draw'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/aia-draw — draw a direct cost onto an owner pay app's G703, or undo that.
//   { action: 'draw', cost_id, app_id, override_app_number? }
//   { action: 'undo', cost_id, override_app_number? }
//   { action: 'legacy_untag', cost_id, override_app_number? }  — only for tags made before
//       exact tracking: clears the tag, leaves the G703 alone (the caller confirmed that).
// The tag and the G703 line change together in one database transaction
// (public.aia_dc_draw_apply, migration 045). Until 045 is applied this returns 503 and
// changes nothing — there is no unsafe fallback.
//
// Locked app (submitted / certified / payment recorded): refused, unless the caller is an
// Owner AND typed the app number (override_app_number). A body boolean is not enough.

const MIGRATION_REQUIRED = 'Pay-app draw tracking needs database migration 045 (not applied yet). Nothing was changed.'
const migrationMissing = err => /aia_dc_draw_apply|drawn_aia_delta|PGRST202|Could not find the function|does not exist/i.test(err?.message || '') || err?.code === 'PGRST202'

const DB_CONFLICTS = {
  aia_dc_already_drawn: 'This cost is already drawn on a pay app. Refresh.',
  aia_dc_not_drawn_here: 'This cost is no longer drawn on that pay app (or its recorded amount changed). Refresh.',
  aia_line_changed: 'The G703 line was changed by someone else since this was calculated. Refresh and try again.',
  aia_app_locked: 'The pay app was locked (submitted / certified / paid) meanwhile. Nothing was changed.',
}

function rpcErrorResponse(error) {
  if (migrationMissing(error)) return Response.json({ error: MIGRATION_REQUIRED, migration_required: '045' }, { status: 503 })
  for (const [code, msg] of Object.entries(DB_CONFLICTS)) {
    if ((error.message || '').includes(code)) return Response.json({ error: msg }, { status: 409 })
  }
  return Response.json({ error: error.message }, { status: 500 })
}

// Locked app check. Returns { override: boolean } or { error: Response }.
function lockCheck(auth, app, typed) {
  if (!isAiaLocked(app)) return { override: false }
  if (!isPrincipal(auth.role)) {
    return { error: Response.json({ error: `App #${app.app_number} is locked because ${aiaLockReason(app)}. Only an Owner can change it.` }, { status: 423 }) }
  }
  if (!overrideConfirmed(typed, app)) {
    return { error: Response.json({ error: `App #${app.app_number} is locked because ${aiaLockReason(app)}. Owner override: type the app number to confirm.`, needs_override: true }, { status: 423 }) }
  }
  return { override: true }
}

async function loadApp(id) {
  const { data, error } = await adminSupabase.from('aia_applications')
    .select('id, job_id, app_number, status, payment_received, markup_pct, nv_subcontract_id').eq('id', id).maybeSingle()
  if (error) return { error: Response.json({ error: error.message }, { status: 500 }) }
  if (!data) return { error: Response.json({ error: 'Pay app not found.' }, { status: 404 }) }
  return { app: data }
}

// This app's G703 row for the budget line (null when none saved yet) and its scheduled value.
async function loadLine(app, budgetItemId) {
  const [{ data: rows, error }, { data: item, error: itemErr }] = await Promise.all([
    adminSupabase.from('aia_application_lines')
      .select('id, budget_item_id, dollar_this_period, pct_this_period, dollar_prev, scheduled_value')
      .eq('application_id', app.id).eq('budget_item_id', budgetItemId).order('id').limit(1),
    adminSupabase.from('budget_items').select('id, job_id, budget_amount, owner_amount').eq('id', budgetItemId).maybeSingle(),
  ])
  if (error || itemErr) return { error: Response.json({ error: (error || itemErr).message }, { status: 500 }) }
  if (!item) return { error: Response.json({ error: 'The cost’s budget line no longer exists.' }, { status: 422 }) }
  const row = rows?.[0] || null
  // Same scheduled value the pay app screen uses: owner_amount, else budget_amount
  const schedCents = toCents(item.owner_amount ?? item.budget_amount ?? 0)
  const thisCents = row?.dollar_this_period != null
    ? toCents(row.dollar_this_period)
    : Math.round(schedCents * (parseFloat(row?.pct_this_period) || 0) / 100)
  return { row, schedCents, thisCents }
}

// Total billed on this budget line by earlier prime apps of the job (same rule as the page).
async function prevCentsFor(app, budgetItemId, schedCents, row) {
  const { data: prevApps, error } = await adminSupabase.from('aia_applications')
    .select('id, app_number').eq('job_id', app.job_id).is('nv_subcontract_id', null).lt('app_number', app.app_number)
  if (error) return { error: Response.json({ error: error.message }, { status: 500 }) }
  if (!prevApps?.length) return { prevCents: row?.dollar_prev != null ? toCents(row.dollar_prev) : 0 }
  const { data: lines, error: lErr } = await adminSupabase.from('aia_application_lines')
    .select('application_id, dollar_this_period, pct_this_period').in('application_id', prevApps.map(a => a.id)).eq('budget_item_id', budgetItemId)
  if (lErr) return { error: Response.json({ error: lErr.message }, { status: 500 }) }
  let prevCents = 0
  for (const l of lines || []) {
    prevCents += l.dollar_this_period != null ? toCents(l.dollar_this_period) : Math.round(schedCents * (parseFloat(l.pct_this_period) || 0) / 100)
  }
  return { prevCents }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!DC_APPROVER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { action, cost_id, app_id, override_app_number } = body || {}
  if (!['draw', 'undo', 'legacy_untag'].includes(action) || !cost_id) {
    return Response.json({ error: 'action (draw | undo | legacy_untag) and cost_id are required' }, { status: 400 })
  }
  try {
    // select('*') so a missing drawn_aia_delta column (045 not applied) is detected, not an error
    const { data: cost, error: costErr } = await adminSupabase.from('direct_costs').select('*').eq('id', cost_id).maybeSingle()
    if (costErr) return Response.json({ error: costErr.message }, { status: 500 })
    if (!cost) return Response.json({ error: 'Cost not found' }, { status: 404 })
    const denied = await jobAccessError(adminSupabase, auth, cost.job_id)
    if (denied) return Response.json({ error: denied.error }, { status: denied.status })
    if (!('drawn_aia_delta' in cost)) return Response.json({ error: MIGRATION_REQUIRED, migration_required: '045' }, { status: 503 })

    // Draw: the target app. Undo: the app it is drawn on now (a different app_id is a stale screen).
    const targetId = action === 'draw' ? app_id : cost.drawn_application_id
    if (action !== 'draw' && !cost.drawn_application_id) return Response.json({ error: 'This cost is not drawn on a pay app.' }, { status: 409 })
    if (action !== 'draw' && app_id && app_id !== cost.drawn_application_id) return Response.json({ error: 'This cost is drawn on a different pay app now. Refresh.' }, { status: 409 })
    if (!targetId) return Response.json({ error: 'app_id required' }, { status: 400 })
    const { app, error: appErr } = await loadApp(targetId)
    if (appErr) return appErr
    if (app.job_id !== cost.job_id) return Response.json({ error: 'That pay app is on a different job.' }, { status: 422 })
    if (app.nv_subcontract_id) return Response.json({ error: 'Direct costs are drawn on the owner (prime) pay app, not an NV-sub app.' }, { status: 422 })
    const lock = lockCheck(auth, app, override_app_number)
    if (lock.error) return lock.error

    if (action === 'draw') {
      if (cost.drawn_application_id) {
        return Response.json({ error: cost.drawn_application_id === app.id ? 'This cost is already drawn on this pay app.' : 'This cost is already drawn on another pay app. Undo it there first.' }, { status: 409 })
      }
      if (cost.status !== 'approved') return Response.json({ error: 'Only approved costs can be drawn.' }, { status: 422 })
      if (!cost.budget_item_id) return Response.json({ error: 'Assign a budget line to this cost before drawing.' }, { status: 422 })
      const badLine = await budgetLineError(adminSupabase, cost.budget_item_id, cost.job_id)
      if (badLine) return Response.json({ error: badLine.error }, { status: badLine.status })
      const { row, schedCents, thisCents, error: lineErr } = await loadLine(app, cost.budget_item_id)
      if (lineErr) return lineErr
      const { prevCents, error: prevErr } = await prevCentsFor(app, cost.budget_item_id, schedCents, row)
      if (prevErr) return prevErr
      const res = applyDrawDelta({ thisCents, prevCents, scheduledCents: schedCents, deltaCents: signedDrawCents(cost, app.markup_pct) })
      if (res.error) return Response.json({ error: res.error }, { status: 422 })
      const { error } = await adminSupabase.rpc('aia_dc_draw_apply', {
        p_mode: 'draw', p_cost_id: cost.id, p_app_id: app.id, p_budget_item_id: cost.budget_item_id,
        p_expected_this: row ? row.dollar_this_period : null,
        p_has_line: !!row,
        p_new_this: fromCents(res.newThisCents), p_new_pct: pctOf(res.newThisCents, schedCents),
        p_applied: fromCents(res.appliedCents), p_dollar_prev: fromCents(prevCents), p_override: lock.override,
      })
      if (error) return rpcErrorResponse(error)
      return Response.json({ ok: true, budget_item_id: cost.budget_item_id, applied: fromCents(res.appliedCents), new_this: fromCents(res.newThisCents) })
    }

    if (action === 'undo') {
      if (cost.drawn_aia_delta == null) {
        return Response.json({
          error: 'This cost was drawn before exact draw tracking, so the amount it added to the G703 is not known and can’t be reversed automatically. Adjust the G703 line by hand, then use “Untag only”.',
          legacy: true,
        }, { status: 409 })
      }
      const { row, schedCents, thisCents, error: lineErr } = await loadLine(app, cost.budget_item_id)
      if (lineErr) return lineErr
      if (!row) return Response.json({ error: 'The G703 line this cost was drawn to is missing, so it can’t be reversed automatically.', legacy: true }, { status: 409 })
      const appliedCents = toCents(cost.drawn_aia_delta)
      const { newThisCents } = undoDrawDelta({ thisCents, appliedCents })
      const { error } = await adminSupabase.rpc('aia_dc_draw_apply', {
        p_mode: 'undo', p_cost_id: cost.id, p_app_id: app.id, p_budget_item_id: cost.budget_item_id,
        p_expected_this: row.dollar_this_period, p_has_line: true,
        p_new_this: fromCents(newThisCents), p_new_pct: pctOf(newThisCents, schedCents),
        p_applied: fromCents(appliedCents), p_dollar_prev: null, p_override: lock.override,
      })
      if (error) return rpcErrorResponse(error)
      return Response.json({ ok: true, budget_item_id: cost.budget_item_id, applied: fromCents(-appliedCents), new_this: fromCents(newThisCents) })
    }

    // legacy_untag
    if (cost.drawn_aia_delta != null) return Response.json({ error: 'This cost has an exact recorded draw amount — use Undo.' }, { status: 409 })
    const { error } = await adminSupabase.rpc('aia_dc_draw_apply', {
      p_mode: 'legacy_untag', p_cost_id: cost.id, p_app_id: app.id, p_budget_item_id: cost.budget_item_id,
      p_expected_this: null, p_has_line: false, p_new_this: null, p_new_pct: null, p_applied: null, p_dollar_prev: null, p_override: lock.override,
    })
    if (error) return rpcErrorResponse(error)
    return Response.json({ ok: true, budget_item_id: cost.budget_item_id, applied: 0, untagged_only: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
