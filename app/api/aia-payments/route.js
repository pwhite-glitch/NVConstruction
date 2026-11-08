import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { isMissingRelation } from '../../../lib/budget-line-refs'
import { aiaCurrentPaymentDue } from '../../../lib/cash-outlook'
import { todayCentral } from '../../../lib/central-date'
import { logChange } from '../../../lib/change-log'
import {
  canRecordAiaPayment, MIGRATION_053_REQUIRED, aiaPaymentSummary, legacySeedEntry,
  validateAiaPaymentInput, aiaPaymentDiffers, aiaPaymentMismatchMessage,
} from '../../../lib/aia-payments'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// Owner pay-app payments (client owner → NV) on the commercial Prime Contract tab.
//   GET  ?application_id=…   entries + G702 current payment due + remaining
//   GET  ?job_id=…           every entry on the job's apps (Cash Flow tab)
//   POST { application_id, amount, received_on, reference, confirm_mismatch }
//   PATCH { id, action: 'void', reason }
// Owner and PM record and void; nothing is ever deleted and an earlier entry's
// date is never wiped. Drafts cannot take a payment.
// Every write goes through ONE database call (record_aia_payment /
// void_aia_payment, migration 053): it locks the aia_applications row, writes
// the entry, and recalculates amount_received / payment_received /
// payment_received_at from the live ledger inside the same transaction. The
// route never writes those summary columns itself, so two concurrent payments
// or voids cannot overwrite each other with a stale total.
// Needs migration 053; without it every write is refused (no browser fallback).
const READ_ROLES = new Set(['principal', 'pm', 'apm', 'admin'])
const NO_STORE = { 'Cache-Control': 'private, no-store' }
const bad = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status, headers: NO_STORE })
const migrationMissing = () => bad(MIGRATION_053_REQUIRED, 409, { code: 'migration_required' })
const ENTRY_COLS = 'id, application_id, job_id, amount, received_on, reference, recorded_by, recorded_by_name, voided_at, voided_by, voided_by_name, void_reason, created_at'

async function loadApp(id) {
  return adminSupabase.from('aia_applications').select('*').eq('id', id).maybeSingle()
}

async function loadEntries(appId) {
  return adminSupabase.from('aia_payment_entries').select(ENTRY_COLS).eq('application_id', appId).order('received_on', { ascending: true })
}

// G702 current payment due for this app, same math as the cash outlook.
async function certificateDue(app) {
  const { data: apps, error } = await adminSupabase.from('aia_applications').select('*').eq('job_id', app.job_id)
  if (error) return { error }
  const seq = (apps || []).filter(a => (app.nv_subcontract_id ? a.nv_subcontract_id === app.nv_subcontract_id : !a.nv_subcontract_id))
  const ids = seq.map(a => a.id)
  const { data: lines, error: lErr } = ids.length
    ? await adminSupabase.from('aia_application_lines').select('*').in('application_id', ids)
    : { data: [], error: null }
  if (lErr) return { error: lErr }
  const linesByApp = {}
  for (const l of lines || []) (linesByApp[l.application_id] = linesByApp[l.application_id] || []).push(l)
  let budgetItems = []
  if (!app.nv_subcontract_id) {
    const { data: b, error: bErr } = await adminSupabase.from('budget_items').select('id, job_id, budget_amount, owner_amount').eq('job_id', app.job_id)
    if (bErr) return { error: bErr }
    budgetItems = b || []
  }
  return { calc: aiaCurrentPaymentDue({ app, apps: seq, linesByApp, budgetItems }) }
}

async function profileName(userId) {
  const { data } = await adminSupabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name || null
}

// The record / void database functions are part of migration 053. PostgREST
// reports a missing function as PGRST202 (Postgres: 42883).
function isMissingFunction(error) {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function|function .* does not exist/i.test(error.message || '')
}

// Map a record/void database error to a response. The database call is one
// transaction, so on any error nothing was written.
function writeFailure(error, verb) {
  if (isMissingFunction(error) || isMissingRelation(error)) return migrationMissing()
  const m = error?.message || ''
  if (m.includes('aia_payment_draft')) return bad('Payments can only be recorded on a submitted or certified application, not a draft.', 409, { code: 'draft' })
  if (m.includes('aia_payment_ledger_changed')) {
    return bad('Another payment was recorded or voided on this application while you were entering this one. Nothing was saved. Review the updated payment list and enter this payment again only if it is still missing.', 409, { code: 'ledger_changed' })
  }
  if (m.includes('aia_payment_already_voided')) return bad('That payment is already voided.', 409)
  if (m.includes('aia_payment_not_found')) return bad('Payment or pay app not found.', 404)
  return bad(`The payment could not be ${verb}: ${m || 'database error'}. Refresh the payment list and check it before trying again.`, 500, { code: 'write_failed' })
}

