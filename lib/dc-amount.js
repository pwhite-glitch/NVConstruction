// Direct-cost amount entry (returns as negative numbers).
//
// Storage rule: direct_costs.amount is always >= 0 and is_credit carries the sign. Every sum
// uses (is_credit ? -1 : 1) * amount, so a negative amount must never be stored.
// A user may type a return as a negative number (-250) or as a positive number with the
// "This is a return / credit" box ticked; both become { amount: 250, is_credit: true }.
//
// Pure: safe in client and server code.

import { isCreditCost } from './aia-draw'

// One credit test everywhere (same as lib/aia-draw.js): is_credit, or a legacy negative amount.
export { isCreditCost }

export const DC_AMOUNT_ERROR = 'Enter an amount (use a negative number for a return)'

// '−250' (unicode minus), '$1,200.50', ' -75 ', 12.345 → a number, or NaN.
export function parseDcAmount(value) {
  if (typeof value === 'number') return value
  if (value === null || value === undefined || typeof value !== 'string') return NaN
  const s = value.trim().replace(/[−‒–—]/g, '-').replace(/[$,\s]/g, '')
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN
  return Number(s)
}

// is_credit as sent by a form or API client: true / 'true' / '1' / 'on' → true;
// false / 'false' / '0' / '' / 'off' / anything else → false.
export function parseDcCredit(v) {
  if (v === true) return true
  if (typeof v === 'string') return ['true', '1', 'on'].includes(v.trim().toLowerCase())
  return false
}

// { amount, is_credit } → { amount: |x| rounded to cents, is_credit } or { error }.
export function normalizeDcAmount({ amount, is_credit } = {}) {
  const x = parseDcAmount(amount)
  if (!Number.isFinite(x)) return { error: DC_AMOUNT_ERROR }
  const cents = Math.round(Math.abs(x) * 100) / 100
  if (cents === 0) return { error: DC_AMOUNT_ERROR }
  if (x < 0) return { amount: cents, is_credit: true }
  return { amount: cents, is_credit: parseDcCredit(is_credit) }
}

// True when the typed value is a negative number (the form auto-ticks the return box).
export function isNegativeDcInput(value) {
  const x = parseDcAmount(value)
  return Number.isFinite(x) && x < 0
}

// Form state after the amount input changes. A negative auto-ticks the return box and
// remembers that it did (_autoCredit). When the minus goes away the box is unticked again
// only if it was auto-ticked; a box the user ticked themselves stays ticked.
export function dcAmountInputState(form, value) {
  const neg = isNegativeDcInput(value)
  if (neg) {
    const auto = form?.is_credit ? !!form?._autoCredit : true
    return { ...form, amount: value, is_credit: true, _autoCredit: auto }
  }
  if (form?._autoCredit) return { ...form, amount: value, is_credit: false, _autoCredit: false }
  return { ...form, amount: value }
}

// Form state after the user clicks the return box (a manual choice, never auto).
export function dcCreditInputState(form, checked) {
  return { ...form, is_credit: !!checked, _autoCredit: false }
}

// Hint under the amount input: "−$250.00 return", or '' when not a valid negative.
export function dcReturnHint(value) {
  const x = parseDcAmount(value)
  if (!Number.isFinite(x) || x >= 0) return ''
  const abs = Math.round(Math.abs(x) * 100) / 100
  if (!abs) return ''
  return `−$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} return`
}

// CSV import amount cell: '-120.50' → { amount: 120.5, is_credit: true }; 0 / blank / junk →
// { error: 'bad amount' }.
export function csvDcAmount(raw) {
  const r = normalizeDcAmount({ amount: raw == null ? '' : String(raw), is_credit: false })
  return r.error ? { error: 'bad amount' } : r
}

// Duplicate-flag key for the job's Direct Costs list: the amount AND its direction, so a
// $250 purchase and a $250 return are not flagged as duplicates of each other.
export function dcDuplicateKey(c) {
  return `${isCreditCost(c) ? 'credit' : 'debit'}|${Math.abs(Number(c?.amount) || 0).toFixed(2)}`
}

// Signed direct-cost amount: a credit (is_credit, or a legacy negative amount) subtracts.
export function signedDcAmount(c) {
  return (isCreditCost(c) ? -1 : 1) * Math.abs(Number(c?.amount) || 0)
}

// Owner-reimbursement invoice line amounts for one direct cost. A credit (return) line is
// negative, so it lowers the invoice total; markup applies to the signed amount.
// markupPct is a percent (10 = 10%). Rounded to cents symmetrically around zero.
export function ownerReimbLineAmounts(dc, markupPct = 0) {
  const expense_amount = signedDcAmount(dc)
  const pct = Number(markupPct) || 0
  const billed = Math.abs(expense_amount) * (1 + pct / 100)
  const billed_amount = Math.sign(expense_amount) * (Math.round(billed * 100) / 100) || 0
  return { expense_amount, markup_pct: pct, billed_amount }
}
