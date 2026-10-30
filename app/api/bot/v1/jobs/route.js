import { withBot, refuse, refusedMethods, pageParams, paged, dbError } from '../../../../../lib/bot-api'

// GET ?q=<job number or project name> &limit= &offset=
export const GET = withBot(async ({ supabase, request }) => {
  const { searchParams } = new URL(request.url)
  const page = pageParams(searchParams)
  let q = supabase.from('jobs').select('*').order('created_at', { ascending: false }).range(page.from, page.to)
  const search = (searchParams.get('q') || '').trim().replace(/[,()%]/g, ' ')
  if (search) q = q.or(`job_number.ilike.%${search}%,project_name.ilike.%${search}%`)
  const { data, error } = await q
  if (error) return dbError(error)
  return Response.json(paged(data, page))
})

export const POST = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
