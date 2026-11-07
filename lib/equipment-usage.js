import { activityEnd } from './lookahead-dates'

// Open lookahead activities that reference a company_equipment id: not 'done'
// (null/legacy status counts as open) and either ending today or later
// (multi-day work uses end_date), undated, or still in progress / delayed
// (unfinished work that hasn't been closed out, whatever its old date).
// Returns { count, jobIds } or { error } (callers must fail closed on error).
const OPEN_ANY_DATE = ['in_progress', 'delayed']

export async function equipmentInUse(db, equipmentId, today, pageSize = 1000) {
  const hits = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('lookahead_activities')
      .select('id, planned_date, end_date, status, company_equipment_ids, lookaheads(job_id)')
      .or(`planned_date.gte.${today},end_date.gte.${today},planned_date.is.null,status.in.(${OPEN_ANY_DATE.join(',')})`)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) return { error: error.message || 'lookup failed' }
    for (const a of data || []) {
      if (!isOpenUse(a, equipmentId, today)) continue
      hits.push(a)
    }
    if (!data || data.length < pageSize) break
  }
  const jobIds = [...new Set(hits.map(a => a.lookaheads?.job_id).filter(Boolean))]
  return { count: hits.length, jobIds }
}

export function isOpenUse(act, equipmentId, today) {
  const ids = Array.isArray(act?.company_equipment_ids) ? act.company_equipment_ids : []
  if (!ids.includes(equipmentId)) return false
  if (act.status === 'done') return false
  if (OPEN_ANY_DATE.includes(act.status)) return true
  if (!act.planned_date) return true // no date: treat as open rather than guess
  return activityEnd(act) >= today
}

// Display name for an equipment id from the full (active + retired) list.
export function equipmentLabel(list, id) {
  const eq = (list || []).find(e => e.id === id)
  if (!eq) return ''
  return eq.active === false ? `${eq.name} (Retired)` : eq.name
}
