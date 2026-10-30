import { withBot, refuse, refusedMethods, badRequest, dbError, requireJobId } from '../../../../../lib/bot-api'

// GET ?job_id= → sub change orders (via their subcontract, as the job page loads them) and prime change orders
export const GET = withBot(async ({ supabase, request }) => {
  const jobId = requireJobId(new URL(request.url).searchParams)
  if (!jobId) return badRequest('job_id required')
  const [subRes, primeRes] = await Promise.all([
    supabase.from('change_orders')
      .select('*, subcontracts!inner(id, job_id, vendor_name, company_id)')
      .eq('subcontracts.job_id', jobId)
      .order('created_at', { ascending: false }),
    supabase.from('prime_change_orders').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
  ])
  if (subRes.error) return dbError(subRes.error)
  if (primeRes.error) return dbError(primeRes.error)
  return Response.json({ sub_change_orders: subRes.data || [], prime_change_orders: primeRes.data || [] })
})

export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
