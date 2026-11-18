// Daily reports filed from the job page (commercial + residential) — pure helpers.
// Shapes match the field app's insert (app/field/page.js submitDailyReport), which is
// the source of truth for the jsonb logs; the field app keeps its own copy for now.
//
//   crew_log               [{ name, company, trade, hours }]
//   equipment_log          [{ name, quantity, hours }]
//   materials_delivered    [{ description, quantity, supplier }]
//   visitors               [{ name, company, purpose }]
//   subcontractor_activity [{ subId?, company, trade, crew_count, work_performed }]
//   photos                 [{ path, caption?, name?, internal_only?: boolean,
//                             job_photo_id?: uuid, source?: 'job_photos' }]
//
// Uploaded report photos are jsonb only (no job_photos row). A photo picked from the job's
// existing photos (CompanyCam imports / gallery, prompt 85) is attached BY REFERENCE: the
// element reuses that job_photos row's storage_path and carries job_photo_id +
// source:'job_photos'. Unlinking it from a report must never delete the file or the row
// (see lib/report-photo-links.js). internal_only (prompt73) is passed through unchanged
// when it is a boolean; missing means owner-visible.
//
// Status (prompt 85, migration 075): 'draft' | 'final'. A draft is visible to its author
// and to PM / Owner / admin roles (DRAFT_VIEWER_ROLES), never to the owner portal, owner
// photos, weather-day counts or the weather-day log. A missing status (rows read before
// 075 is applied, old test fixtures) is treated as FINAL so nothing published disappears.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Photos must already be uploaded under this job's folder in daily-report-photos.
// A referenced job photo keeps job_photo_id (uuid) + source:'job_photos'.
export function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return []
  return photos.filter(p => p && typeof p === 'object').map(p => {
    const out = { path: str(p.path) }
    if (typeof p.caption === 'string') out.caption = p.caption
    if (typeof p.name === 'string') out.name = p.name
    if (typeof p.internal_only === 'boolean') out.internal_only = p.internal_only
    if (typeof p.job_photo_id === 'string' && UUID_RE.test(p.job_photo_id)) out.job_photo_id = p.job_photo_id
    if (p.source === 'job_photos' || out.job_photo_id) out.source = 'job_photos'
    return out
  })
}

// A report photo element that points at an existing job_photos file (not owned by the report).
export const isReferencedReportPhoto = p => !!p && typeof p === 'object' && (p.source === 'job_photos' || (typeof p.job_photo_id === 'string' && p.job_photo_id !== ''))

export function photoPathOk(jobId, path) {
  return typeof path === 'string' && path.startsWith(`${jobId}/`) && path.length > jobId.length + 1 && !path.includes('..')
}

