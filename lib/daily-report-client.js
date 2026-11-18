// Browser-side daily report save / finalize / reopen (prompt 85). Every write goes through
// /api/daily-reports (no browser insert / update of daily_reports), so job assignment, the
// draft rules and "deliveries once" are enforced on the server.
// fetchFn = authFetch (adds the Supabase bearer token).

import { isReportDelivery } from './daily-report-payload'

async function send(fetchFn, url, method, body, failVerb = 'save') {
  let res
  try {
    res = await fetchFn(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data.error || `Could not ${failVerb} the daily report (server returned ${res.status}).`)
  return data
}

// Prompt 91: permanently delete a report (DELETE /api/daily-reports { id }). The server checks
// who may delete (canDeleteReport) and logs the full row to change history first.
// Throws with the API's error text when refused. → { id, deliveries_kept, files_removed, warning? }
export async function deleteDailyReport(fetchFn, id) {
  return send(fetchFn, '/api/daily-reports', 'DELETE', { id }, 'delete')
}

const reportDateLabel = d => {
  const s = d == null ? '' : String(d).slice(0, 10)
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : null
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : (s || 'this day')
}

// Confirm text for Delete (prompt 91). deliveryCount = deliveries logged by this report
// (reportDeliveryCount / countReportDeliveries); they are kept.
export function deleteReportConfirm(report, deliveryCount = 0) {
  let msg = `Delete the daily report for ${reportDateLabel(report?.report_date)}? This can't be undone. It will disappear from the job, the owner view and the weather-delay count.`
  const n = Number(deliveryCount) || 0
  if (n > 0) msg += ` This report logged ${n} material ${n === 1 ? 'delivery' : 'deliveries'}; they will be kept.`
  return msg
}

// How many deliveries this report logged (for the confirm). Reads the job's deliveries with the
// browser client; on any error → 0 (the confirm just omits the sentence).
export async function countReportDeliveries(supabase, report) {
  if (!supabase || !report?.job_id) return 0
  try {
    const { data, error } = await supabase.from('deliveries').select('*').eq('job_id', report.job_id)
    if (error || !Array.isArray(data)) return 0
    return data.filter(d => isReportDelivery(d, report)).length
  } catch { return 0 }
}

// Red Delete button (prompt 91) — 44px tap target.
export const DELETE_BUTTON = { minHeight: '44px', minWidth: '64px', padding: '0 14px', background: '#fff', color: '#dc2626', border: '1px solid #dc2626', borderRadius: '8px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }

// Save a report.
//   id missing → POST (new draft, or new final when finalize)
//   id set     → PATCH the draft, then (finalize) POST /finalize { id }
// → { report, warning? }
export async function saveDailyReport(fetchFn, { id = null, payload, finalize = false }) {
  if (!id) {
    const data = await send(fetchFn, '/api/daily-reports', 'POST', { ...payload, finalize: !!finalize })
    return { report: data.report, warning: data.warning }
  }
  const patched = await send(fetchFn, '/api/daily-reports', 'PATCH', { ...payload, id })
  if (!finalize) return { report: patched.report, warning: patched.warning }
  const data = await send(fetchFn, '/api/daily-reports/finalize', 'POST', { id })
  return { report: data.report, warning: data.warning }
}

export async function reopenDailyReport(fetchFn, id) {
  const data = await send(fetchFn, '/api/daily-reports/reopen', 'POST', { id })
  return data.report
}

export const FINALIZE_LABEL = 'Finalize – 100% complete'
// Peyton's decision 1: Owner / PM already see drafts (labeled Draft), so the confirm says
// what actually changes — it becomes the official report (owner portal, weather days).
export const FINALIZE_CONFIRM = "Finalize this report? It becomes the official report for Peyton, the office and the owner, and you won't be able to edit it unless an Owner, PM or Super reopens it."
export const REOPEN_CONFIRM = 'Reopen this finalized report as a draft? It will be hidden from the owner portal and weather-day counts until it is finalized again.'

// "Draft" label used everywhere a draft appears (Peyton's decision 1).
export const DRAFT_BADGE = { fontSize: '10px', fontWeight: '800', letterSpacing: '0.5px', color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', padding: '1px 6px', borderRadius: '4px', textTransform: 'uppercase' }

// "Revised Nov 16, 2026 by … (rev N)" label (prompt 86) — neutral, next to / instead of Draft.
export const REVISED_BADGE = { fontSize: '10px', fontWeight: '700', letterSpacing: '0.3px', color: '#1e3a8a', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px' }

// Earlier versions of a report (Owner / admin / PM). → { versions, total, limit, offset, has_more, migration_required? }
export async function fetchReportVersions(fetchFn, reportId, { limit = 20, offset = 0 } = {}) {
  const qs = new URLSearchParams({ report_id: String(reportId || ''), limit: String(limit), offset: String(offset) })
  let res
  try {
    res = await fetchFn(`/api/daily-reports/versions?${qs}`, { method: 'GET' })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !Array.isArray(data.versions)) throw new Error(data.error || `Could not load earlier versions (server returned ${res.status}).`)
  return data
}
