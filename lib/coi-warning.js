// Commercial COI warning (badge + confirm before approve / ready to pay / record payment).
// Client-side warning only: no server check, no hard block. Reuses coiState / fmtCoiDate.
import { coiState, fmtCoiDate, isCoiDate } from './coi-status'
import { sameCompany } from './company-name'
import { todayCentral } from './central-date'

// COI quality rank for a directory row (lower is better):
// 0 = file + expiration today or later (Central), 1 = file + no expiration date,
// 2 = file + expired, 3 = no file.
function coiRank(d, today) {
  if (!d.coi_url) return 3
  const exp = d.coi_expiration ? String(d.coi_expiration).slice(0, 10) : ''
  if (!isCoiDate(exp)) return 1
  return exp >= today ? 0 : 2
}
const coiExp = d => (d.coi_url && d.coi_expiration ? String(d.coi_expiration).slice(0, 10) : '')

// Best row in a group: lowest rank, then latest expiration; ties keep list order (deterministic).
function bestCoiRow(rows, today) {
  let best = null
  for (const d of rows) {
    if (!best) { best = d; continue }
    const r = coiRank(d, today), br = coiRank(best, today)
    if (r < br || (r === br && (r === 0 || r === 2) && coiExp(d) > coiExp(best))) best = d
  }
  return best
}

// Directory row for a company name (sameCompany match). Prefers status 'approved'
// rows, else the remaining rows; within the group picks the best COI (valid latest,
// then file with no date, then expired latest, then no file). Blank name or no match → null.
export function findDirectoryEntry(directory = [], companyName, now = new Date()) {
  if (!String(companyName || '').trim() || !Array.isArray(directory)) return null
  const matches = directory.filter(d => d && sameCompany(companyName, d.company_name))
  if (!matches.length) return null
  const approved = matches.filter(d => d.status === 'approved')
  return bestCoiRow(approved.length ? approved : matches, todayCentral(now))
}

const COLORS = {
  red: { color: '#c92a2a', bg: '#fff5f5', border: '#ffc9c9' },
  amber: { color: '#b45309', bg: '#fff7ed', border: '#fed7aa' },
  green: { color: '#2b8a3e', bg: '#ebfbee', border: '#b2f2bb' },
}

// { state, label, tone, color, bg, border } — null entry (no directory match) = missing.
export function coiBadgeModel(entry, now = new Date()) {
  const state = coiState(entry, now)
  const exp = fmtCoiDate(entry?.coi_expiration)
  let label, tone
  if (state === 'missing') { label = 'COI missing'; tone = 'red' }
  else if (state === 'expired') { label = `COI expired ${exp}`; tone = 'red' }
  else if (state === 'expiring') { label = `COI expiring ${exp}`; tone = 'amber' }
  else if (state === 'no_date') { label = 'COI on file · no expiration date'; tone = 'amber' }
  else { label = `COI to ${exp}`; tone = 'green' }
  return { state, label, tone, ...COLORS[tone] }
}

// Confirm only for missing / expired (not expiring / no_date).
export const coiActionNeedsConfirm = (entry, now = new Date()) => ['missing', 'expired'].includes(coiState(entry, now))

const ACTION_TEXT = { approve: 'Approve anyway?', ready: 'Mark ready to pay anyway?', pay: 'Record payment anyway?' }

// Confirm text, or null when no confirm is needed.
export function coiConfirmMessage(entry, { action = 'approve', company = '' } = {}, now = new Date()) {
  if (!coiActionNeedsConfirm(entry, now)) return null
  const who = String(company || entry?.company_name || 'this company').trim()
  const ask = ACTION_TEXT[action] || ACTION_TEXT.approve
  return coiState(entry, now) === 'expired'
    ? `COI expired ${fmtCoiDate(entry.coi_expiration)} for ${who}. ${ask}`
    : `COI missing for ${who}. ${ask}`
}

// true = go ahead (no warning needed, or user clicked OK); false = cancelled.
export function confirmCoiOrProceed(entry, opts = {}, confirmFn, now = new Date()) {
  const msg = coiConfirmMessage(entry, opts, now)
  if (!msg) return true
  const fn = confirmFn || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true)
  return !!fn(msg)
}

// Directory-aware wrappers. `directory` null/undefined = not loaded yet or the load failed:
// no badge and no confirm (warning-only feature fails open, never blocks).
export function coiBadgeForCompany(directory, companyName, now = new Date()) {
  if (!Array.isArray(directory) || !String(companyName || '').trim()) return null
  return coiBadgeModel(findDirectoryEntry(directory, companyName, now), now)
}

export function confirmCoiForCompany(directory, companyName, action, confirmFn, now = new Date()) {
  const company = String(companyName || '').trim()
  if (!Array.isArray(directory) || !company) return true
  return confirmCoiOrProceed(findDirectoryEntry(directory, company, now), { action, company }, confirmFn, now)
}
