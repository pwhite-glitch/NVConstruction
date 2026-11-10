// Estimate proposal sections (prompt67d #10 / migration 065): exclusions, clarifications,
// proposal date / validity / revision, add / deduct alternates, and the export hash.
// Pure helpers, no imports: used by the estimates API routes, the export route, the PDF
// builder, convert-to-job and the Estimator workspace.

// estimates columns added by migration 065 that the workspace saves.
export const PROPOSAL_FIELDS = ['exclusions', 'clarifications', 'proposal_date', 'valid_days']
// Every 065 name (columns + tables), for "migration not applied yet" detection.
const NAMES_065 = [...PROPOSAL_FIELDS, 'revision', 'proposal_exported_at', 'proposal_export_hash', 'estimate_alternates', 'estimate_proposal_defaults']
export const DEFAULT_VALID_DAYS = 30
export const MAX_SECTION_CHARS = 8000
export const MIGRATION_065_WARNING = 'Saved, but exclusions, clarifications, proposal date / validity and alternates need database migration 065 before they can be stored.'

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// A read / write failed because something from migration 065 is not in the database yet.
export function isMissing065(error) {
  if (!error) return false
  const msg = String(error.message || '')
  const missing = ['42703', '42P01', 'PGRST204', 'PGRST205', 'PGRST200'].includes(error.code) ||
    /does not exist|could not find the .*(table|column|relation)|schema cache/i.test(msg)
  return missing && NAMES_065.some(n => msg.includes(n))
}

export const hasProposalFields = fields => PROPOSAL_FIELDS.some(k => fields && Object.prototype.hasOwnProperty.call(fields, k))
export const withoutProposalFields = fields => Object.fromEntries(Object.entries(fields || {}).filter(([k]) => !PROPOSAL_FIELDS.includes(k)))
// The loaded estimate row has the 065 columns (select '*').
export const has065Columns = est => !!est && Object.prototype.hasOwnProperty.call(est, 'revision')

// Validate / normalize the proposal fields present in `fields`. Returns { fields } or { error }.
export function validateProposalFields(fields) {
  const out = { ...(fields || {}) }
  for (const k of ['exclusions', 'clarifications']) {
    if (!(k in out)) continue
    const v = out[k]
    if (v === null || v === undefined) { out[k] = null; continue }
    if (typeof v !== 'string') return { error: `${k === 'exclusions' ? 'Exclusions' : 'Clarifications'} must be text.` }
    if (v.length > MAX_SECTION_CHARS) return { error: `${k === 'exclusions' ? 'Exclusions' : 'Clarifications'} are too long (max ${MAX_SECTION_CHARS} characters).` }
    out[k] = v.trim() ? v : null
  }
  if ('proposal_date' in out) {
    const v = out.proposal_date
    if (v === null || v === undefined || v === '') out.proposal_date = null
    else if (!isDate(v)) return { error: 'Proposal date must be YYYY-MM-DD.' }
  }
  if ('valid_days' in out) {
    const v = out.valid_days
    const n = v === null || v === undefined || v === '' ? NaN : Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 365) return { error: 'Valid (days) must be a whole number from 1 to 365.' }
    out.valid_days = n
  }
  return { fields: out }
}

// Validate an alternates array (replace-all). Returns { alternates } (rows without
// estimate_id) or { error }.
export function validateAlternates(list) {
  if (!Array.isArray(list)) return { error: 'alternates must be an array.' }
  if (list.length > 200) return { error: 'Too many alternates (max 200).' }
  const out = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {}
    const n = i + 1
    const description = typeof a.description === 'string' ? a.description.trim() : ''
    if (!description) return { error: `Alternate ${n}: description is required.` }
    if (description.length > 1000) return { error: `Alternate ${n}: description is too long.` }
    if (a.kind !== 'add' && a.kind !== 'deduct') return { error: `Alternate ${n}: choose Add or Deduct.` }
    const amount = a.amount === '' || a.amount === null || a.amount === undefined ? NaN : Number(a.amount)
    if (!Number.isFinite(amount) || amount < 0) return { error: `Alternate ${n}: amount must be 0 or more.` }
    if (amount >= 1e10) return { error: `Alternate ${n}: amount is too large.` }
    if (a.accepted !== undefined && typeof a.accepted !== 'boolean') return { error: `Alternate ${n}: accepted must be true or false.` }
    out.push({ description, kind: a.kind, amount: round2(amount), accepted: a.accepted === true, sort_order: i })
  }
  return { alternates: out }
}

