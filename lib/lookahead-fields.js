// Columns the lookahead forms may write on lookahead_activities through /api/lookahead-activities.
// Shared by the job page Lookahead tab, the field app and the API routes.

export const ACTIVITY_FIELDS = new Set([
  'lookahead_id', 'planned_date', 'end_date', 'description', 'location',
  'responsible_type', 'sub_id', 'other_company_name', 'manpower', 'equipment',
  'materials_status', 'inspection_required', 'inspection_scheduled',
  'preceding_work_complete', 'committed', 'constraints', 'constraints_notes',
  'company_equipment_ids', 'additional_companies', 'status', 'carried_from_id',
])

// Help text under the checkboxes, same on the job page and in the field app.
export const PRECEDING_WORK_HELP = 'Everything that has to happen first (earlier trades, inspections, approvals) is done, so this work can start.'
export const COMMITTED_HELP = 'The crew or company doing this work has confirmed they will be here on this date.'

// The one-tap status chip. Order is the tap-to-cycle order.
export const ACTIVITY_STATUSES = [
  { key: 'not_started', label: 'Not started', fg: '#4b5563', bg: '#f3f4f6', bd: '#d1d5db' },
  { key: 'in_progress', label: 'In progress', fg: '#1d4ed8', bg: '#eff6ff', bd: '#bfdbfe' },
  { key: 'done',        label: 'Done',        fg: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0' },
  { key: 'delayed',     label: 'Delayed',     fg: '#b91c1c', bg: '#fef2f2', bd: '#fecaca' },
]
const STATUS_KEYS = new Set(ACTIVITY_STATUSES.map(st => st.key))
export const statusInfo = key => ACTIVITY_STATUSES.find(st => st.key === key) || ACTIVITY_STATUSES[0]

// Columns added by later migrations. Until a migration is applied, a write that
// includes one of its columns fails with "Could not find the 'x' column ... in
// the schema cache"; the write is retried without that column.
export const PENDING_COLS = {
  constraints: '033',
  end_date: '035', status: '035', carried_from_id: '035',
  submitted_by_name: '035', approved_by: '035', approved_by_name: '035',
  sent_to_subs_at: '035', sent_to_subs_by: '035', sent_to_subs_by_name: '035', sent_to_subs_recipients: '035',
}
const COL_LABELS = { constraints: 'Constraints', end_date: 'End date', status: 'Status', carried_from_id: 'Copied-from link' }

export function missingColumn(message) {
  const m = /Could not find the '([^']+)' column/.exec(message || '')
  return m ? m[1] : null
}

// Run write(row) (row may be an array of rows), dropping not-yet-migrated columns
// one at a time while the database says they are missing.
// Returns { data, error, dropped: [column names] }.
export async function writeWithFallback(write, row) {
  let current = row
  const dropped = []
  for (let i = 0; i <= Object.keys(PENDING_COLS).length; i++) {
    const { data, error } = await write(current)
    const col = error && missingColumn(error.message)
    if (!col || !(col in PENDING_COLS) || dropped.includes(col)) return { data, error, dropped }
    dropped.push(col)
    const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== col))
    current = Array.isArray(current) ? current.map(strip) : strip(current)
  }
  return { data: null, error: { message: 'Too many missing columns' }, dropped }
}

// Warning for the user when a write went through without some of its values.
// Columns whose value was empty or default are not worth mentioning.
export function droppedWarning(dropped, row, what = 'Activity saved') {
  const rows = Array.isArray(row) ? row : [row]
  const lost = dropped.filter(c => c !== 'carried_from_id' && rows.some(r => {
    const v = r?.[c]
    return v != null && v !== '' && !(c === 'status' && v === 'not_started')
  }))
  if (!lost.length) return undefined
  const migrations = [...new Set(lost.map(c => PENDING_COLS[c]))].join(', ')
  return `${what}, but ${lost.map(c => COL_LABELS[c] || c).join(', ')} ${lost.length > 1 ? 'were' : 'was'} not saved (migration ${migrations} not applied yet).`
}

// Sub names in the dropdowns and chips. Some vendor_name values have trailing spaces.
export const subName = contract => (contract?.vendor_name || '').trim()

export function responsibleLabel(act, contracts) {
  if (act.responsible_type === 'sub') return subName((contracts || []).find(c => c.id === act.sub_id)) || 'Sub (not picked)'
  if (act.responsible_type === 'other') return act.other_company_name?.trim() || 'Other'
  return 'Own Crew'
}