// → { ok: true } | { ok: false, error }
// draft: true → work_performed may be blank (a draft is saved as-is); otherwise required.
export function validateDailyReportInput(body, { draft = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid request.' }
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : ''
  if (!jobId) return { ok: false, error: 'Project is required.' }
  if (!body.report_date) return { ok: false, error: 'Report date is required.' }
  if (!isValidDate(body.report_date)) return { ok: false, error: 'Report date must be a valid date (YYYY-MM-DD).' }
  if (!draft && (typeof body.work_performed !== 'string' || !body.work_performed.trim())) return { ok: false, error: 'Work performed is required.' }
  if (body.work_performed != null && typeof body.work_performed !== 'string') return { ok: false, error: 'Work performed must be text.' }
  if (body.photos != null && !Array.isArray(body.photos)) return { ok: false, error: 'Photos must be a list.' }
  for (const p of cleanPhotos(body.photos)) {
    if (!photoPathOk(jobId, p.path)) return { ok: false, error: 'A photo is not stored under this project.' }
  }
  return { ok: true }
}

// Row for daily_reports insert. super_id is always the signed-in caller (never the body).
// draft: true → work_performed may be '' (stored as ''). Status columns are added by the
// route (draftStatusFields / finalStatusFields), not here.
export function buildDailyReportRow({ authUserId, body, draft = false }) {
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
    work_performed: typeof body.work_performed === 'string' ? body.work_performed : (draft ? '' : body.work_performed),
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

// Editable fields of a draft (PATCH): the insert row without job_id / super_id.
export function buildDraftPatch(body) {
  const { job_id, super_id, ...rest } = buildDailyReportRow({ authUserId: null, body, draft: true })
  return rest
}

// PATCH is a partial update: the body is laid over the stored row, so an omitted field keeps
// its stored value (it is validated together with the stored values). job_id always comes
// from the stored row.
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined
export function mergeDraftBody(report = {}, body = {}) {
  const out = { ...(report || {}) }
  for (const [k, v] of Object.entries(body || {})) if (v !== undefined) out[k] = v
  out.job_id = report?.job_id
  if (!has(body, 'report_date')) out.report_date = report?.report_date
  return out
}
// Keep only the columns the body actually sent (so a concurrent change to another field —
// e.g. a photo's internal_only flipped elsewhere — is not overwritten by a stale copy).
export function pickDraftPatch(patch, body) {
  return Object.fromEntries(Object.entries(patch || {}).filter(([k]) => has(body, k)))
}

// ── Status (prompt 85) ──────────────────────────────────────────────────────
// Missing / null status = final (pre-075 rows, fixtures). Only the exact 'draft' is a draft.
export const isDraftReport = r => !!r && r.status === 'draft'
export const isFinalReport = r => !!r && r.status !== 'draft'
export const publishedReports = (rows = []) => (Array.isArray(rows) ? rows.filter(isFinalReport) : [])

// Roles that may see (and edit / finalize) everyone's drafts on a job they can open:
// Owner (principal), admin, PM. APM / super see only their own drafts. Owner-portal clients
// and subs never see drafts.
export const DRAFT_VIEWER_ROLES = new Set(['principal', 'admin', 'pm'])
export const canSeeAllDrafts = role => DRAFT_VIEWER_ROLES.has(role)
// Reopening a final report (prompt 89): Owner / admin / PM, plus Super. APM still cannot.
// Supers are NOT draft viewers — a super may reopen only a final they wrote (see
// canReopenFinalReport; the reopen route enforces it). Job access is checked by the route.
export const canReopenReport = role => DRAFT_VIEWER_ROLES.has(role) || role === 'super'
// This caller may reopen this specific final: a draft-viewer role, or a super who wrote it.
export const canReopenFinalReport = ({ role, userId } = {}, report) =>
  !!report && isFinalReport(report) && canReopenReport(role) &&
  (canSeeAllDrafts(role) || (!!userId && report.super_id === userId))
// Edit / finalize a draft: its author, or a draft-viewer role (job access checked by the route).
export const canEditDraft = ({ role, userId } = {}, report) =>
  !!report && isDraftReport(report) && ((!!userId && report.super_id === userId) || canSeeAllDrafts(role))

// Delete a report, draft or final (prompt 91 — hard delete, logged; Peyton 11/18):
//   principal / admin / pm / apm → any report (job access is checked by the route:
//   principal / admin any job, pm / apm only jobs they are on);
//   super → only a report they wrote (super_id), on a job they are on;
//   everyone else (sub, owner client, sales, …) → never.
export const DELETE_ANY_REPORT_ROLES = new Set(['principal', 'admin', 'pm', 'apm'])
export const canDeleteReport = ({ role, userId } = {}, report) =>
  !!report && (DELETE_ANY_REPORT_ROLES.has(role) || (role === 'super' && !!userId && report.super_id === userId))

// A delivery that belongs to this report (same rule as lib/daily-report-server.js
// existingReportDeliveries): tagged daily_report_id = report.id (075), or a legacy row with
// no daily_report_id, source 'daily_report', same job, received_date = report_date.
export const isReportDelivery = (d, report) => !!d && !!report && (
  (d.daily_report_id != null && d.daily_report_id === report.id) ||
  (d.daily_report_id == null && d.source === 'daily_report' && d.job_id === report.job_id && d.received_date === report.report_date)
)
export const reportDeliveryCount = (report, deliveries = []) =>
  (Array.isArray(deliveries) ? deliveries : []).filter(d => isReportDelivery(d, report)).length

// change_log entry written by DELETE /api/daily-reports (prompt 91): old_value is the whole
// deleted row as JSON. The history views show a short summary instead of the raw JSON.
export const isDeletedReportLogEntry = e => !!e && e.entity_type === 'daily_report' && e.field_name === 'deleted'
export function deletedReportSnapshot(e) {
  if (!isDeletedReportLogEntry(e) || typeof e.old_value !== 'string') return null
  try { const o = JSON.parse(e.old_value); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null }
}

// Staff list: finals, plus drafts the caller may see (own; or all for Owner / admin / PM).
export function visibleReports(rows = [], { role, userId } = {}) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && (isFinalReport(r) || canSeeAllDrafts(role) || (!!userId && r.super_id === userId)))
}

