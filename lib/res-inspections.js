// Job inspections (table res_inspections — all job types since prompt67d / migration 064):
// shared field rules for /api/res-inspections, the office residential page, the commercial
// job page and the field app. No server imports.

// Residential (house) inspection types — unchanged.
export const INSPECTION_TYPES = ['Foundation', 'Framing', 'Rough Plumbing', 'Rough Electrical', 'Rough HVAC', 'Insulation', 'Drywall', 'Final Plumbing', 'Final Electrical', 'Final HVAC', 'Final']
// Commercial inspection types. inspection_type is free text, so the UI also offers "Other…".
export const COMMERCIAL_INSPECTION_TYPES = ['Underground Plumbing', 'Footing / Slab', 'Framing', 'Above-Ceiling / MEP Rough', 'Fire Sprinkler', 'Fire Alarm', 'Hood / Suppression', 'Health Department', 'Fire Marshal Final', 'Building Final / CO']
const isResidentialType = job => String((job && typeof job === 'object' ? job.job_type : job) ?? '').trim().toLowerCase() === 'residential'
// Type list for a job (or a job_type string): residential → house list, anything else → commercial.
export const inspectionTypesFor = job => (isResidentialType(job) ? INSPECTION_TYPES : COMMERCIAL_INSPECTION_TYPES)

export const INSPECTION_RESULTS = ['pending', 'passed', 'failed', 'rescheduled']
// Columns added by migration 064 (may be missing until it is applied).
export const INSPECTION_064_COLS = ['agency', 'lookahead_activity_id']
// Columns a client may write (create / update). Everything else is ignored.
export const INSPECTION_FIELDS = ['inspection_type', 'scheduled_date', 'inspector_name', 'result', 'notes', 'actual_date', ...INSPECTION_064_COLS]
// Columns returned to clients. INSPECTION_SELECT_PRE064 is the fallback before migration 064.
export const INSPECTION_SELECT_PRE064 = 'id, job_id, inspection_type, scheduled_date, inspector_name, result, notes, actual_date, created_at'
export const INSPECTION_SELECT = `${INSPECTION_SELECT_PRE064}, ${INSPECTION_064_COLS.join(', ')}`
const OUT_COLS = INSPECTION_SELECT.split(', ')
// A read / write failed because a migration-064 column is not in the database yet
// (Postgres 42703 or PostgREST schema cache PGRST204).
export function isMissing064Column(error) {
  if (!error) return false
  const msg = String(error.message || '')
  const missing = error.code === '42703' || error.code === 'PGRST204' || /does not exist|could not find the .*column|schema cache/i.test(msg)
  return missing && INSPECTION_064_COLS.some(c => msg.includes(c))
}
// Drop the 064 columns from a write payload (pre-064 retry).
export const withoutInspection064 = row => Object.fromEntries(Object.entries(row || {}).filter(([k]) => !INSPECTION_064_COLS.includes(k)))
// Explicit response fields (never a whole row).
export const inspectionOut = row => (row ? Object.fromEntries(OUT_COLS.map(k => [k, row[k] ?? null])) : null)

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// Validate and pick the allow-listed fields. `create` requires an inspection type and
// defaults result to pending. Returns { fields } or { error }.
export function inspectionFields(body = {}, { create = false } = {}) {
  const out = {}
  for (const k of INSPECTION_FIELDS) {
    if (!(k in (body || {}))) continue
    const v = body[k]
    if (k === 'scheduled_date' || k === 'actual_date') {
      if (v === null || v === '' || v === undefined) out[k] = null
      else if (isDate(v)) out[k] = v
      else return { error: 'Dates must be YYYY-MM-DD.' }
    } else if (k === 'result') {
      const r = String(v || '').trim().toLowerCase()
      if (!INSPECTION_RESULTS.includes(r)) return { error: `Result must be one of: ${INSPECTION_RESULTS.join(', ')}.` }
      out.result = r
    } else if (k === 'inspection_type') {
      const t = String(v ?? '').trim().slice(0, 100)
      if (!t) return { error: 'Inspection type is required.' }
      out.inspection_type = t
    } else if (k === 'inspector_name') {
      const t = String(v ?? '').trim().slice(0, 200)
      out.inspector_name = t || null
    } else if (k === 'notes') {
      const t = String(v ?? '').slice(0, 4000)
      out.notes = t.trim() ? t : null
    } else if (k === 'agency') {
      const t = String(v ?? '').trim().slice(0, 200)
      out.agency = t || null
    } else if (k === 'lookahead_activity_id') {
      if (v === null || v === undefined || v === '') out.lookahead_activity_id = null
      else {
        const t = String(v).trim()
        if (!t || t.length > 64 || !/^[A-Za-z0-9-]+$/.test(t)) return { error: 'Invalid lookahead activity.' }
        out.lookahead_activity_id = t
      }
    }
  }
  if (create) {
    if (!out.inspection_type) return { error: 'Inspection type is required.' }
    if (!out.result) out.result = 'pending'
  }
  // A pending inspection has not happened: no actual date.
  if (out.result === 'pending' && !('actual_date' in out)) out.actual_date = null
  return { fields: out }
}
