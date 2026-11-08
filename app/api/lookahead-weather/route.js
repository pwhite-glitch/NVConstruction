import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { loadJobForecast } from '../../../lib/lookahead-forecast'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id — { days: { 'YYYY-MM-DD': { high, low, precip, label, icon } }, place }.
// Always 200: when the forecast can't be had, days is {} and the lookahead just
// shows no weather. Cached per instance (forecast an hour, geocoded place a day).
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  if (!jobId) return Response.json({ days: {} })
  const denied = await denyJob(adminSupabase, auth, jobId)
  if (denied) return denied
  return Response.json(await loadJobForecast(adminSupabase, jobId))
}
