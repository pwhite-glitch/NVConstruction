// Columns the lookahead forms may write on lookahead_activities through /api/lookahead-activities.

export const ACTIVITY_FIELDS = new Set([
  'lookahead_id', 'planned_date', 'description', 'location',
  'responsible_type', 'sub_id', 'other_company_name', 'manpower', 'equipment',
  'materials_status', 'inspection_required', 'inspection_scheduled',
  'preceding_work_complete', 'committed', 'constraints', 'constraints_notes',
  'company_equipment_ids', 'additional_companies',
])

// Help text under the checkboxes, same on the job page and in the field app.
export const PRECEDING_WORK_HELP = 'Everything that has to happen first (earlier trades, inspections, approvals) is done, so this work can start.'
export const COMMITTED_HELP = 'The crew or company doing this work has confirmed they will be here on this date.'

// Column added by migration 033. Until it is applied, writes that include it
// fail with a "schema cache" error and are retried without it.
export const NEW_033_COLS = new Set(['constraints'])

export function withoutNew033(row) {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !NEW_033_COLS.has(k)))
}

// Pick allowed fields and turn form values into what the columns accept.
// The forms start with sub_id: '' and manpower: '', and an empty string is not a
// valid uuid / integer, so every save without a sub picked (Own Crew, Other
// Company, Subcontractor with none selected) failed with a 500.
export function cleanActivity(raw) {
  const row = Object.fromEntries(Object.entries(raw).filter(([k]) => ACTIVITY_FIELDS.has(k)))
  if ('sub_id' in row) row.sub_id = row.sub_id || null
  if ('responsible_type' in row && row.responsible_type !== 'sub') row.sub_id = null
  if ('other_company_name' in row) row.other_company_name = row.other_company_name?.trim() || null
  if ('responsible_type' in row && row.responsible_type !== 'other') row.other_company_name = null
  if ('manpower' in row) {
    const n = parseInt(row.manpower, 10)
    row.manpower = Number.isNaN(n) ? null : n
  }
  return row
}

// Sub dropdown options: one per contract id, and one per company name (a vendor
// with two contracts on the job, or a duplicated row, shows once). When a
// duplicate name is the one already selected on the activity, that row is kept.
export function uniqueSubOptions(contracts, selectedId) {
  const key = c => (c.vendor_name || '').trim().toLowerCase()
  const seenIds = new Set()
  const byName = new Map()
  for (const c of contracts || []) {
    if (seenIds.has(c.id)) continue
    seenIds.add(c.id)
    const k = key(c) || c.id
    if (!byName.has(k) || c.id === selectedId) byName.set(k, c)
  }
  return [...byName.values()]
}
