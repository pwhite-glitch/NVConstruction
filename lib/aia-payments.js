// Owner pay-app payments (money the client owner pays NV against an AIA
// G702 / draw application). Pure helpers, no imports from the server, so the
// job page, /api/aia-payments and the tests share one model.
//
// Each payment is one row in aia_payment_entries (migration 053 — written,
// NOT applied): { application_id, amount, received_on (YYYY-MM-DD),
// reference, voided_at }. The legacy columns on aia_applications are a
// SYNCED SUMMARY of the non-voided entries so every older reader (cash
// outlook, Cash Flow tab, badges, aia-lock) keeps working without double
// counting:
//   amount_received     = sum of live entries (null when there are none)
//   payment_received    = true when the live sum is > 0 (locks the app)
//   payment_received_at = latest live received_on (noon, so no day shift)

export const PAYMENT_RECORDER_ROLES = new Set(['principal', 'pm'])
export const canRecordAiaPayment = role => PAYMENT_RECORDER_ROLES.has(role)

export const MIGRATION_053_REQUIRED = 'Recording owner payments needs database migration 053 (aia_payment_entries). It has not been applied yet, so nothing was saved.'

export const AIA_PAYMENT_REFERENCE_MAX = 120

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const CENT = 0.005
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealDate(s) {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

// Strict money parser: positive, finite, at most 2 decimals, plain digits.
export function parseAiaPaymentAmount(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return { error: 'Amount must be more than $0.' }
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return { error: 'Amount can have at most 2 decimals.' }
    return { amount: r2(v) }
  }
  if (typeof v !== 'string') return { error: 'Amount is required.' }
  const s = v.trim().replace(/[$,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Amount must be a dollar amount like 1234.56.' }
  const n = Number(s)
  if (!(n > 0)) return { error: 'Amount must be more than $0.' }
  return { amount: r2(n) }
}

export const isLiveEntry = e => !!e && !e.voided_at

export function liveEntries(entries) {
  return (entries || []).filter(isLiveEntry)
}

// Summary columns for aia_applications from the entry list.
export function aiaPaymentSummary(entries) {
  const live = liveEntries(entries)
  const total = r2(live.reduce((s, e) => s + Number(e.amount || 0), 0))
  const latest = live.map(e => String(e.received_on || '').slice(0, 10)).filter(isRealDate).sort().pop() || null
  const received = total > CENT
  return {
    total,
    count: live.length,
    columns: {
      amount_received: received ? total : null,
      payment_received: received,
      payment_received_at: received && latest ? `${latest}T12:00:00.000Z` : null,
    },
  }
}

// One-time seed so an app paid before 053 keeps its recorded amount when the
// first entry is added (the migration backfills the same row). Null when no
// seed is needed or the legacy row has no usable amount.
export function legacySeedEntry(app, entries) {
  if (!app || (entries || []).length) return null
  const amt = Number(app.amount_received)
  if (!(amt > CENT)) return null
  const date = String(app.payment_received_at || '').slice(0, 10)
  return {
    application_id: app.id,
    job_id: app.job_id,
    amount: r2(amt),
    received_on: isRealDate(date) ? date : null,
    reference: 'Recorded before itemized payments',
    legacy: true,
  }
}

// Validate a POST body. Returns { row } or { error }.
export function validateAiaPaymentInput(body, today) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'JSON object body required' }
  if (typeof body.application_id !== 'string' || !body.application_id.trim()) return { error: 'application_id required' }
  const a = parseAiaPaymentAmount(body.amount)
  if (a.error) return { error: a.error }
  const date = body.received_on == null || body.received_on === '' ? today : body.received_on
  if (!isRealDate(date)) return { error: 'Date received must be a real date (YYYY-MM-DD).' }
  if (today && date > today) return { error: 'Date received cannot be in the future.' }
  let reference = body.reference == null ? '' : body.reference
  if (typeof reference !== 'string') return { error: 'Reference must be text (e.g. a check number).' }
  reference = reference.trim()
  if (reference.length > AIA_PAYMENT_REFERENCE_MAX) return { error: `Reference is limited to ${AIA_PAYMENT_REFERENCE_MAX} characters.` }
  return { row: { application_id: body.application_id.trim(), amount: a.amount, received_on: date, reference: reference || null } }
}

// Does `amount` differ from what is still due on the certificate?
export function aiaPaymentDiffers(amount, remaining) {
  if (remaining == null || !Number.isFinite(Number(remaining))) return false
  return Math.abs(Number(amount) - Number(remaining)) > CENT
}

export function aiaPaymentMismatchMessage(amount, remaining) {
  const f = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${f(amount)} does not match the ${f(remaining)} still due on this application (G702 current payment due less payments already recorded). Record it anyway?`
}
