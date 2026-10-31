import { describe, it, expect } from '@jest/globals'
import { contractSumToDate, totalCompletedToDate, contractCap, contractCapMessage } from '../lib/contract-cap'

const job = { contract_value: 500000, nv_role: 'gc' }
const primeCOs = [
  { status: 'approved', amount: 12500 },
  { status: 'approved', amount: -2500 },
  { status: 'pending', amount: 40000 },
  { status: 'rejected', amount: 9000 },
]

describe('contractSumToDate', () => {
  it('is original contract + approved owner COs only', () => {
    expect(contractSumToDate({ job, app: {}, primeCOs })).toBe(510000)
  })

  it('uses GC subcontracts + their approved COs when NV is the sub', () => {
    const nvSubcontracts = [
      { contract_value: 200000, change_orders: [{ status: 'approved', amount: 5000 }, { status: 'pending', amount: 1 }] },
      { contract_value: 50000, change_orders: [] },
    ]
    expect(contractSumToDate({ job: { ...job, nv_role: 'sub' }, app: {}, primeCOs, nvSubcontracts })).toBe(255000)
  })

  it('falls back to job value when NV is the sub with no GC subcontracts', () => {
    expect(contractSumToDate({ job: { ...job, nv_role: 'sub' }, app: {}, nvSubcontracts: [] })).toBe(500000)
  })

  it('uses the app SOV for NV-subcontract apps', () => {
    const lines = [{ budget_amount: 1000 }, { budget_amount: 250.5 }]
    expect(contractSumToDate({ job, app: { nv_subcontract_id: 'sc1' }, primeCOs, lines })).toBe(1250.5)
  })
})

describe('totalCompletedToDate', () => {
  it('adds previous + this period across all lines, overbilled lines included', () => {
    const lines = [
      { budget_amount: 10000, dollar_prev: 4000, dollar_this: 1000 },
      // a GC line billed past its own scheduled value is fine
      { budget_amount: 1500, dollar_prev: 1200, dollar_this: 600.55 },
    ]
    expect(totalCompletedToDate(lines)).toBe(6800.55)
  })

  it('falls back to % × scheduled when dollars are missing', () => {
    expect(totalCompletedToDate([{ budget_amount: 2000, dollar_prev: null, pct_prev: '25', pct_this: '10' }])).toBe(700)
  })

  it('treats a cleared input as $0', () => {
    expect(totalCompletedToDate([{ budget_amount: 100, dollar_prev: 50, dollar_this: '' }])).toBe(50)
  })
})

describe('contractCap', () => {
  it('allows billing exactly to the contract sum', () => {
    expect(contractCap(510000, 510000)).toMatchObject({ remaining: 0, isOver: false })
  })

  it('blocks a cent over', () => {
    expect(contractCap(510000, 510000.01)).toMatchObject({ remaining: -0.01, isOver: true })
  })

  it('is not enforced when no contract value is set', () => {
    expect(contractCap(0, 25000)).toMatchObject({ enforced: false, isOver: false })
  })

  it('message shows contract sum, total billed and how much over', () => {
    const msg = contractCapMessage(contractCap(510000, 512345.67))
    expect(msg).toContain('$510,000.00')
    expect(msg).toContain('$512,345.67')
    expect(msg).toContain('Over by: $2,345.67')
  })
})