function summaryFromRpc(data) {
  const d = data || {}
  return {
    total: Number(d.total || 0),
    previous: d.previous_total == null ? null : Number(d.previous_total),
    columns: {
      amount_received: d.amount_received == null ? null : Number(d.amount_received),
      payment_received: !!d.payment_received,
      payment_received_at: d.payment_received_at || null,
    },
  }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!READ_ROLES.has(auth.role)) return bad('Forbidden', 403)
  const url = new URL(request.url)
  const appId = url.searchParams.get('application_id')
  const jobId = url.searchParams.get('job_id')

  if (appId) {
    const { data: app, error } = await loadApp(appId)
    if (error) return bad(error.message, 500)
    if (!app) return bad('Pay app not found.', 404)
    const denied = await denyJob(adminSupabase, auth, app.job_id)
    if (denied) return denied
    const { data: entries, error: eErr } = await loadEntries(appId)
    if (eErr) return isMissingRelation(eErr) ? migrationMissing() : bad(eErr.message, 500)
    const due = await certificateDue(app)
    if (due.error) return bad(due.error.message, 500)
    const seed = legacySeedEntry(app, entries)
    const summary = aiaPaymentSummary(seed ? [seed] : entries)
    const remaining = Math.round((due.calc.due - summary.total) * 100) / 100
    return Response.json({ entries: entries || [], due: due.calc.due, received: summary.total, remaining, status: app.status }, { headers: NO_STORE })
  }
  if (jobId) {
    const denied = await denyJob(adminSupabase, auth, jobId)
    if (denied) return denied
    const { data, error } = await adminSupabase.from('aia_payment_entries').select(ENTRY_COLS).eq('job_id', jobId).order('received_on', { ascending: true })
    if (error) return isMissingRelation(error) ? migrationMissing() : bad(error.message, 500)
    return Response.json({ entries: data || [] }, { headers: NO_STORE })
  }
  return bad('application_id or job_id required')
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!canRecordAiaPayment(auth.role)) return bad('Only an Owner or PM can record an owner payment.', 403)
  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  const v = validateAiaPaymentInput(body, todayCentral())
  if (v.error) return bad(v.error)

  const { data: app, error } = await loadApp(v.row.application_id)
  if (error) return bad(error.message, 500)
  if (!app) return bad('Pay app not found.', 404)
  const denied = await denyJob(adminSupabase, auth, app.job_id)
  if (denied) return denied
  if (app.status !== 'submitted' && app.status !== 'certified') {
    return bad('Payments can only be recorded on a submitted or certified application, not a draft.', 409, { code: 'draft' })
  }

  const { data: entries, error: eErr } = await loadEntries(app.id)
  if (eErr) return isMissingRelation(eErr) ? migrationMissing() : bad(eErr.message, 500)

  const seed = legacySeedEntry(app, entries)
  const due = await certificateDue(app)
  if (due.error) return bad(due.error.message, 500)
  const already = aiaPaymentSummary(seed ? [seed] : entries).total
  const remaining = Math.round((due.calc.due - already) * 100) / 100
  if (aiaPaymentDiffers(v.row.amount, remaining) && body.confirm_mismatch !== true) {
    return bad(aiaPaymentMismatchMessage(v.row.amount, remaining), 409, { code: 'amount_mismatch', due: due.calc.due, received: already, remaining })
  }

  // One locked transaction: carry over a legacy single payment if needed,
  // refuse if the ledger moved since `already` was read, insert, and
  // recalculate the summary from the live ledger.
  const name = await profileName(auth.userId)
  const { data: out, error: rErr } = await adminSupabase.rpc('record_aia_payment', {
    p_application_id: app.id,
    p_amount: v.row.amount,
    p_received_on: v.row.received_on,
    p_reference: v.row.reference,
    p_recorded_by: auth.userId,
    p_recorded_by_name: name,
    p_expected_received: already,
  })
  if (rErr) return writeFailure(rErr, 'saved')
  const summary = summaryFromRpc(out)
  const { data: after } = await loadEntries(app.id)
  await logChange({
    job_id: app.job_id, entity_type: 'aia_payment', entity_id: app.id, field_name: 'amount_received',
    old_value: summary.previous ?? already ?? null, new_value: summary.total, changed_by: auth.userId,
    note: `Owner payment $${v.row.amount.toFixed(2)} recorded on App #${app.app_number} (${v.row.received_on}${v.row.reference ? `, ref ${v.row.reference}` : ''})`,
  })
  return Response.json({ ok: true, entry: out?.entry || null, entries: after || [], received: summary.total, application: { id: app.id, ...summary.columns } }, { headers: NO_STORE })
}

export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!canRecordAiaPayment(auth.role)) return bad('Only an Owner or PM can void an owner payment.', 403)
  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  if (!body || typeof body !== 'object' || body.action !== 'void' || typeof body.id !== 'string' || !body.id) return bad("id and action: 'void' required")
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : ''
  if (!reason) return bad('Say why this payment is being voided.')

  const { data: entry, error } = await adminSupabase.from('aia_payment_entries').select(ENTRY_COLS).eq('id', body.id).maybeSingle()
  if (error) return isMissingRelation(error) ? migrationMissing() : bad(error.message, 500)
  if (!entry) return bad('Payment not found.', 404)
  const { data: app, error: aErr } = await loadApp(entry.application_id)
  if (aErr) return bad(aErr.message, 500)
  if (!app) return bad('Pay app not found.', 404)
  const denied = await denyJob(adminSupabase, auth, app.job_id)
  if (denied) return denied
  if (entry.voided_at) return bad('That payment is already voided.', 409)

  const name = await profileName(auth.userId)
  const { data: out, error: vErr } = await adminSupabase.rpc('void_aia_payment', {
    p_entry_id: entry.id,
    p_voided_by: auth.userId,
    p_voided_by_name: name,
    p_reason: reason,
  })
  if (vErr) return writeFailure(vErr, 'voided')
  const summary = summaryFromRpc(out)
  const { data: after } = await loadEntries(app.id)
  await logChange({
    job_id: app.job_id, entity_type: 'aia_payment', entity_id: app.id, field_name: 'amount_received',
    old_value: summary.previous ?? app.amount_received, new_value: summary.total, changed_by: auth.userId,
    note: `Owner payment $${Number(entry.amount).toFixed(2)} (${entry.received_on || 'no date'}) voided on App #${app.app_number}: ${reason}`,
  })
  return Response.json({ ok: true, entries: after || [], received: summary.total, application: { id: app.id, ...summary.columns } }, { headers: NO_STORE })
}
