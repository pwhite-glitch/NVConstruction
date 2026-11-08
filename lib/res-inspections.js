// Residential inspections (res_inspections): shared field rules for /api/res-inspections,
// the office residential page and the field app. No server imports.

export const INSPECTION_TYPES = ['Foundation', 'Framing', 'Rough Plumbing', 'Rough Electrical', 'Rough HVAC', 'Insulation', 'Drywall', 'Final Plumbing', 'Final Electrical', 'Final HVAC', 'Final']
export const INSPECTION_RESULTS = ['pending', 'passed', 'failed', 'rescheduled']
// Columns a client may write (create / update). Everything else is ignored.
export const INSPECTION_FIELDS = ['inspection_type', 'scheduled_date', 'inspector_name', 'result', 'notes', 'actual_date']
// Columns returned to clients.
export const INSPECTION_SELECT = 'id, job_id, inspection_type, scheduled_date, inspector_name, result, notes, actual_date, created_at'
const OUT_COLS = INSPECTION_SELECT.split(', ')
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