export const draftStatusFields = () => ({ status: 'draft', finalized_at: null, finalized_by: null })
export const finalStatusFields = (userId, now = new Date()) => ({ status: 'final', finalized_at: now.toISOString(), finalized_by: userId || null })

// Body asks to publish now: { finalize: true } or { status: 'final' }.
export const wantsFinalize = body => !!body && (body.finalize === true || body.status === 'final')

// Before migration 075 the status columns do not exist.
export const MIGRATION_075_MESSAGE = 'Saving a daily report as a draft needs database migration 075 (daily report drafts). Ask Peyton to apply it — nothing was saved. You can still finalize the report now.'
export const STATUS_COLS = ['status', 'finalized_at', 'finalized_by', 'reopened_at', 'reopened_by', 'deliveries_created_at', 'updated_at']

// ── Revision history (prompt 86, migration 076) ─────────────────────────────
// 076 adds first_finalized_at / first_finalized_by / revision_count / revised_by_name and a
// trigger that snapshots a final report into daily_report_versions on reopen — all in one
// transaction, so a row (select('*')) carrying revision_count means the trigger exists too.
// The trigger owns those four columns; no route writes them and buildDailyReportRow /
// buildDraftPatch never pass them through from a client body.
export const has076 = report => !!report && Object.prototype.hasOwnProperty.call(report, 'revision_count')

// The editable content of a report (what a reopened report's edits are logged for).
export const REVISION_FIELDS = [
  'report_date', 'weather', 'weather_temp', 'weather_delay', 'crew_count', 'work_performed', 'issues',
  'safety_observations', 'toolbox_talk', 'crew_log', 'equipment_log', 'materials_delivered', 'visitors',
  'subcontractor_activity', 'photos',
]
const REVISION_VALUE_MAX = 4000
const revisionValue = v => {
  if (v == null) return null
  const s = typeof v === 'object' ? JSON.stringify(v) : v
  return typeof s === 'string' && s.length > REVISION_VALUE_MAX ? `${s.slice(0, REVISION_VALUE_MAX)}…` : s
}
// Comparison key only (never stored): object keys sorted recursively, because Postgres jsonb
// reorders keys (shorter first) while the patch builders emit them in another order; array
// order still counts. Scalars compared as strings, so a numeric column's 72 equals "72".
const sortKeys = (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]]))
  : x)
const comparable = v => {
  if (v == null) return null
  return typeof v === 'object' ? JSON.stringify(v, sortKeys) : String(v)
}
// → [{ field, old_value, new_value }] for keys of patch in REVISION_FIELDS whose value changed.
export function changedFields(before = {}, patch = {}) {
  const b = before || {}
  return REVISION_FIELDS
    .filter(k => patch && Object.prototype.hasOwnProperty.call(patch, k))
    .filter(k => comparable(b[k]) !== comparable(patch[k]))
    .map(k => ({ field: k, old_value: revisionValue(b[k]), new_value: revisionValue(patch[k]) }))
}

const centralDate = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })
}
// 'Revised Nov 16, 2026 by Pat PM (rev 1)' — null until the report has been re-finalized.
// While a revised report is reopened (a draft: finalized_at is NULL, and the date lives only
// in daily_report_versions, which the lists don't load) → 'Revised (rev 1), being edited'.
export function revisionLabel(report) {
  const n = Number(report?.revision_count)
  if (!(n > 0)) return null
  if (!report.finalized_at) return `Revised (rev ${n}), being edited`
  const date = centralDate(report.finalized_at)
  const name = typeof report.revised_by_name === 'string' ? report.revised_by_name.trim() : ''
  return `Revised${date ? ` ${date}` : ''}${name ? ` by ${name}` : ''} (rev ${n})`
}

// Earlier versions are office-only: Owner (principal) / admin / PM, same set as reopen.
export const canViewReportVersions = role => DRAFT_VIEWER_ROLES.has(role)

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
// Callers pass FINAL report dates only (finalReportDates) — a draft on that date is not a
// duplicate; it is the report being worked on.
export const finalReportDates = (rows = [], { excludeId } = {}) => publishedReports(rows).filter(r => r.id !== excludeId).map(r => r.report_date)
export function duplicateReportMessage(reportDate, existingDates) {
  if (!reportDate || !Array.isArray(existingDates) || !existingDates.includes(reportDate)) return null
  return `A daily report already exists for ${reportDate} on this job. Submit another anyway?`
}

// Storage helpers (same naming as the field app).
export const uniquePhotoName = (ts, i) => `${ts}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`
export const thumbPath = path => path?.replace(/\.jpg$/i, '_thumb.jpg') ?? null
