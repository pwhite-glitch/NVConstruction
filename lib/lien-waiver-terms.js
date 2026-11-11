// What a signed conditional lien waiver covered (prompt 67B #6). Pure — client and server.
// Migration 062 adds billing_submissions.lien_waiver_amount / lien_waiver_through (the terms
// the sub signed) and lien_waiver_history (signatures voided by a later edit). Rows signed
// before 062 have NULL terms ("legacy"): printouts fall back to the live billing and say so.
import { billingFinancialChanges } from './billing-fields'

export const NEW_062_COLS = ['lien_waiver_amount', 'lien_waiver_through', 'lien_waiver_history']

export function without062(row) {
  return Object.fromEntries(Object.entries(row || {}).filter(([k]) => !NEW_062_COLS.includes(k)))
}

// A read or write that failed because a column is not there yet (migration not applied).
export function isMissingColumnError(e) {
  if (!e) return false
  if (e.code === '42703' || e.code === 'PGRST204') return true
  return /schema cache|column .* does not exist|could not find the .* column/i.test(e.message || '')
}

// True when the error names one of the 062 columns.
export function mentions062(e) {
  const m = e?.message || ''
  return NEW_062_COLS.some(c => m.includes(c))
}

export const LEGACY_WAIVER_NOTE = 'Amount as of printing; this waiver was signed before the portal recorded signed amounts.'

export function signedWaiverTerms(b) {
  const signedDate = b?.lien_waiver_signed_at ? String(b.lien_waiver_signed_at).slice(0, 10) : null
  return {
    amount: b?.lien_waiver_amount ?? b?.amount_billed ?? null,
    through: b?.lien_waiver_through ?? b?.billing_period ?? signedDate,
    legacy: b?.lien_waiver_amount === null || b?.lien_waiver_amount === undefined,
  }
}

// Fields whose change voids a signed waiver.
export const WAIVER_TERM_FIELDS = ['amount_billed', 'retainage_pct', 'retainage_held', 'billing_period']
const REASON = { amount_billed: 'amount_changed', retainage_pct: 'retainage_changed', retainage_held: 'retainage_changed', billing_period: 'period_changed' }

// Waiver-term fields in `fields` that really change `current` (same value re-sent = no change).
export function waiverTermChanges(current, fields = {}) {
  return billingFinancialChanges(current, fields).filter(k => WAIVER_TERM_FIELDS.includes(k))
}
export const voidReason = changed => REASON[(changed || [])[0]] || 'amount_changed'

// Signature image allowed in the job page / sub portal printouts: inline image data URL only.
export function safeSignatureSrc(src) {
  const s = String(src || '').trim()
  return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s) ? s : ''
}

// The drawn signature is a tiny canvas image sent inline (not a file upload). The signing API
// accepts only that shape, up to this size (prompt 78); anything else is refused, not stored.
export const MAX_SIGNATURE_DATA_URL = 256 * 1024
// null when acceptable (absent, or a small supported image data URL), else { status, error }.
export function signatureDataUrlError(sig) {
  if (sig === undefined || sig === null || sig === '') return null
  if (typeof sig !== 'string') return { status: 400, error: 'The signature must be a drawn image.' }
  if (sig.length > MAX_SIGNATURE_DATA_URL) return { status: 413, error: 'The drawn signature is too large. Clear it and sign again with a simpler signature.' }
  if (!safeSignatureSrc(sig)) return { status: 400, error: 'The signature must be a PNG, JPEG, GIF or WebP drawing.' }
  return null
}

// 'YYYY-MM-DD' (or a timestamp) → "March 2026"
export function throughLabel(d) {
  if (!d) return '—'
  const s = String(d)
  const day = s.length === 10 ? new Date(s + 'T12:00:00Z') : new Date(s)
  if (Number.isNaN(day.getTime())) return '—'
  return day.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'America/Chicago' })
}
