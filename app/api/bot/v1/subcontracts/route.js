import { withBot, refusedMethods, badRequest, notFound, dbError, logBotChange, fmtAmt } from '../../../../../lib/bot-api'
import { validateSubcontract, linkedBudgetItemIds } from '../../../../../lib/bot-rules'

// Create a subcontract as 'draft' or 'active', like the job page's Add Contract.
// No email, no e-signature; activating later, approving or executing stays in the portal.
export const POST = withBot(async ({ bot, supabase, request }) => {
  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }
  const { row, error: invalid } = validateSubcontract(body)
  if (invalid) return badRequest(invalid)

  const { data: job } = await supabase.from('jobs').select('id').eq('id', row.job_id).maybeSingle()
  if (!job) return notFound('Job not found')

  if (row.company_id) {
    const { data: company } = await supabase.from('companies').select('id, name').eq('id', row.company_id).maybeSingle()
    if (!company) return badRequest('company_id not found')
    if (!row.vendor_name) row.vendor_name = company.name || ''
  }
  if (row.sub_id) {
    const { data: sub } = await supabase.from('profiles').select('id').eq('id', row.sub_id).maybeSingle()
    if (!sub) return badRequest('sub_id is not a portal user')
  }

  // Budget lines must belong to this job
  const budgetIds = linkedBudgetItemIds(row)
  if (budgetIds.length) {
    const { data: lines, error } = await supabase.from('budget_items').select('id').eq('job_id', row.job_id).in('id', budgetIds)
    if (error) return dbError(error)
    const found = new Set((lines || []).map(l => l.id))
    const missing = budgetIds.filter(id => !found.has(id))
    if (missing.length) return badRequest(`Budget lines not on this job: ${missing.join(', ')}`)
  }

  const { data, error } = await supabase.from('subcontracts').insert({ ...row, created_by: bot.id }).select('id').single()
  if (error) return dbError(error)

  await logBotChange(bot, supabase, {
    job_id: row.job_id, entity_type: 'subcontract', entity_id: data.id, field_name: 'created',
    new_value: fmtAmt(row.contract_value), note: `Subcontract created (${row.status}) — ${row.vendor_name || ''}`,
  })
  return Response.json({ ok: true, id: data.id, status: row.status }, { status: 201 })
})

export async function GET() {
  return Response.json({ error: 'Use GET /api/bot/v1/contracts?job_id= to list subcontracts' }, { status: 404 })
}
export const { PUT, PATCH, DELETE } = refusedMethods
