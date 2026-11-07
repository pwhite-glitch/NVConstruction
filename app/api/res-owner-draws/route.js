import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { isMissingRelation } from '../../../lib/budget-line-refs'
import { todayCentral } from '../../../lib/central-date'
import {
  isDrawEditable, drawStatusChangeError, validateDrawLines, drawAttachmentPathOk, round2, MIGRATION_REQUIRED,
} from '../../../lib/owner-draws'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Residential owner/lender draws (res_owner_draws). Same people as the job page's
// money tabs: Owner/admin on every job, PM/APM on their jobs. Supers, subs,
// client owners and reps are refused.
const DRAW_ROLES = new Set(['principal', 'admin', 'pm', 'apm'])
// PROPOSED by migration 046 (written, NOT applied). Before it is applied these
// features answer 409 instead of pretending to save.
const NEW_COLS = 'amount_funded, schedule_lines, attachments'

const bad = (error, status = 400) => Response.json({ error }, { status })
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const optDate = v => (v === '' || v === null || v === undefined) ? null : (isDate(v) ? v : undefined)
const optText = (v, max = 2000) => (v === null || v === undefined || v === '') ? null : String(v).slice(0, max)

async function guard(request, jobId) {
  const auth = await requireAuth(request)
  if (auth.error) return { res: auth.error }
  if (!DRAW_ROLES.has(auth.role)) return { res: bad('Forbidden', 403) }
  if (jobId !== undefined) {
    if (!jobId) return { res: bad('job_id required') }
    const denied = await denyJob(adminSupabase, auth, jobId)
    if (denied) return { res: denied }
  }
  return { auth }
}

// Does the database have the 046 columns? { ok } | { missing } | { error }
async function hasNewColumns() {
  const { error } = await adminSupabase.from('res_owner_draws').select(`id, ${NEW_COLS}`).limit(1)
  if (!error) return { ok: true }
  if (isMissingRelation(error)) return { missing: true }
  return { error }
}

async function loadDraw(id) {
  const { data, error } = await adminSupabase.from('res_owner_draws').select('*').eq('id', id).maybeSingle()
  if (error) return { res: bad(error.message, 500) }
  if (!data) return { res: bad('Draw not found.', 404) }
  return { draw: data }
}

async function jobBudgetLines(jobId) {
  const { data, error } = await adminSupabase.from('budget_items').select('id, job_id, description, cost_code, budget_amount, owner_amount').eq('job_id', jobId)
  return { lines: data || [], error }
}

// GET ?job_id → { draws, migrated }
export async function GET(request) {
  const jobId = new URL(request.url).searchParams.get('job_id')
  const g = await guard(request, jobId)
  if (g.res) return g.res
  const cols = await hasNewColumns()
  if (cols.error) return bad(cols.error.message, 500)
  const { data, error } = await adminSupabase.from('res_owner_draws').select('*').eq('job_id', jobId).order('draw_number')
  if (error) return bad(error.message, 500)
  return Response.json({ draws: data || [], migrated: !!cols.ok })
}

