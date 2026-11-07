// Shared estimate math. Every estimate total in the app (Estimator list,
// dashboard pipeline/cards/edit previews, EstimateWorkspace, the proposal PDF,
// estimate -> job conversion/link) must come from estimateBreakdown().
//
// Sales tax rate representation: estimates.tax_rate is stored in PERCENTAGE
// POINTS (8.25 = 8.25%, 9.125 = 9.125%, 9 = 9%). It is converted to a fraction
// exactly once, here. Missing/null/blank (legacy rows, or before migration
// 048_estimate_tax_rate.sql is applied) means the default 8.25. An explicit 0
// is a real 0% rate and never falls back to the default.
//
// Math (approved, unchanged): markup applies to raw line cost (per-line
// markup_pct overrides the estimate's global %, explicit 0 included; per-line
// markup_flat is added on top; the estimate's global markup_flat is added to
// the total). Sales tax = raw cost x rate / 100 when taxable, added after
// markup and NOT itself marked up.

export const DEFAULT_TAX_RATE = 8.25
export const MAX_TAX_RATE = 20

const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// Validates a user/client-supplied rate (percentage points).
// Returns { value } (a finite number in [0, MAX_TAX_RATE]) or { error }.
// Blank is NOT coerced to 0: it is rejected so the caller must send a number.
export function validateTaxRate(v) {
  if (isBlank(v)) return { error: 'Sales tax rate is required (e.g. 8.25).' }
  if (typeof v !== 'number' && typeof v !== 'string') return { error: 'Sales tax rate must be a number.' }
  const s = typeof v === 'string' ? v.trim().replace(/%$/, '').trim() : v
  if (typeof s === 'string' && !/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) {
    return { error: 'Sales tax rate must be a number from 0 to 20 (percent).' }
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return { error: 'Sales tax rate must be a finite number.' }
  if (n < 0) return { error: 'Sales tax rate cannot be negative.' }
  if (n > MAX_TAX_RATE) return { error: `Sales tax rate must be ${MAX_TAX_RATE}% or less (enter percent, e.g. 9.125).` }
  // Keep at most 4 decimal places (matches numeric(6,4) in the migration).
  return { value: Math.round(n * 10000) / 10000 }
}

// Value to put in a save payload from a form field. A field that was never
// set (null/undefined: legacy row, or column not yet migrated) means the
// default 8.25. A user-entered value is converted to a number if valid;
// anything invalid (including a cleared field '') is passed through
// unchanged so validateTaxRate() rejects it instead of coercing it to 0.
export function normalizeTaxRateInput(v) {
  if (v === null || v === undefined) return DEFAULT_TAX_RATE
  const r = validateTaxRate(v)
  return r.error ? v : r.value
}

// Until migrations/048_estimate_tax_rate.sql is applied the column does not
// exist. Callers may then retry WITHOUT tax_rate only when the rate equals
// the default (nothing is lost: math treats a missing rate as 8.25); a
// non-default rate must fail clearly instead of silently being dropped.
export const TAX_RATE_MIGRATION_MSG =
  'A non-default sales tax rate cannot be saved until database migration 048_estimate_tax_rate.sql is applied. Use 8.25% for now or ask an admin to apply the migration.'

export function isMissingTaxRateColumn(error) {
  const msg = String(error?.message || '')
  return /tax_rate/.test(msg) && (error?.code === '42703' || error?.code === 'PGRST204' || /does not exist|could not find|schema cache/i.test(msg))
}

// The effective rate (percentage points) used in math for a stored estimate.
// Legacy null/blank -> 8.25. A stored invalid value (should be impossible with
// the DB check) also falls back to the default rather than producing NaN.
export function effectiveTaxRate(est) {
  const v = est?.tax_rate
  if (isBlank(v)) return DEFAULT_TAX_RATE
  const r = validateTaxRate(v)
  return r.error ? DEFAULT_TAX_RATE : r.value
}

// "9.125", "9", "8.25" — never rounded to 2 places.
export function formatTaxRate(rate) {
  const n = Number(rate)
  if (!Number.isFinite(n)) return String(DEFAULT_TAX_RATE)
  return String(Math.round(n * 10000) / 10000)
}

// Accepts an estimate (uses its tax_rate) or a breakdown (uses .taxRate).
export function taxLabel(estOrBreakdown) {
  const rate = typeof estOrBreakdown?.taxRate === 'number' ? estOrBreakdown.taxRate : effectiveTaxRate(estOrBreakdown)
  return `Sales tax on raw cost (${formatTaxRate(rate)}%, not marked up)`
}

export function lineCost(line) {
  return isBlank(line?.amount) ? 0 : num(line.amount)
}

// Line price with markup: per-line % (explicit 0 kept) overrides global %.
export function linePrice(line, globalPct) {
  const pct  = isBlank(line?.markup_pct)  ? num(globalPct) : num(line.markup_pct)
  const flat = isBlank(line?.markup_flat) ? 0 : num(line.markup_flat)
  return lineCost(line) * (1 + pct / 100) + flat
}

// Full breakdown. `lines` defaults to est.estimate_line_items.
export function estimateBreakdown(est, lines) {
  const ls = lines || est?.estimate_line_items || []
  const globalPct = num(est?.markup_pct)
  const globalFlat = isBlank(est?.markup_flat) ? 0 : num(est.markup_flat)
  const raw = ls.reduce((a, l) => a + lineCost(l), 0)
  const linesPriced = ls.reduce((a, l) => a + linePrice(l, globalPct), 0)
  const subtotal = linesPriced + globalFlat // price before tax
  const taxRate = effectiveTaxRate(est)
  const taxable = !!est?.taxable
  const tax = taxable ? raw * taxRate / 100 : 0
  return {
    raw,
    linesPriced,
    globalFlat,
    markup: subtotal - raw,
    subtotal,
    taxable,
    taxRate,
    tax,
    total: subtotal + tax,
  }
}

/**
 * Total for an estimate (unrounded; format for display).
 */
export function calcTotal(est) {
  return estimateBreakdown(est).total
}

export function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}
