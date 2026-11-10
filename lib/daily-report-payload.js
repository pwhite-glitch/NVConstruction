// Daily reports filed from the job page (commercial + residential) — pure helpers.
// Shapes match the field app's insert (app/field/page.js submitDailyReport), which is
// the source of truth for the jsonb logs; the field app keeps its own copy for now.
//
//   crew_log               [{ name, company, trade, hours }]
//   equipment_log          [{ name, quantity, hours }]
//   materials_delivered    [{ description, quantity, supplier }]
//   visitors               [{ name, company, purpose }]
//   subcontractor_activity [{ subId?, company, trade, crew_count, work_performed }]
//   photos                 [{ path, caption?, name?, internal_only?: boolean }]
//
// Photos are jsonb only (no job_photos row). internal_only (prompt73) is passed through
// unchanged when it is a boolean; missing means owner-visible.

export const WEATHER = ['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Heavy Rain', 'Thunderstorm', 'Snow', 'Windy', 'Extreme Heat', 'Fog']

export const emptyDailyForm = (reportDate = '') => ({ report_date: reportDate, weather: '', weather_temp: '', weather_delay: false, crew_count: '', work_performed: '', issues: '', safety_observations: '', toolbox_talk: '' })
export const emptyCrewRow = () => ({ name: '', company: '', trade: '', hours: '' })
export const emptyEquipmentRow = () => ({ name: '', quantity: '', hours: '' })
export const emptyMaterialRow = () => ({ description: '', quantity: '', supplier: '' })
export const emptyVisitorRow = () => ({ name: '', company: '', purpose: '' })
export const emptySubActivityRow = () => ({ subId: '', company: '', trade: '', crew_count: '', work_performed: '' })

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const str = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const filled = v => str(v).trim() !== ''
const textOrNull = v => (filled(v) ? str(v) : null)

function isValidDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day
}

// Keep only the field-app keys of each row, and only rows where `keep` holds.
function pickRows(rows, keys, keep) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => r && typeof r === 'object')
    .map(r => Object.fromEntries(keys.map(k => [k, str(r[k])])))
    .filter(keep)
}

export const filledCrew = rows => pickRows(rows, ['name', 'company', 'trade', 'hours'], r => filled(r.name) || filled(r.company))
export const filledEquipment = rows => pickRows(rows, ['name', 'quantity', 'hours'], r => filled(r.name))
export const filledMaterials = rows => pickRows(rows, ['description', 'quantity', 'supplier'], r => filled(r.description))
export const filledVisitors = rows => pickRows(rows, ['name', 'company', 'purpose'], r => filled(r.name))
export const filledSubActivity = rows => pickRows(rows, ['subId', 'company', 'trade', 'crew_count', 'work_performed'], r => filled(r.company))
  .map(({ subId, ...r }) => (filled(subId) && subId !== 'other' ? { subId, ...r } : r))

// Photos must already be uploaded under this job's folder in daily-report-photos.
export function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return []
  return photos.filter(p => p && typeof p === 'object').map(p => {
    const out = { path: str(p.path) }
    if (typeof p.caption === 'string') out.caption = p.caption
    if (typeof p.name === 'string') out.name = p.name
    if (typeof p.internal_only === 'boolean') out.internal_only = p.internal_only
    return out
  })
}

function photoPathOk(jobId, path) {
  return typeof path === 'string' && path.startsWith(`${jobId}/`) && path.length > jobId.length + 1 && !path.includes('..')
}

// → { ok: true } | { ok: false, error }
export function validateDailyReportInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid request.' }
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : ''
  if (!jobId) return { ok: false, error: 'Project is required.' }
  if (!body.report_date) return { ok: false, error: 'Report date is required.' }
  if (!isValidDate(body.report_date)) return { ok: false, error: 'Report date must be a valid date (YYYY-MM-DD).' }
  if (typeof body.work_performed !== 'string' || !body.work_performed.trim()) return { ok: false, error: 'Work performed is required.' }
  if (body.photos != null && !Array.isArray(body.photos)) return { ok: false, error: 'Photos must be a list.' }
  for (const p of cleanPhotos(body.photos)) {
    if (!photoPathOk(jobId, p.path)) return { ok: false, error: 'A photo is not stored under this project.' }
  }
  return { ok: true }
}

// Row for daily_reports insert. super_id is always the signed-in caller (never the body).
export function buildDailyReportRow({ authUserId, body }) {
  const crew = filledCrew(body.crew_log)
  const equipment = filledEquipment(body.equipment_log)
  const materials = filledMaterials(body.materials_delivered)
  const visitors = filledVisitors(body.visitors)
  const subs = filledSubActivity(body.subcontractor_activity)
  const photos = cleanPhotos(body.photos)
  const typedCrew = parseInt(str(body.crew_count), 10)
  return {
    job_id: body.job_id.trim(),
    super_id: authUserId,
    report_date: body.report_date,
    weather: textOrNull(body.weather),
    weather_temp: textOrNull(body.weather_temp),
    weather_delay: body.weather_delay === true,
    crew_count: Number.isFinite(typedCrew) && typedCrew >= 0 && filled(body.crew_count) ? typedCrew : crew.length || null,
    work_performed: body.work_performed,
    issues: textOrNull(body.issues),
    safety_observations: textOrNull(body.safety_observations),
    toolbox_talk: textOrNull(body.toolbox_talk),
    crew_log: crew.length ? crew : null,
    equipment_log: equipment.length ? equipment : null,
    materials_delivered: materials.length ? materials : null,
    visitors: visitors.length ? visitors : null,
    subcontractor_activity: subs.length ? subs : null,
    photos: photos.length ? photos : null,
  }
}

// Same mapping the field app uses when a report logs materials.
export function buildDeliveriesFromMaterials(jobId, userId, reportDate, materials) {
  return filledMaterials(materials).map(m => ({
    job_id: jobId,
    super_id: userId,
    material: m.description,
    vendor: m.supplier || null,
    quantity: m.quantity || null,
    status: 'received',
    received_date: reportDate,
    source: 'daily_report',
  }))
}

// Client-side: "A daily report already exists for …" when that date is already on the job.
export function duplicateReportMessage(reportDate, existingDates) {
  if (!reportDate || !Array.isArray(existingDates) || !existingDates.includes(reportDate)) return null
  return `A daily report already exists for ${reportDate} on this job. Submit another anyway?`
}

// Storage helpers (same naming as the field app).
export const uniquePhotoName = (ts, i) => `${ts}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`
export const thumbPath = path => path?.replace(/\.jpg$/i, '_thumb.jpg') ?? null