// POST { job_id, title, period_start, period_end, amount_requested, notes,
//        link_draw_request_id?, schedule_lines? }  → new draft
export async function POST(request) {
  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  const jobId = body?.job_id
  const g = await guard(request, jobId)
  if (g.res) return g.res

  const amount = Number(body.amount_requested)
  if (body.amount_requested === '' || body.amount_requested === null || !Number.isFinite(amount)) return bad('Amount requested must be a number.')
  const period_start = optDate(body.period_start), period_end = optDate(body.period_end)
  if (period_start === undefined || period_end === undefined) return bad('Dates must be YYYY-MM-DD.')

  const row = { job_id: jobId, title: optText(body.title, 200), period_start, period_end, amount_requested: round2(amount), status: 'draft', notes: optText(body.notes) }

  if (Array.isArray(body.schedule_lines) && body.schedule_lines.length) {
    const cols = await hasNewColumns()
    if (cols.error) return bad(cols.error.message, 500)
    if (cols.missing) return bad(MIGRATION_REQUIRED, 409)
    const { lines: jobLines, error } = await jobBudgetLines(jobId)
    if (error) return bad(error.message, 500)
    const v = validateDrawLines(body.schedule_lines, jobLines, amount)
    if (v.error) return bad(v.error)
    row.schedule_lines = v.lines
  }

  // Number: a linked packaged Draw Request (same job) shares its number; otherwise next.
  const { data: existing, error: exErr } = await adminSupabase.from('res_owner_draws').select('id, draw_number, status').eq('job_id', jobId)
  if (exErr) return bad(exErr.message, 500)
  let drawNumber
  if (body.link_draw_request_id) {
    const { data: dr, error: drErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, title').eq('id', body.link_draw_request_id).maybeSingle()
    if (drErr) return bad(drErr.message, 500)
    if (!dr || dr.job_id !== jobId) return bad('That Draw Request is not on this job.')
    drawNumber = dr.draw_number
    if (!row.title) row.title = dr.title || null
  } else {
    drawNumber = (existing || []).reduce((m, d) => Math.max(m, Number(d.draw_number) || 0), 0) + 1
  }
  row.draw_number = drawNumber
  if (!row.title) row.title = `Draw #${drawNumber}`

  const { data, error } = await adminSupabase.from('res_owner_draws').insert(row).select('*').single()
  if (error) return bad(isMissingRelation(error) ? MIGRATION_REQUIRED : error.message, isMissingRelation(error) ? 409 : 500)
  return Response.json({ draw: data })
}

// PATCH { id, action, ... }
//   edit   { title?, period_start?, period_end?, notes?, amount_requested?, schedule_lines? }  draft only
//   status { status }             draft→submitted→approved→funded, void (needs 046)
//   fund   { amount_funded, funded_date? }   records the cash actually received (needs 046)
//   attach { path, name }         adds an uploaded file (needs 046)
export async function PATCH(request) {
  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  if (!body?.id) return bad('id required')
  const found = await loadDraw(body.id)
  if (found.res) {
    // Don't tell a caller whether a draw exists before checking who they are.
    const g0 = await guard(request)
    return g0.res || found.res
  }
  const draw = found.draw
  const g = await guard(request, draw.job_id)
  if (g.res) return g.res

  const action = body.action
  const update = {}

  if (action === 'edit') {
    if (!isDrawEditable(draw)) return bad('Only a draft draw can be edited. Submitted and funded draws keep their amounts; void it and create a new one if it was wrong.', 409)
    if (body.title !== undefined) update.title = optText(body.title, 200)
    if (body.notes !== undefined) update.notes = optText(body.notes)
    for (const k of ['period_start', 'period_end']) {
      if (body[k] !== undefined) { const v = optDate(body[k]); if (v === undefined) return bad('Dates must be YYYY-MM-DD.'); update[k] = v }
    }
    const amount = body.amount_requested !== undefined ? Number(body.amount_requested) : Number(draw.amount_requested)
    if (!Number.isFinite(amount)) return bad('Amount requested must be a number.')
    if (body.amount_requested !== undefined) update.amount_requested = round2(amount)
    if (body.schedule_lines !== undefined) {
      const cols = await hasNewColumns()
      if (cols.error) return bad(cols.error.message, 500)
      if (cols.missing) return bad(MIGRATION_REQUIRED, 409)
      const { lines: jobLines, error } = await jobBudgetLines(draw.job_id)
      if (error) return bad(error.message, 500)
      const v = validateDrawLines(body.schedule_lines || [], jobLines, amount)
      if (v.error) return bad(v.error)
      update.schedule_lines = v.lines.length ? v.lines : null
    } else if (body.amount_requested !== undefined && Array.isArray(draw.schedule_lines) && draw.schedule_lines.length) {
      const sum = round2(draw.schedule_lines.reduce((a, l) => a + Number(l.this_period || 0), 0))
      if (Math.abs(sum - round2(amount)) > 0.005) return bad(`Schedule lines total $${sum.toFixed(2)}; change the lines with the amount.`)
    }
    if (!Object.keys(update).length) return bad('Nothing to change.')
    const { data, error } = await adminSupabase.from('res_owner_draws').update(update).eq('id', draw.id).eq('status', 'draft').select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return bad('The draw changed while you were editing. Reload and try again.', 409)
    return Response.json({ draw: data[0] })
  }

  if (action === 'status') {
    const to = body.status
    const err = drawStatusChangeError(draw.status, to)
    if (err) return bad(err, 409)
    if (to === 'funded') return bad('Use "Record funding" with the amount actually received.', 400)
    if (to === 'void') {
      const cols = await hasNewColumns()
      if (cols.error) return bad(cols.error.message, 500)
      if (cols.missing) return bad(MIGRATION_REQUIRED, 409)
    }
    update.status = to
    if (to === 'submitted') update.submitted_date = todayCentral()
    const { data, error } = await adminSupabase.from('res_owner_draws').update(update).eq('id', draw.id).eq('status', draw.status).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return bad('The draw changed while you were editing. Reload and try again.', 409)
    return Response.json({ draw: data[0] })
  }

  if (action === 'fund') {
    const cols = await hasNewColumns()
    if (cols.error) return bad(cols.error.message, 500)
    if (cols.missing) return bad(MIGRATION_REQUIRED, 409)
    const funded = Number(body.amount_funded)
    if (body.amount_funded === '' || body.amount_funded === null || !Number.isFinite(funded) || funded < 0) return bad('Amount funded must be a number of $0 or more.')
    const fundedDate = optDate(body.funded_date)
    if (fundedDate === undefined) return bad('Dates must be YYYY-MM-DD.')
    // A funded draw may have its received amount recorded/corrected (legacy rows
    // have none); otherwise it must be submitted or approved to be funded.
    if (draw.status !== 'funded') {
      const err = drawStatusChangeError(draw.status, 'funded')
      if (err) return bad(err, 409)
    }
    update.status = 'funded'
    update.amount_funded = round2(funded)
    update.funded_date = fundedDate || draw.funded_date || todayCentral()
    const { data, error } = await adminSupabase.from('res_owner_draws').update(update).eq('id', draw.id).eq('status', draw.status).select('*')
    if (error) return bad(isMissingRelation(error) ? MIGRATION_REQUIRED : error.message, isMissingRelation(error) ? 409 : 500)
    if (!data?.length) return bad('The draw changed while you were editing. Reload and try again.', 409)
    return Response.json({ draw: data[0] })
  }

  if (action === 'attach') {
    const cols = await hasNewColumns()
    if (cols.error) return bad(cols.error.message, 500)
    if (cols.missing) return bad(MIGRATION_REQUIRED, 409)
    if (draw.status === 'void') return bad('This draw is void.', 409)
    if (!drawAttachmentPathOk(body.path, draw.job_id, draw.id)) return bad('Attachment path must be in this draw\'s folder.')
    const list = Array.isArray(draw.attachments) ? draw.attachments : []
    if (list.some(a => a?.path === body.path)) return Response.json({ draw })
    update.attachments = [...list, { path: body.path, name: optText(body.name, 200) || body.path.split('/').pop(), uploaded_at: new Date().toISOString(), uploaded_by: g.auth.userId }]
    const { data, error } = await adminSupabase.from('res_owner_draws').update(update).eq('id', draw.id).select('*')
    if (error) return bad(error.message, 500)
    return Response.json({ draw: data?.[0] || { ...draw, ...update } })
  }

  return bad('Unknown action.')
}

// DELETE ?id — drafts only. Anything that went to the owner/bank is kept (void it).
export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return bad('id required')
  const found = await loadDraw(id)
  if (found.res) {
    const g0 = await guard(request)
    return g0.res || found.res
  }
  const g = await guard(request, found.draw.job_id)
  if (g.res) return g.res
  if (found.draw.status !== 'draft') return bad('Only a draft draw can be deleted. Submitted or funded draws stay on record; void it instead.', 409)
  const { data, error } = await adminSupabase.from('res_owner_draws').delete().eq('id', id).eq('status', 'draft').select('id')
  if (error) return bad(error.message, 500)
  if (!data?.length) return bad('The draw changed. Reload and try again.', 409)
  return Response.json({ ok: true })
}