// A constraint stays "open" until the activity is marked Done.
export const hasOpenConstraint = act => !!act.constraints?.trim() && act.status !== 'done'

// Why the Add/Save button is disabled, as a short hint; null when the form can be saved.
export function activityProblem(form) {
  if (!form.description?.trim()) return 'Enter a description to save this activity.'
  if (form.responsible_type === 'sub' && !form.sub_id) return 'Pick which subcontractor is doing this work.'
  if (form.end_date && form.planned_date && form.end_date < form.planned_date) return 'End date can\'t be before the start date.'
  return null
}

// Server-side check on a cleaned row. partial: only check fields that are present
// (status taps and drag-to-move send just a few fields).
export function validateActivity(row, { partial = false } = {}) {
  if (!partial || 'description' in row) {
    if (!row.description) return 'Description is required.'
  }
  if (!partial && !row.planned_date) return 'planned_date is required.'
  if ('responsible_type' in row && row.responsible_type === 'sub' && !row.sub_id) return 'Pick the subcontractor for this activity.'
  if (row.end_date && row.planned_date && row.end_date < row.planned_date) return 'End date can\'t be before the start date.'
  if ('status' in row && !STATUS_KEYS.has(row.status)) return `Unknown status "${row.status}".`
  return null
}

// Pick allowed fields and turn form values into what the columns accept.
// The forms start with sub_id: '' and manpower: '', and an empty string is not a
// valid uuid / integer, so every save without a sub picked (Own Crew, Other
// Company, Subcontractor with none selected) failed with a 500.
export function cleanActivity(raw) {
  const row = Object.fromEntries(Object.entries(raw).filter(([k]) => ACTIVITY_FIELDS.has(k)))
  if ('description' in row) row.description = (row.description || '').trim()
  if ('sub_id' in row) row.sub_id = row.sub_id || null
  if ('responsible_type' in row && row.responsible_type !== 'sub') row.sub_id = null
  if ('other_company_name' in row) row.other_company_name = row.other_company_name?.trim() || null
  if ('responsible_type' in row && row.responsible_type !== 'other') row.other_company_name = null
  if ('manpower' in row) {
    const n = parseInt(row.manpower, 10)
    row.manpower = Number.isNaN(n) ? null : n
  }
  // One-day activities keep end_date null
  if ('end_date' in row && (!row.end_date || row.end_date === row.planned_date)) row.end_date = null
  if ('carried_from_id' in row) row.carried_from_id = row.carried_from_id || null
  return row
}

// A copy of an activity for Duplicate / Copy from last week: the same work, no id,
// status back to Not started.
export function copyableActivity(act) {
  const row = Object.fromEntries(Object.entries(act).filter(([k]) => ACTIVITY_FIELDS.has(k)))
  delete row.lookahead_id
  delete row.carried_from_id
  return { ...row, status: 'not_started' }
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

// ── Workflow: Draft > Submitted > Reviewed/Approved > Sent to subs ──

export const LOOKAHEAD_STAGES = [
  { key: 'draft',     label: 'Draft' },
  { key: 'submitted', label: 'Submitted to PM' },
  { key: 'approved',  label: 'Reviewed / Approved' },
  { key: 'sent',      label: 'Sent to subs' },
]

// "Sent" is status approved with a send at or after the latest approval
// (a lookahead re-submitted and re-approved after a send shows Approved again).
export function lookaheadStage(la) {
  if (!la) return null
  if (la.status === 'approved' && la.sent_to_subs_at && (!la.approved_at || la.sent_to_subs_at >= la.approved_at)) return 'sent'
  if (la.status === 'submitted' || la.status === 'approved') return la.status
  return 'draft'
}

export const stageLabel = la => LOOKAHEAD_STAGES.find(st => st.key === lookaheadStage(la))?.label || 'Draft'

// Who and when for each step that has happened, for the workflow bar.
export function stageHistory(la) {
  if (!la) return []
  const out = []
  if (la.submitted_at) out.push({ key: 'submitted', label: 'Submitted', who: la.submitted_by_name, when: la.submitted_at })
  if (la.approved_at && la.status === 'approved') out.push({ key: 'approved', label: 'Approved', who: la.approved_by_name, when: la.approved_at })
  if (la.sent_to_subs_at) out.push({ key: 'sent', label: 'Sent to subs', who: la.sent_to_subs_by_name, when: la.sent_to_subs_at })
  return out
}
