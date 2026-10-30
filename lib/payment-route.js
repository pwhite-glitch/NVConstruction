// How a draw line gets paid: the owner writes a check straight to the vendor,
// or NV pays and the owner reimburses NV.

export const CHECK_TO_VENDOR = 'check'
export const REIMBURSEMENT = 'reimbursement'

export const PAYMENT_ROUTE_LABELS = {
  [CHECK_TO_VENDOR]: 'Check to vendor',
  [REIMBURSEMENT]: 'Reimbursement to NV',
}

// PO payment_type is 'check' | 'reimbursement' (migration 004, default 'check')
export function poPaymentRoute(po) {
  return po?.payment_type === REIMBURSEMENT ? REIMBURSEMENT : CHECK_TO_VENDOR
}

// Direct costs are always NV credit card purchases — always reimbursement to NV.
export function isReimbursableDirectCost(dc) {
  return true
}

export function directCostPaymentRoute(dc) {
  return REIMBURSEMENT
}

// General conditions are NV's own costs (salaries, trailer, etc.)
export function generalConditionPaymentRoute() {
  return REIMBURSEMENT
}

// Sub billings follow the job's "Who pays subs" setting
export function subBillingPaymentRoute(job) {
  return job?.payment_type === 'owner_pays_direct' ? CHECK_TO_VENDOR : REIMBURSEMENT
}

// lines: [{ route, amount }] with amount already signed (credits negative)
export function totalsByPaymentRoute(lines) {
  const totals = { [CHECK_TO_VENDOR]: 0, [REIMBURSEMENT]: 0 }
  for (const l of lines || []) totals[l.route === REIMBURSEMENT ? REIMBURSEMENT : CHECK_TO_VENDOR] += Number(l.amount || 0)
  return totals
}

// PostgREST/Postgres error when purchase_orders.payment_type doesn't exist yet
export function isMissingPaymentTypeColumn(err) {
  const m = err?.message || ''
  if (!m.includes('payment_type')) return false
  return err.code === 'PGRST204' || err.code === '42703' || m.includes('schema cache') || m.includes('does not exist')
}

export const PAYMENT_TYPE_NOT_SAVED_WARNING = "Payment type couldn't be saved (the database is missing the payment_type column — migration 004). The rest of the PO was saved."
