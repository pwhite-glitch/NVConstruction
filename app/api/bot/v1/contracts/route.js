import { withBot, refuse, refusedMethods, badRequest, dbError, requireJobId } from '../../../../../lib/bot-api'

// GET ?job_id= → subcontracts on the job, each with its SOV lines
export const GET = withBot(async ({ supabase, request }) => {
  const jobId = requireJobId(new URL(request.url).searchParams)
  if (!jobId) return badRequest('job_id required')
  const { data: contracts, error } = await supabase.from('subcontracts').select('*').eq('job_id', jobId).order('created_at', { ascending: true })
  if (error) return dbError(error)
  const ids = (contracts || []).map(c => c.id)
  let lines = []
  if (ids.length) {
    const { data, error: lineErr } = await supabase.from('subcontract_sov_lines').select('*').in('subcontract_id', ids)
      .order('sort_order').order('created_at')
    if (lineErr) return dbError(lineErr)
    lines = data || []
  }
  return Response.json({
    data: (contracts || []).map(c => ({ ...c, sov_lines: lines.filter(l => l.subcontract_id === c.id) })),
  })
})

// Creating subcontracts is POST /api/bot/v1/subcontracts
export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