// Signed price of an alternate: add +, deduct −.
export const signedAlternate = a => round2((a?.kind === 'deduct' ? -1 : 1) * Number(a?.amount || 0))
export const sortAlternates = list => [...(list || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

// Accepted alternates subtotal for the screen ("Accepted alternates: +$X / −$Y").
export function acceptedAlternateTotals(list) {
  let add = 0
  let deduct = 0
  for (const a of list || []) {
    if (!a?.accepted) continue
    const amt = Number(a.amount || 0)
    if (!Number.isFinite(amt)) continue
    if (a.kind === 'deduct') deduct += amt
    else add += amt
  }
  return { add: round2(add), deduct: round2(deduct), net: round2(add - deduct) }
}

// Non-blank lines of a one-item-per-line text field.
export const sectionItems = text => String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)

// 'YYYY-MM-DD' + n days.
export function addDaysIso(date, n) {
  if (!isDate(date)) return null
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + Number(n || 0))
  return d.toISOString().slice(0, 10)
}

export const validDaysOf = est => {
  const n = Number(est?.valid_days)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_VALID_DAYS
}

// ── Export hash ──────────────────────────────────────────────────────────────
// Everything that prints on the proposal except the date / revision themselves.
const HASH_FIELDS = ['estimate_number', 'project_name', 'project_type', 'address', 'owner_name', 'owner_company', 'owner_email', 'owner_phone', 'notes', 'markup_pct', 'markup_flat', 'taxable', 'tax_rate', 'exclusions', 'clarifications', 'valid_days']
const norm = v => (v === undefined || v === '' ? null : typeof v === 'number' ? Number(v) : v)
const numOrNull = v => (v === null || v === undefined || v === '' ? null : Number(v))

export function proposalContent(estimate, lines, alternates) {
  const est = estimate || {}
  return {
    f: HASH_FIELDS.map(k => [k, k === 'markup_pct' || k === 'markup_flat' || k === 'tax_rate' || k === 'valid_days' ? numOrNull(est[k]) : k === 'taxable' ? !!est[k] : norm(est[k])]),
    l: [...(lines || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(l => [norm(l.description), norm(l.scope), numOrNull(l.amount), numOrNull(l.markup_pct), numOrNull(l.markup_flat)]),
    a: sortAlternates(alternates).map(a => [norm(a.description), a.kind, numOrNull(a.amount), !!a.accepted]),
  }
}

// Stable 64-bit FNV-1a hash (two 32-bit halves) of the printed content, as hex.
export function proposalHash(estimate, lines, alternates) {
  const s = JSON.stringify(proposalContent(estimate, lines, alternates))
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ 0x9e3779b9
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// What an export does to the saved estimate. Returns the patch to write, or null for
// "no change" (same content as the last export).
//   first export (no hash yet): revision unchanged, proposal_date = today if empty
//   content changed since the last export: revision + 1, proposal_date = today
export function exportPatch(est, hash, today) {
  const last = est?.proposal_export_hash ?? null
  if (last && last === hash) return null
  const revision = Number(est?.revision || 0)
  if (!last) {
    return { revision, proposal_date: est?.proposal_date || today, proposal_export_hash: hash }
  }
  return { revision: revision + 1, proposal_date: today, proposal_export_hash: hash }
}

// Message for a failed /api/estimates/export call. 403 = role not allowed to export
// (estimates can be exported by principal, PM and APM only).
export const EXPORT_FORBIDDEN_MESSAGE = 'Not exported: only an Owner (principal), PM or APM can export estimate PDFs.'
export function exportErrorMessage(status, error) {
  if (status === 403) return EXPORT_FORBIDDEN_MESSAGE
  return error || `Export failed (${status})`
}
