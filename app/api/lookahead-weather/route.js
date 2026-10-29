import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { jobCoords, jobPlace, geocodeUrl, forecastUrl, pickGeocodeResult, parseForecast } from '../../../lib/lookahead-weather'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Per-instance cache: forecasts for an hour, geocoded job places for a day.
const forecastCache = new Map()
const placeCache = new Map()
const HOUR = 60 * 60 * 1000

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// GET ?job_id — { days: { 'YYYY-MM-DD': { high, low, precip, label, icon } }, place }.
// Always 200: when the forecast can't be had, days is {} and the lookahead just
// shows no weather.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  if (!jobId) return Response.json({ days: {} })
  const hit = forecastCache.get(jobId)
  if (hit && Date.now() - hit.at < HOUR) return Response.json(hit.value)
  try {
    const { data: job } = await adminSupabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
    let coords = jobCoords(job)
    let place = null
    if (!coords) {
      const where = jobPlace(job)
      if (!where) return Response.json({ days: {}, reason: 'No job location' })
      const key = `${where.name}|${where.region || ''}`.toLowerCase()
      const cached = placeCache.get(key)
      if (cached && Date.now() - cached.at < 24 * HOUR) coords = cached.value
      else {
        coords = pickGeocodeResult((await getJson(geocodeUrl(where.name))).results, where.region)
        if (coords) placeCache.set(key, { at: Date.now(), value: coords })
      }
      if (!coords) return Response.json({ days: {}, reason: 'Job location not found' })
      place = coords.label
    }
    const value = { days: parseForecast(await getJson(forecastUrl(coords))), place }
    forecastCache.set(jobId, { at: Date.now(), value })
    return Response.json(value)
  } catch (e) {
    return Response.json({ days: {}, reason: e.message })
  }
}
