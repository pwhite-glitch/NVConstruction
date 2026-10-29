// Daily forecast for the lookahead from Open-Meteo (free, no key).
// Pure helpers here; the fetch and cache live in /api/lookahead-weather.

export const RAIN_RISK_PCT = 50

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

// Use coordinates already on the job when it has them (any common column name).
export function jobCoords(job) {
  if (!job) return null
  const lat = num(job.latitude ?? job.lat)
  const lng = num(job.longitude ?? job.lng ?? job.lon)
  return lat !== null && lng !== null ? { lat, lng } : null
}

// City and state to geocode, from city/state columns if the job has them, else
// the free-text location ("Fargo, ND", "123 Main St, Fargo, ND 58102").
export function jobPlace(job) {
  if (!job) return null
  const city = (job.city || job.job_city || '').trim()
  const state = (job.state || job.job_state || '').trim()
  if (city) return { name: city, region: stateName(state) }
  const parts = (job.location || job.address || '').split(',').map(p => p.trim()).filter(Boolean)
  if (!parts.length) return null
  if (parts.length === 1) {
    const one = parts[0].replace(/\s+\d{5}(-\d{4})?$/, '')
    const m = /^(.*\S)\s+([A-Za-z]{2})$/.exec(one) // "Fargo ND"
    if (m && stateName(m[2])) return { name: m[1], region: stateName(m[2]) }
    return { name: one, region: null }
  }
  const last = parts[parts.length - 1].replace(/\s*\d{5}(-\d{4})?$/, '').trim()
  const region = stateName(last)
  // "City, ST" or "Street, City, ST": city is the part before the state
  if (region) return { name: parts[parts.length - 2], region }
  return { name: parts[parts.length - 1], region: null }
}

export function stateName(s) {
  if (!s) return null
  const up = s.trim().toUpperCase()
  if (STATES[up]) return STATES[up]
  return Object.values(STATES).find(n => n.toUpperCase() === up) || null
}

export const geocodeUrl = name => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`

export const forecastUrl = ({ lat, lng }) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
  '&temperature_unit=fahrenheit&timezone=auto&forecast_days=16'

// Best geocoding hit: the one in the job's state when known, US preferred.
export function pickGeocodeResult(results, region) {
  const list = results || []
  const us = list.filter(r => r.country_code === 'US')
  const pick = (region && us.find(r => r.admin1 === region)) || us[0] || list[0]
  return pick ? { lat: pick.latitude, lng: pick.longitude, label: [pick.name, pick.admin1].filter(Boolean).join(', ') } : null
}

// WMO weather codes as Open-Meteo reports them.
export function weatherLabel(code) {
  if (code === 0) return { label: 'Clear', icon: '☀️' }
  if (code <= 2) return { label: 'Partly cloudy', icon: '⛅' }
  if (code === 3) return { label: 'Overcast', icon: '☁️' }
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: '🌧️' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: '🌨️' }
  if (code >= 95) return { label: 'Thunderstorms', icon: '⛈️' }
  return { label: 'Unknown', icon: '' }
}

// Open-Meteo daily response -> { 'YYYY-MM-DD': { high, low, precip, code, label, icon } }
export function parseForecast(json) {
  const d = json?.daily
  if (!d?.time) return {}
  const out = {}
  d.time.forEach((date, i) => {
    const code = num(d.weather_code?.[i])
    const high = num(d.temperature_2m_max?.[i])
    const low = num(d.temperature_2m_min?.[i])
    out[date] = {
      high: high === null ? null : Math.round(high),
      low: low === null ? null : Math.round(low),
      precip: num(d.precipitation_probability_max?.[i]),
      code,
      ...weatherLabel(code),
    }
  })
  return out
}

export const isRainRisk = day => !!day && day.precip !== null && day.precip !== undefined && day.precip >= RAIN_RISK_PCT

// Work that is probably outside and affected by rain, from the description and location.
const OUTDOOR = /\b(pour|pours|pouring|concrete|slab|footings?|foundations?|flatwork|sidewalks?|curbs?|paving|pave|asphalt|excavat\w*|dig|digging|trench\w*|grad(e|ing)|backfill\w*|earthwork|dirt|site ?work|sitework|compaction|roof\w*|shingles?|siding|stucco|masonry|brick|block wall|exterior|outside|outdoor|landscap\w*|sod|seeding|fenc\w*|utilit(y|ies)|storm (drain|sewer)|sewer|water main|survey\w*|crane|steel erection|erect\w*|stripe|striping|seal ?coat|parking lot|demo(lition)?|framing|frame walls|trusses|sheathing|gutters?|paint(ing)? exterior)\b/i
const INDOOR = /\b(interior|inside|indoor)\b/i

export function looksOutdoor(act) {
  const text = `${act?.description || ''} ${act?.location || ''}`
  if (INDOOR.test(text) && !/\b(exterior|outside|outdoor)\b/i.test(text)) return false
  return OUTDOOR.test(text)
}

export const rainFlagged = (act, day) => isRainRisk(day) && looksOutdoor(act)

// "72°/55° · 30%"
export function forecastText(day) {
  if (!day) return ''
  const temps = day.high !== null && day.low !== null ? `${day.high}°/${day.low}°` : ''
  const precip = day.precip !== null && day.precip !== undefined ? `${day.precip}%` : ''
  return [temps, precip].filter(Boolean).join(' · ')
}
