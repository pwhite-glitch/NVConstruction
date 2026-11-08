import { describe, it, expect } from '@jest/globals'
import {
  amountsDiffer, packagedDrawTotal, approvedCOTotal, revisedContract,
  bankAmount, coBudgetDeltas, applyDelta,
  drawAwaitingBillings, coNvCost, coResidentialDeltas, expectedCostTotal, budgetContractCheck,
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
    { draw_request_id: 'd1', amount_billed: '500.50', status: 'approved' },
    { draw_request_id: 'd2', amount_billed: 25, status: 'approved' },
  ]
  it('sums linked costs (credits negative) and linked billings', () => {
    expect(packagedDrawTotal('d1', costs, billings)).toBeCloseTo(1300.5)
    expect(packagedDrawTotal('d2', costs, billings)).toBe(75)
  })
  it('is zero for a draw with nothing linked', () => {
    expect(packagedDrawTotal('d3', costs, billings)).toBe(0)
    expect(packagedDrawTotal('d1')).toBe(0)
  })
  // Prompt 61 finding 2
  it('counts approved billings only (pending / rejected / blank status tagged rows excluded)', () => {
    const mixed = [
      ...billings,
      { draw_request_id: 'd1', amount_billed: 1000, status: 'pending' },
      { draw_request_id: 'd1', amount_billed: 2000, status: 'rejected' },
      { draw_request_id: 'd1', amount_billed: 3000 },
    ]
    expect(packagedDrawTotal('d1', costs, mixed)).toBeCloseTo(1300.5)
  })
  it('lists pending tagged billings as awaiting approval', () => {
    const mixed = [...billings, { id: 'p', draw_request_id: 'd1', amount_billed: 1000, status: 'pending' }, { id: 'r', draw_request_id: 'd1', amount_billed: 5, status: 'rejected' }]
    expect(drawAwaitingBillings('d1', mixed).map(b => b.id)).toEqual(['p'])
    expect(drawAwaitingBillings('d2', mixed)).toEqual([])
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
  it('residential split: cost moves by Nv cost, bank by the sale price', () => {
    expect(applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 25000, 20000)).toEqual({ budget_amount: 21000, owner_amount: 26200 })
    expect(applyDelta({ budget_amount: 1000, owner_amount: null }, 250, 200)).toEqual({ budget_amount: 1200, owner_amount: 1250 })
    const applied = applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 250, 200)
    expect(applyDelta(applied, -250, -200)).toEqual({ budget_amount: 1000, owner_amount: 1200 })
  })
  it('adds to cost and bank, using cost when bank is blank', () => {
    expect(applyDelta({ budget_amount: 1000, owner_amount: null }, 250)).toEqual({ budget_amount: 1250, owner_amount: 1250 })
    expect(applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 250)).toEqual({ budget_amount: 1250, owner_amount: 1450 })
  })
  it('reverses cleanly with a negative delta', () => {
    const applied = applyDelta({ budget_amount: 1000, owner_amount: 1200 }, 250)
    expect(applyDelta(applied, -250)).toEqual({ budget_amount: 1000, owner_amount: 1200 })
  })
})

