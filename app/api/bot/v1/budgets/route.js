import { withBot, refuse, refusedMethods, badRequest, dbError, requireJobId } from '../../../../../lib/bot-api'

// GET ?job_id= → budget lines plus totals
export const GET = withBot(async ({ supabase, request }) => {
  const jobId = requireJobId(new URL(request.url).searchParams)
  if (!jobId) return badRequest('job_id required')
  const { data, error } = await supabase.from('budget_items').select('*').eq('job_id', jobId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('cost_code', { ascending: true })
  if (error) return dbError(error)
  const lines = data || []
  const sum = (k) => lines.reduce((a, l) => a + Number(l[k] || 0), 0)
  return Response.json({ data: lines, totals: { budget_amount: sum('budget_amount'), owner_amount: sum('owner_amount') } })
})

export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
