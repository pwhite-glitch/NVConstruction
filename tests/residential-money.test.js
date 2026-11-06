import { describe, it, expect } from '@jest/globals'
import {
  amountsDiffer, packagedDrawTotal, approvedCOTotal, revisedContract,
  bankAmount, coBudgetDeltas, applyDelta,
} from '../lib/residential-money'

describe('amountsDiffer', () => {
  it('ignores differences of a cent or less', () => {
    expect(amountsDiffer(100, 100)).toBe(false)
    expect(amountsDiffer(100, 100.01)).toBe(false)
    expect(amountsDiffer('100.00', 99.99)).toBe(false)
  })
  it('flags differences over a cent', () => {
    expect(amountsDiffer(100, 100.02)).toBe(true)
    expect(amountsDiffer(925000, 760000)).toBe(true)
  })
  it('treats null/blank as zero', () => {
    expect(amountsDiffer(null, 0)).toBe(false)
    expect(amountsDiffer(undefined, 5)).toBe(true)
  })
})

describe('packagedDrawTotal', () => {
  const costs = [
    { draw_request_id: 'd1', amount: '1000', is_credit: false },
    { draw_request_id: 'd1', amount: 200, is_credit: true },
    { draw_request_id: 'd2', amount: 50 },
    { draw_request_id: null, amount: 999 },
  ]
  const billings = [
    { draw_request_id: 'd1', amount_billed: '500.50' },
    { draw_request_id: 'd2', amount_billed: 25 },
  ]
  it('sums linked costs (credits negative) and linked billings', () => {
    expect(packagedDrawTotal('d1', costs, billings)).toBeCloseTo(1300.5)
    expect(packagedDrawTotal('d2', costs, billings)).toBe(75)
  })
  it('is zero for a draw with nothing linked', () => {
    expect(packagedDrawTotal('d3', costs, billings)).toBe(0)
    expect(packagedDrawTotal('d1')).toBe(0)
  })
})

describe('revisedContract', () => {
  const cos = [
    { status: 'approved', amount: '12500' },
    { status: 'approved', amount: -2500 },
    { status: 'pending', amount: 40000 },
    { status: 'rejected', amount: 9000 },
  ]
  it('is base contract + approved COs only', () => {
    expect(approvedCOTotal(cos)).toBe(10000)
    expect(revisedContract({ contract_value: 500000 }, cos)).toBe(510000)
  })
  it('handles a missing contract value or no COs', () => {
    expect(revisedContract({ contract_value: null }, cos)).toBe(10000)
    expect(revisedContract({ contract_value: '925000' }, [])).toBe(925000)
  })
})

describe('bankAmount', () => {
  it('uses owner_amount when set, else budget_amount', () => {
    expect(bankAmount({ budget_amount: 100, owner_amount: 150 })).toBe(150)
    expect(bankAmount({ budget_amount: 100, owner_amount: null })).toBe(100)
    expect(bankAmount({ budget_amount: 100, owner_amount: 0 })).toBe(0)
  })
})

describe('coBudgetDeltas', () => {
  it('prefers sov rows with a budget line', () => {
    const co = { amount: 300, budget_item_id: 'b9', sov: [{ budget_item_id: 'b1', amount: 100 }, { budget_item_id: 'b2', amount: '200' }, { amount: 5 }] }
    expect(coBudgetDeltas(co)).toEqual([{ budget_item_id: 'b1', amount: 100 }, { budget_item_id: 'b2', amount: 200 }])
  })
  it('falls back to budget_item_id with the full amount', () => {
    expect(coBudgetDeltas({ amount: '-750', budget_item_id: 'b1', sov: null })).toEqual([{ budget_item_id: 'b1', amount: -750 }])
  })
  it('is empty when no budget line is recorded', () => {
    expect(coBudgetDeltas({ amount: 100 })).toEqual([])
    expect(coBudgetDeltas({ amount: 100, sov: [] })).toEqual([])
  })
})

describe('applyDelta', () => {
  it('adds to cost and bank, using cost when bank is blank', () => {
    expect(applyDelta({ budget_amount: 1000, owner_amount: null }, 250)).toEqual({ budget_amount: 1250, owner_amount: 1250 })
    expect(applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 250)).toEqual({ budget_amount: 1250, owner_amount: 1450 })
  })
  it('reverses cleanly with a negative delta', () => {
    const applied = applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 250)
    expect(applyDelta(applied, -250)).toEqual({ budget_amount: 1000, owner_amount: 1200 })
  })
})
