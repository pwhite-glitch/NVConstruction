import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import { sovEditError, sovDeleteError, sovDbErrorMessage } from '../../../lib/sov-guards'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Office edits to a subcontract's schedule of values (job page Contracts → SOV).
// The job always comes from the database (line → subcontract → job), never the body.
// Subs create their initial SOV through /api/sub-portal/sov; approved CO lines are added by
// /api/co-response and /api/sov-co-backfill. Neither goes through here.

async function loadContract(subcontractId) {
  if (!subcontractId) return { error: Response.json({ error: 'subcontract_id required' }, { status: 400 }) }
  const { data, error } = await adminSupabase.from('subcontracts').select('id, job_id').eq('id', subcontractId).maybeSingle()
  if (error) return { error: Response.json({ error: error.message }, { status: 500 }) }
  if (!data) return { error: Response.json({ error: 'Subcontract not found.' }, { status: 404 }) }
  return { contract: data }
}

async function loadLine(id) {
  if (!id) return { error: Response.json({ error: 'id required' }, { status: 400 }) }
  const { data: line, error } = await adminSupabase.from('subcontract_sov_lines')
    .select('id, subcontract_id, description, scheduled_value, budget_item_id, sort_order, change_order_id').eq('id', id).maybeSingle()
  if (error) return { error: Response.json({ error: error.message }, { status: 500 }) }
  if (!line) return { error: Response.json({ error: 'SOV line not found.' }, { status: 404 }) }
  const { contract, error: cErr } = await loadContract(line.subcontract_id)
  if (cErr) return { error: cErr }
  return { line, contract }
}

// Billing lines (any status, any amount) pointing at this SOV line. Fails closed.
async function billingRefCount(lineId) {
  const { count, error } = await adminSupabase.from('billing_sov_lines').select('id', { count: 'exact', head: true }).eq('sov_line_id', lineId)
  if (error) return { error: Response.json({ error: 'Could not check billings on this line: ' + error.message }, { status: 500 }) }
  return { count: count || 0 }
}

async function badBudgetLine(budgetItemId, jobId) {
  if (!budgetItemId) return null
  const { data, error } = await adminSupabase.from('budget_items').select('id, job_id').eq('id', budgetItemId).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'That budget line no longer exists.' }, { status: 422 })
  if (data.job_id !== jobId) return Response.json({ error: 'That budget line belongs to a different job.' }, { status: 422 })
  return null
}

const dbError = error => Response.json({ error: sovDbErrorMessage(error.message) }, { status: /sov_line_billed/.test(error.message || '') ? 409 : 500 })

// POST { subcontract_id, description, scheduled_value, budget_item_id? }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { contract, error: cErr } = await loadContract(body.subcontract_id)
    if (cErr) return cErr
    const denied = await denyUnlessOnJob(adminSupabase, auth, contract.job_id)
    if (denied) return denied
    const problem = sovEditError({}, { description: body.description, scheduled_value: body.scheduled_value }, 0)
    if (problem) return Response.json({ error: problem.error }, { status: problem.status })
    const badLine = await badBudgetLine(body.budget_item_id, contract.job_id)
    if (badLine) return badLine
    const { data: existing, error: exErr } = await adminSupabase.from('subcontract_sov_lines').select('sort_order').eq('subcontract_id', contract.id)
    if (exErr) return Response.json({ error: exErr.message }, { status: 500 })
    const sort_order = (existing || []).reduce((m, l) => Math.max(m, l.sort_order || 0), 0) + 1
    const { data, error } = await adminSupabase.from('subcontract_sov_lines').insert({
      subcontract_id: contract.id,
      description: String(body.description).trim(),
      scheduled_value: Math.round(Number(body.scheduled_value) * 100) / 100,
      budget_item_id: body.budget_item_id || null,
      sort_order,
    }).select('*').single()
    if (error) return dbError(error)
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH { id, description?, scheduled_value?, budget_item_id? }
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { line, contract, error: lErr } = await loadLine(body.id)
    if (lErr) return lErr
    const denied = await denyUnlessOnJob(adminSupabase, auth, contract.job_id)
    if (denied) return denied
    const fields = {}
    if (body.description !== undefined) fields.description = String(body.description || '').trim()
    if (body.scheduled_value !== undefined) fields.scheduled_value = body.scheduled_value
    if (body.budget_item_id !== undefined) fields.budget_item_id = body.budget_item_id || null
    const { count, error: rErr } = await billingRefCount(line.id)
    if (rErr) return rErr
    const problem = sovEditError(line, fields, count)
    if (problem) return Response.json({ error: problem.error }, { status: problem.status })
    if (fields.budget_item_id) {
      const badLine = await badBudgetLine(fields.budget_item_id, contract.job_id)
      if (badLine) return badLine
    }
    if (fields.scheduled_value !== undefined) fields.scheduled_value = Math.round(Number(fields.scheduled_value) * 100) / 100
    if (!Object.keys(fields).length) return Response.json({ ok: true })
    const { data, error } = await adminSupabase.from('subcontract_sov_lines').update(fields)
      .eq('id', line.id).eq('subcontract_id', line.subcontract_id).select('*')
    if (error) return dbError(error)
    if (!data?.length) return Response.json({ error: 'This SOV line changed or was removed. Refresh and try again.' }, { status: 409 })
    return Response.json({ data: data[0] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE { id }
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { line, contract, error: lErr } = await loadLine(body.id)
    if (lErr) return lErr
    const denied = await denyUnlessOnJob(adminSupabase, auth, contract.job_id)
    if (denied) return denied
    const { count, error: rErr } = await billingRefCount(line.id)
    if (rErr) return rErr
    const problem = sovDeleteError(line, count)
    if (problem) return Response.json({ error: problem.error }, { status: problem.status })
    // A billing that lands between this check and the delete is caught by the 045 trigger
    // (row lock + re-check), so the cascade can never take billing detail with it.
    const { error } = await adminSupabase.from('subcontract_sov_lines').delete().eq('id', line.id)
    if (error) return dbError(error)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
