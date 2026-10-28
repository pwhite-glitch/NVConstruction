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

// Same rule as the Reimbursements tab: bill_to_owner costs that are unbilled
// or already on a reimbursement invoice. Costs routed to a pay app / CO aren't.
export function isReimbursableDirectCost(dc) {
  return !!dc?.bill_to_owner && (!dc.billing_route || dc.billing_route === REIMBURSEMENT)
}

export function directCostPaymentRoute(dc) {
  return isReimbursableDirectCost(dc) ? REIMBURSEMENT : CHECK_TO_VENDOR
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
