import { withBot, refuse, refusedMethods, notFound, dbError } from '../../../../../../lib/bot-api'

// One job with its budget lines (same order as the job page)
export const GET = withBot(async ({ supabase, params }) => {
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', params.id).maybeSingle()
  if (error) return dbError(error)
  if (!job) return notFound('Job not found')
  const { data: budgetLines, error: biErr } = await supabase.from('budget_items').select('*').eq('job_id', job.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('cost_code', { ascending: true })
  if (biErr) return dbError(biErr)
  return Response.json({ data: { ...job, budget_lines: budgetLines || [] } })
})

export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
