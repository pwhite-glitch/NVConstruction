import { describe, it, expect } from '@jest/globals'
import {
  CHECK_TO_VENDOR, REIMBURSEMENT, PAYMENT_ROUTE_LABELS,
  poPaymentRoute, directCostPaymentRoute, isReimbursableDirectCost,
  generalConditionPaymentRoute, subBillingPaymentRoute, totalsByPaymentRoute, isMissingPaymentTypeColumn,
} from '../lib/payment-route'

describe('poPaymentRoute', () => {
  it('reimbursement POs are reimbursement to NV', () => {
    expect(poPaymentRoute({ payment_type: 'reimbursement' })).toBe(REIMBURSEMENT)
  })
  it('check, missing or unknown payment_type is check to vendor', () => {
    expect(poPaymentRoute({ payment_type: 'check' })).toBe(CHECK_TO_VENDOR)
    expect(poPaymentRoute({})).toBe(CHECK_TO_VENDOR)
    expect(poPaymentRoute(null)).toBe(CHECK_TO_VENDOR)
  })
})

describe('directCostPaymentRoute', () => {
  it('all direct costs are reimbursement to NV (credit card purchases)', () => {
    expect(directCostPaymentRoute({ bill_to_owner: true })).toBe(REIMBURSEMENT)
    expect(directCostPaymentRoute({ bill_to_owner: false })).toBe(REIMBURSEMENT)
    expect(directCostPaymentRoute({})).toBe(REIMBURSEMENT)
    expect(directCostPaymentRoute(null)).toBe(REIMBURSEMENT)
  })
  it('isReimbursableDirectCost is always true', () => {
    expect(isReimbursableDirectCost({ bill_to_owner: true, billing_route: 'pay_app' })).toBe(true)
    expect(isReimbursableDirectCost({})).toBe(true)
  })
})

describe('other draw lines', () => {
  it('general conditions are reimbursement to NV', () => {
    expect(generalConditionPaymentRoute()).toBe(REIMBURSEMENT)
  })
  it('sub billings follow who pays subs on the job', () => {
    expect(subBillingPaymentRoute({ payment_type: 'owner_pays_direct' })).toBe(CHECK_TO_VENDOR)
    expect(subBillingPaymentRoute({ payment_type: 'nv_pays' })).toBe(REIMBURSEMENT)
    expect(subBillingPaymentRoute({})).toBe(REIMBURSEMENT)
  })
})

describe('totalsByPaymentRoute', () => {
  it('sums each route, honoring credits', () => {
    expect(totalsByPaymentRoute([
      { route: CHECK_TO_VENDOR, amount: 1200 },
      { route: REIMBURSEMENT, amount: 450.5 },
      { route: REIMBURSEMENT, amount: -50 },
      { route: CHECK_TO_VENDOR, amount: '300' },
    ])).toEqual({ [CHECK_TO_VENDOR]: 1500, [REIMBURSEMENT]: 400.5 })
  })
  it('empty draw is zero for both', () => {
    expect(totalsByPaymentRoute([])).toEqual({ [CHECK_TO_VENDOR]: 0, [REIMBURSEMENT]: 0 })
  })
})

describe('labels', () => {
  it('uses the wording on the draw', () => {
    expect(PAYMENT_ROUTE_LABELS[CHECK_TO_VENDOR]).toBe('Check to vendor')
    expect(PAYMENT_ROUTE_LABELS[REIMBURSEMENT]).toBe('Reimbursement to NV')
  })
})

describe('isMissingPaymentTypeColumn', () => {
  it('detects the missing-column errors', () => {
    expect(isMissingPaymentTypeColumn({ code: 'PGRST204', message: "Could not find the 'payment_type' column of 'purchase_orders' in the schema cache" })).toBe(true)
    expect(isMissingPaymentTypeColumn({ code: '42703', message: 'column "payment_type" of relation "purchase_orders" does not exist' })).toBe(true)
  })
  it('does not swallow other errors that mention payment_type', () => {
    expect(isMissingPaymentTypeColumn({ code: '23514', message: 'new row violates check constraint "purchase_orders_payment_type_check"' })).toBe(false)
    expect(isMissingPaymentTypeColumn({ message: 'duplicate key' })).toBe(false)
    expect(isMissingPaymentTypeColumn(null)).toBe(false)
  })
})
