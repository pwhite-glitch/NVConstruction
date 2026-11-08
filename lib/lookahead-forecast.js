// Server-side forecast loader for a job (Open-Meteo, cached per instance), plus the
// weather-warning block for lookahead emails. Used by /api/lookahead-weather and the
// Submit-to-PM email in /api/lookaheads.
import { jobCoords, jobPlace, geocodeUrl, forecastUrl, pickGeocodeResult, parseForecast, weatherFlags, COLD_RISK_F, RAIN_RISK_PCT } from './lookahead-weather'
import { lookaheadDays, activitiesForDay } from './lookahead-dates'

const forecastCache = new Map()
const placeCache = new Map()
const HOUR = 60 * 60 * 1000

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// { days, place?, reason? }. Never throws: when the forecast can't be had, days is {}.
export async function loadJobForecast(db, jobId, { fetchImpl = fetch, useCache = true } = {}) {
  if (!jobId) return { days: {} }
  const hit = useCache && forecastCache.get(jobId)
  if (hit && Date.now() - hit.at < HOUR) return hit.value
  try {
    const { data: job } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle()
    let coords = jobCoords(job)
    let place = null
    if (!coords) {
      const where = jobPlace(job)
      if (!where) return { days: {}, reason: 'No job location' }
      const key = `${where.name}|${where.region || ''}`.toLowerCase()
      const cached = useCache && placeCache.get(key)
      if (cached && Date.now() - cached.at < 24 * HOUR) coords = cached.value
      else {
        coords = pickGeocodeResult((await getJson(geocodeUrl(where.name), fetchImpl)).results, where.region)
        if (coords) placeCache.set(key, { at: Date.now(), value: coords })
      }
      if (!coords) return { days: {}, reason: 'Job location not found' }
      place = coords.label
    }
    const value = { days: parseForecast(await getJson(forecastUrl(coords), fetchImpl)), place }
    if (useCache) forecastCache.set(jobId, { at: Date.now(), value })
    return value
  } catch (e) {
    return { days: {}, reason: e.message }
  }
}

// Each (activity, working day) in the lookahead's 10 days that is rain- or freeze-flagged.
export function lookaheadWeatherFlags(activities, weekStart, forecast = {}) {
  const items = []
  for (const date of lookaheadDays(weekStart)) {
    for (const act of activitiesForDay(activities, date)) {
      if (act.status === 'done') continue
      items.push({ act, date })
    }
  }
  return weatherFlags(items, forecast)
}

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const dayStr = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

// HTML block for an email, or '' when nothing is flagged.
export function weatherWarningHtml(flags) {
  if (!flags?.length) return ''
  const lines = flags.map(f => {
    const tags = [
      f.cold ? `❄ Freeze risk (low ${escHtml(f.day.low)}°F)` : null,
      f.rain ? `☔ Rain risk (${escHtml(f.day.precip)}%)` : null,
    ].filter(Boolean).join(' · ')
    return `<li><strong>${dayStr(f.date)}</strong>: ${escHtml(f.act.description)} — ${tags}</li>`
  })
  return `<p style="margin-top:16px"><strong style="color:#1d4ed8">⚠ Weather warnings:</strong> forecast low at or below ${COLD_RISK_F}°F on temperature-sensitive work (pours, masonry, roofing, sealants, exterior paint) and/or ${RAIN_RISK_PCT}%+ chance of rain on outdoor work.</p><ul style="margin:8px 0;padding-left:20px">${lines.join('')}</ul>`
}