// Prompt 61 finding 4: residential homeowner CO — Nv cost vs sale price
describe('residential CO cost / price', () => {
  it('coNvCost: blank / null nv_cost = the sale price', () => {
    expect(coNvCost({ amount: 25000, nv_cost: 20000 })).toBe(20000)
    expect(coNvCost({ amount: 25000, nv_cost: null })).toBe(25000)
    expect(coNvCost({ amount: 25000 })).toBe(25000)
    expect(coNvCost({ amount: '-750', nv_cost: '' })).toBe(-750)
    expect(coNvCost({ amount: 100, nv_cost: 0 })).toBe(0)
  })
  it('coResidentialDeltas: one line, price from SOV / amount, cost from nv_cost (mirror of 058)', () => {
    expect(coResidentialDeltas({ amount: 25000, nv_cost: 20000, sov: [{ budget_item_id: 'b1', amount: 25000 }] }).lines)
      .toEqual([{ budget_item_id: 'b1', price: 25000, cost: 20000 }])
    expect(coResidentialDeltas({ amount: 25000, nv_cost: 20000, budget_item_id: 'b1', sov: null }).lines)
      .toEqual([{ budget_item_id: 'b1', price: 25000, cost: 20000 }])
    expect(coResidentialDeltas({ amount: 25000, nv_cost: null, budget_item_id: 'b1' }).lines)
      .toEqual([{ budget_item_id: 'b1', price: 25000, cost: 25000 }])
  })
  it('coResidentialDeltas: no invented multi-line split when a cost is set', () => {
    const r = coResidentialDeltas({ amount: 300, nv_cost: 200, sov: [{ budget_item_id: 'b1', amount: 100 }, { budget_item_id: 'b2', amount: 200 }] })
    expect(r.error).toMatch(/one budget line/)
    expect(r.lines).toEqual([])
    // without a cost, multi-line keeps today's both-columns behaviour
    expect(coResidentialDeltas({ amount: 300, sov: [{ budget_item_id: 'b1', amount: 100 }, { budget_item_id: 'b2', amount: 200 }] }).lines)
      .toEqual([{ budget_item_id: 'b1', price: 100, cost: 100 }, { budget_item_id: 'b2', price: 200, cost: 200 }])
  })
  it('approvedCOTotal / revisedContract stay on the sale price', () => {
    const cos = [{ status: 'approved', amount: 25000, nv_cost: 20000 }]
    expect(approvedCOTotal(cos)).toBe(25000)
    expect(revisedContract({ contract_value: 500000 }, cos)).toBe(525000)
  })
  it('expectedCostTotal: base + approved COs at nv_cost ?? amount (pending / rejected ignored)', () => {
    const cos = [
      { status: 'approved', amount: 25000, nv_cost: 20000 },
      { status: 'approved', amount: 5000, nv_cost: null }, // older CO: added sale price to Cost
      { status: 'pending', amount: 9000, nv_cost: 1 },
      { status: 'rejected', amount: 7000 },
    ]
    expect(expectedCostTotal({ contract_value: 500000 }, cos)).toBe(525000)
  })
})

describe('budgetContractCheck (Budget tab banner)', () => {
  const job = { contract_value: 500000 }
  it('Bank equal to the REVISED contract after an approved CO: no warning (was a false warning)', () => {
    const cos = [{ status: 'approved', amount: 25000 }]
    const r = budgetContractCheck({ job, changeOrders: cos, costTotal: 525000, bankTotal: 525000 })
    expect(r).toMatchObject({ revised: 525000, expectedCost: 525000, bankMismatch: false, costMismatch: false })
  })
  it('Cost below the revised contract because of a lower Nv cost is not flagged', () => {
    const cos = [{ status: 'approved', amount: 25000, nv_cost: 20000 }]
    const r = budgetContractCheck({ job, changeOrders: cos, costTotal: 520000, bankTotal: 525000 })
    expect(r).toMatchObject({ bankMismatch: false, costMismatch: false, expectedCost: 520000 })
  })
  it('a real Cost or Bank SOV error still flags', () => {
    const cos = [{ status: 'approved', amount: 25000, nv_cost: 20000 }]
    expect(budgetContractCheck({ job, changeOrders: cos, costTotal: 519000, bankTotal: 525000 }).costMismatch).toBe(true)
    expect(budgetContractCheck({ job, changeOrders: cos, costTotal: 520000, bankTotal: 500000 }).bankMismatch).toBe(true)
  })
  it('no COs: compares to the base contract as before', () => {
    expect(budgetContractCheck({ job, changeOrders: [], costTotal: 500000, bankTotal: 500000.01 })).toMatchObject({ bankMismatch: false, costMismatch: false })
    expect(budgetContractCheck({ job, changeOrders: [], costTotal: 490000, bankTotal: 500000 }).costMismatch).toBe(true)
  })
})
