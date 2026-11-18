// Server-side daily report helpers (prompt 85). Pass the service-role client as `db`.
// Pure of Next.js; API routes call these after requirePM + denyUnlessOnJob.

import { buildDeliveriesFromMaterials, isDraftReport, canSeeAllDrafts, canDeleteReport } from './daily-report-payload'
import { isMissingColumnError, writeWithMissingColumnRetry } from './missing-column-retry'

// Prompt 91: who may delete a report — pure role logic lives in daily-report-payload so the
// field app / job pages show the Delete button to the same people the API allows.
export { canDeleteReport }
export const DELETE_AUTHOR_MESSAGE = "Only the report's author or the office can delete it."

// Before a hard delete (prompt 91): detach the report's deliveries — they are KEPT, only
// daily_report_id is cleared (no FK). Legacy deliveries (daily_report_id NULL, matched by
// received_date) are untouched. Before 075 the column does not exist → nothing is linked.
// → { unlinked: number, error? }
export async function unlinkReportDeliveries(db, report) {
  const { data, error } = await db.from('deliveries').update({ daily_report_id: null }).eq('daily_report_id', report.id).select('id')
  if (error) return isMissingColumnError(error) ? { unlinked: 0 } : { unlinked: 0, error }
  return { unlinked: Array.isArray(data) ? data.length : 0 }
}

export const FINALIZED_MESSAGE = 'This report is finalized and cannot be edited.'
export const NOT_AUTHOR_MESSAGE = 'Only the person who wrote this draft, or an Owner, admin or PM, can change it.'
export const REOPEN_ROLE_MESSAGE = 'Only an Owner, admin, PM or Super can reopen a finalized report.'
export const REOPEN_AUTHOR_MESSAGE = "Only the report's author or the office can reopen it."

// Author of the report, or Owner / admin / PM (job access is checked separately).
export const mayManageReport = (auth, report) =>
  !!report && ((!!auth?.userId && report.super_id === auth.userId) || canSeeAllDrafts(auth?.role))

// → { report } | { response }
export async function loadReport(db, id) {
  if (typeof id !== 'string' || !id.trim()) return { response: Response.json({ error: 'Report id is required.' }, { status: 400 }) }
  const { data, error } = await db.from('daily_reports').select('*').eq('id', id.trim()).maybeSingle()
  if (error) return { response: Response.json({ error: error.message }, { status: 500 }) }
  if (!data) return { response: Response.json({ error: 'Daily report not found.' }, { status: 404 }) }
  return { report: data }
}

export const REOPEN_MIGRATION_MESSAGE = 'Reopening a finalized report needs database migration 075 (daily report drafts). Ask Peyton to apply it — nothing was changed.'
export const REOPEN_076_MESSAGE = 'Reopening a finalized report now keeps its earlier version, which needs database migration 076 (daily report versions). Ask Peyton to apply it — nothing was changed.'

// Identity of a delivery line for de-duplication: material | vendor | quantity (trimmed, case-insensitive).
const norm = v => (v == null ? '' : String(v).trim().toLowerCase())
export const deliveryKey = d => [norm(d?.material), norm(d?.vendor), norm(d?.quantity)].join('|')

// Deliveries that already belong to this report:
//   • rows tagged daily_report_id = report.id (written by this code once 075 is applied), and
//   • legacy rows (no daily_report_id) that the old field insert / old office POST made for it:
//     same job, source 'daily_report', received_date = report_date.
// select('*') so a missing daily_report_id column (before 075) is simply absent.
// → { rows, error }
export async function existingReportDeliveries(db, report) {
  const { data, error } = await db.from('deliveries').select('*').eq('job_id', report.job_id).eq('source', 'daily_report')
  if (error) return { rows: [], error }
  const rows = (data || []).filter(d => d && (
    (d.daily_report_id != null && d.daily_report_id === report.id) ||
    (d.daily_report_id == null && d.received_date === report.report_date)
  ))
  return { rows, error: null }
}

// Wanted lines minus lines already present (multiset: two identical materials need two rows).
export function missingDeliveries(wanted = [], existing = []) {
  const have = new Map()
  for (const d of existing) have.set(deliveryKey(d), (have.get(deliveryKey(d)) || 0) + 1)
  return wanted.filter(d => {
    const k = deliveryKey(d)
    const n = have.get(k) || 0
    if (n > 0) { have.set(k, n - 1); return false }
    return true
  })
}

// Turn a FINAL report's materials into received deliveries, never twice.
//   • First finalize (deliveries_created_at IS NULL): claim the report (IS NULL → now) so two
//     racing calls cannot both insert; the loser inserts nothing.
//   • Every finalize — first, or after a reopen (prompt 85 L7) — inserts ONLY the materials that
//     do not already have a delivery for this report (existingReportDeliveries). That covers a
//     report written by pre-075 code after 075 was applied (old code already inserted its
//     deliveries but left the marker NULL — M1) and materials added while a report was reopened.
//   • New rows carry daily_report_id (075); before 075 the column is dropped and the insert
//     behaves like today's path.
// If the existing deliveries cannot be read, nothing is inserted (no duplicates) and a warning is returned.
// → { inserted: number, warning? }
export async function createDeliveriesOnce(db, report, userId, now = new Date()) {
  if (!report || isDraftReport(report)) return { inserted: 0 }
  const wanted = buildDeliveriesFromMaterials(report.job_id, report.super_id || userId, report.report_date, report.materials_delivered)
    .map(d => ({ ...d, daily_report_id: report.id }))
  if (!wanted.length) return { inserted: 0 }
  const fail = msg => ({ inserted: 0, warning: `Report saved, but the delivered materials were not added to Deliveries: ${msg}` })

  const stamp = now.toISOString()
  let claimed = false
  if (!report.deliveries_created_at) {
    const claim = await db.from('daily_reports').update({ deliveries_created_at: stamp }).eq('id', report.id).is('deliveries_created_at', null).select('id')
    if (claim.error) {
      if (!isMissingColumnError(claim.error)) return fail(claim.error.message)
      // pre-075: no marker column; the existing-deliveries check below still prevents duplicates
    } else if (!claim.data || claim.data.length === 0) {
      return { inserted: 0 } // someone else is creating them right now
    } else {
      claimed = true
    }
  }
  const release = async () => { if (claimed) await db.from('daily_reports').update({ deliveries_created_at: null }).eq('id', report.id) }

  const existing = await existingReportDeliveries(db, report)
  if (existing.error) { await release(); return fail(existing.error.message) }
  const toInsert = missingDeliveries(wanted, existing.rows)
  if (!toInsert.length) return { inserted: 0 }

  const { error } = await writeWithMissingColumnRetry(rows => db.from('deliveries').insert(rows), toInsert, { fallbackCols: ['daily_report_id'] })
  if (error) { await release(); return fail(error.message) }
  return { inserted: toInsert.length }
}
