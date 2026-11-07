// Sub billing payment model (one place for the money math).
//
//   net due    = amount_billed − retainage_held
//   paid       = payment_amount, which is CUMULATIVE paid-to-date (not "this check")
//   remaining  = net due − paid
//
// paid_at is the SETTLEMENT marker, not a per-payment timestamp: it is stamped only when
// paid-to-date reaches the full net due. A short check records payment_amount and leaves
// paid_at NULL, so the billing stays on Unpaid lists and in the cash outlook (which already
// subtracts payment_amount from net — see lib/cash-outlook.js billingItems).
//
// Legacy rows: paid_at set with payment_amount NULL were recorded as "paid in full" before
// amounts were required, so they count as paid = net. NULL (unknown) is never confused with
// an explicit 0. All comparisons are done in integer cents.

export const PAYMENT_FIELDS = ['paid_at', 'payment_amount']

const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Dollars (number or numeric string) → integer cents, or null when blank / not a finite number. */
export function toCents(v) {
  if (isBlank(v)) return null
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const s = typeof v === 'string' ? v.trim() : v
  if (typeof s === 'string' && !/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export const fromCents = c => Math.round(c) / 100

/** Payment status for one billing row, in dollars. */
export function billingPaymentSummary(b) {
  const billedC = toCents(b?.amount_billed) ?? 0
  const retC = toCents(b?.retainage_held) ?? 0
  const netC = billedC - retC
  const recordedC = toCents(b?.payment_amount) // null = nothing recorded / legacy
  const settled = !isBlank(b?.paid_at)
  const legacyFull = settled && recordedC === null
  const paidC = recordedC !== null ? recordedC : (settled ? netC : 0)
  const remainingC = settled ? 0 : Math.max(0, netC - paidC)
  return {
    net: fromCents(netC),
    paid: fromCents(paidC),
    remaining: fromCents(remainingC),
    settled,
    partial: !settled && paidC > 0,
    legacyFull,
    // Settled with a recorded amount that doesn't match net (pre-fix short checks marked paid).
    mismatch: settled && recordedC !== null && recordedC !== netC,
  }
}

/** Money actually paid on a billing (settled or partial). Same fallback everywhere. */
export const billingPaidAmount = b => billingPaymentSummary(b).paid

/** Parse one payment amount (dollars). Must be a finite number > 0 with at most cents. */
export function parsePaymentAmount(v) {
  if (isBlank(v)) return { error: 'Enter the amount paid.' }
  const c = toCents(v)
  if (c === null) return { error: 'Payment amount must be a number.' }
  if (Math.abs(Number(v) * 100 - c) > 1e-6) return { error: 'Payment amount can have at most 2 decimal places.' }
  if (c <= 0) return { error: 'Payment amount must be greater than zero.' }
  return { cents: c }
}

/**
 * Server-side plan for a payment PATCH. `current` is the STORED row (amount_billed,
 * retainage_held, paid_at, payment_amount). `input` may carry:
 *   record_payment_amount — this check's amount, added to paid-to-date (the admin form)
 *   payment_amount        — explicit new CUMULATIVE paid-to-date (edit of the total)
 *   paid_at               — the date to stamp IF this settles the billing (ignored otherwise)
 * Returns { error, status } or { patch, summary } where patch has payment_amount and paid_at.
 * Never trusts a caller's net: everything is computed from `current`.
 */
export function planBillingPayment(current, input = {}) {
  const hasAdd = 'record_payment_amount' in input
  const hasTotal = 'payment_amount' in input
  const hasPaidAt = 'paid_at' in input
  if (!hasAdd && !hasTotal && !hasPaidAt) return { patch: {} }
  if (hasAdd && hasTotal) return { status: 422, error: 'Send either a payment to add or a new paid-to-date total, not both.' }
  if (current?.status !== 'approved') return { status: 422, error: 'Only an approved billing can have a payment recorded.' }

  const before = billingPaymentSummary(current)
  const netC = toCents(before.net)
  if (netC <= 0) return { status: 422, error: 'This billing has no net amount due (billed minus retainage), so no payment can be recorded.' }
  if (before.settled) return { status: 409, error: 'This billing is already marked paid in full.' }
  const priorC = toCents(before.paid)

  let newTotalC
  if (hasAdd) {
    const p = parsePaymentAmount(input.record_payment_amount)
    if (p.error) return { status: 422, error: p.error }
    newTotalC = priorC + p.cents
  } else if (hasTotal) {
    const p = parsePaymentAmount(input.payment_amount)
    if (p.error) return { status: 422, error: p.error.replace('Payment amount', 'Paid-to-date total') }
    newTotalC = p.cents
    if (newTotalC < priorC) return { status: 422, error: `Paid-to-date can't go below the ${fmt(priorC)} already recorded.` }
  } else {
    // paid_at alone: only allowed when the recorded total already covers net.
    newTotalC = priorC
  }

  if (newTotalC > netC) {
    return { status: 422, error: `That would bring paid-to-date to ${fmt(newTotalC)}, more than the ${fmt(netC)} net due (billed minus retainage). Remaining is ${fmt(netC - priorC)}.` }
  }
  if (newTotalC <= 0) return { status: 422, error: 'Enter the amount paid.' }

  const settles = newTotalC === netC
  let paidAt = null
  if (settles) {
    const d = hasPaidAt && !isBlank(input.paid_at) ? new Date(input.paid_at) : new Date()
    if (Number.isNaN(d.getTime())) return { status: 422, error: 'Payment date is not a valid date.' }
    paidAt = hasPaidAt && typeof input.paid_at === 'string' && !isBlank(input.paid_at) ? input.paid_at.trim() : d.toISOString()
  }
  return {
    patch: { payment_amount: fromCents(newTotalC), paid_at: paidAt },
    summary: { net: fromCents(netC), paid: fromCents(newTotalC), remaining: fromCents(netC - newTotalC), settled: settles, prior: fromCents(priorC) },
  }
}

/** Would a billed/retainage change leave net due below what's already been paid? */
export function netBelowPaidError(current, fields = {}) {
  const before = billingPaymentSummary(current)
  if (toCents(before.paid) <= 0) return null
  const next = billingPaymentSummary({
    amount_billed: 'amount_billed' in fields ? fields.amount_billed : current.amount_billed,
    retainage_held: 'retainage_held' in fields ? fields.retainage_held : current.retainage_held,
  })
  if (toCents(next.net) < toCents(before.paid)) {
    return `This billing already has ${fmt(toCents(before.paid))} paid, so its net (billed minus retainage) can't drop to ${fmt(toCents(next.net))}.`
  }
  return null
}

/** Client warning text when the amount being recorded differs from the remaining balance. */
export function paymentMismatchWarning(row, amount) {
  const s = billingPaymentSummary(row)
  const c = toCents(amount)
  if (c === null || c <= 0) return null
  const remC = toCents(s.remaining)
  if (c === remC) return null
  if (c > remC) return `${fmt(c)} is more than the ${fmt(remC)} remaining — it will be refused.`
  return `${fmt(c)} is less than the ${fmt(remC)} remaining. It will be recorded as a PARTIAL payment and the billing stays unpaid (${fmt(remC - c)} left).`
}

/**
 * Admin "Record payment" form → PATCH body. `form.payment_amount` is THIS check's amount
 * (added to paid-to-date on the server via record_payment_amount). paid_at is sent only when
 * the check settles the remaining balance; a short check never sends it. Blank, zero,
 * negative, non-numeric and over-remaining amounts are refused here before any request.
 * When the billing has (or this creates) a partial, a dated ledger line is appended to
 * payment_notes so earlier checks aren't lost when the method / check # fields change.
 * Returns { error } or { body, settles, warning, summary }.
 */
export function buildPaymentRequest(row, form = {}) {
  const s = billingPaymentSummary(row)
  if (s.settled) return { error: 'This billing is already marked paid in full.' }
  const p = parsePaymentAmount(form.payment_amount)
  if (p.error) return { error: p.error }
  const netC = toCents(s.net)
  if (netC <= 0) return { error: 'This billing has no net amount due (billed minus retainage).' }
  const remC = toCents(s.remaining)
  if (p.cents > remC) return { error: `${fmt(p.cents)} is more than the ${fmt(remC)} remaining (net ${fmt(netC)}, already paid ${fmt(toCents(s.paid))}).` }
  const settles = p.cents === remC
  const dateStr = typeof form.paid_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(form.paid_at.trim()) ? form.paid_at.trim() : null
  if (form.paid_at && !dateStr) return { error: 'Payment date is not a valid date.' }
  const check = String(form.check_number || '').trim()
  const note = String(form.payment_notes || '').trim()
  const method = String(form.payment_method || '').trim()

  const body = { id: row.id, record_payment_amount: fromCents(p.cents) }
  if (method) body.payment_method = method
  if (check) body.check_number = check
  if (settles) body.paid_at = dateStr ? new Date(dateStr + 'T12:00:00').toISOString() : new Date().toISOString()
  const ledger = !settles || s.partial
  if (ledger) {
    const line = `${dateStr || 'Undated'}: ${settles ? 'final' : 'partial'} payment ${fmt(p.cents)}${method ? ' by ' + method : ''}${check ? ' #' + check : ''}${note ? ' — ' + note : ''}`
    body.payment_notes = [String(row.payment_notes || '').trim(), line].filter(Boolean).join('\n')
  } else if (note) {
    body.payment_notes = note
  }
  return {
    body,
    settles,
    warning: paymentMismatchWarning(row, fromCents(p.cents)),
    summary: { net: s.net, prior: s.paid, paid: fromCents(toCents(s.paid) + p.cents), remaining: fromCents(remC - p.cents) },
  }
}

/** Short display text for a billing's payment state (Unpaid lists, sub portal). */
export function paymentStatusText(b) {
  const s = billingPaymentSummary(b)
  const $ = n => fmt(toCents(n))
  if (s.settled) return `Paid ${$(s.paid)}`
  if (s.partial) return `Partially paid ${$(s.paid)} of ${$(s.net)} · ${$(s.remaining)} remaining`
  return null
}

function fmt(c) {
  return '$' + fromCents(c).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
