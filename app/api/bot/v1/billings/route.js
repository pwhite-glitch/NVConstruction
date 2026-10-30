import { withBot, refusedMethods, badRequest, notFound, dbError, requireJobId, pageParams, paged, logBotChange, fmtAmt } from '../../../../../lib/bot-api'
import { validateBilling } from '../../../../../lib/bot-rules'
import { withoutNew032 } from '../../../../../lib/billing-fields'

// GET ?job_id= &limit= &offset=
export const GET = withBot(async ({ supabase, request }) => {
  const { searchParams } = new URL(request.url)
  const jobId = requireJobId(searchParams)
  if (!jobId) return badRequest('job_id required')
  const page = pageParams(searchParams)
  const { data, error } = await supabase.from('billing_submissions').select('*').eq('job_id', jobId)
    .order('submitted_at', { ascending: false }).range(page.from, page.to)
  if (error) return dbError(error)
  return Response.json(paged(data, page))
})

// Create a pending billing. Never assigned to a draw, never approved, no notifications.
export const POST = withBot(async ({ bot, supabase, request }) => {
  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }
  const { row, error: invalid } = validateBilling(body)
  if (invalid) return badRequest(invalid)

  const { data: job } = await supabase.from('jobs').select('id').eq('id', row.job_id).maybeSingle()
  if (!job) return notFound('Job not found')
  if (row.sub_id) {
    const { data: sub } = await supabase.from('profiles').select('id').eq('id', row.sub_id).maybeSingle()
    if (!sub) return badRequest('sub_id is not a portal user')
  }

  const insertRow = { ...row, submitted_at: new Date().toISOString() }
  let { data, error } = await supabase.from('billing_submissions').insert(insertRow).select('id').single()
  if (error?.message?.includes('schema cache')) {
    ({ data, error } = await supabase.from('billing_submissions').insert(withoutNew032(insertRow)).select('id').single())
  }
  if (error) return dbError(error)

  await logBotChange(bot, supabase, {
    job_id: row.job_id, entity_type: 'billing', entity_id: data.id, field_name: 'created',
    new_value: fmtAmt(row.amount_billed), note: `Billing created (pending) — ${row.company_name || ''}`,
  })
  return Response.json({ ok: true, id: data.id }, { status: 201 })
})

export const { PUT, PATCH, DELETE } = refusedMethods
