import { describe, it, expect } from '@jest/globals'
import {
  DC_APPROVER_ROLES, submittedAt, daysWaiting, signedAmount, queueTotal, buildApprovalQueue,
  budgetLinesByJob, budgetLineLabel, suggestBudgetLine, splitForApproval,
} from '../lib/direct-cost-queue'

describe('DC_APPROVER_ROLES', () => {
  it('is PM, APM and admin only', () => {
    expect([...DC_APPROVER_ROLES].sort()).toEqual(['admin', 'apm', 'pm'])
    expect(DC_APPROVER_ROLES.has('super')).toBe(false)
  })
})

describe('daysWaiting', () => {
  const now = new Date('2026-10-29T15:00:00Z')
  it('counts whole days since the cost was entered', () => {
    expect(daysWaiting({ created_at: '2026-10-19T15:00:00Z' }, now)).toBe(10)
    expect(daysWaiting({ created_at: '2026-10-29T09:00:00Z' }, now)).toBe(0)
  })
  it('falls back to the cost date, then to null', () => {
    expect(submittedAt({ cost_date: '2026-10-01' })).toBeInstanceOf(Date)
    expect(daysWaiting({ cost_date: '2026-10-01' }, now)).toBeGreaterThanOrEqual(27)
    expect(daysWaiting({}, now)).toBeNull()
  })
  it('never goes negative', () => {
    expect(daysWaiting({ created_at: '2026-11-05T00:00:00Z' }, now)).toBe(0)
  })
})

describe('queueTotal', () => {
  it('subtracts credits', () => {
    expect(signedAmount({ amount: '50', is_credit: true })).toBe(-50)
    expect(queueTotal([{ amount: 100 }, { amount: '25.5' }, { amount: 50, is_credit: true }, { amount: null }])).toBe(75.5)
    expect(queueTotal(null)).toBe(0)
  })
})

describe('buildApprovalQueue', () => {
  const costs = [
    { id: 'b', job_id: 'j1', budget_item_id: 'bi1', submitted_by: 'u1', created_at: '2026-10-20T00:00:00Z', amount: 10 },
    { id: 'a', job_id: 'j2', budget_item_id: null, submitted_by: 'u9', created_at: '2026-10-01T00:00:00Z', amount: 20 },
    { id: 'c', job_id: 'j1', cost_date: '2026-10-10', amount: 30 },
  ]
  const q = buildApprovalQueue(costs, {
    jobs: [{ id: 'j1', job_number: 101, project_name: 'Main St' }],
    budgetItems: [{ id: 'bi1', cost_code: '03-300', description: 'Concrete' }],
    profiles: [{ id: 'u1', full_name: 'Sam Super' }],
  })
  it('sorts oldest first', () => {
    expect(q.map(c => c.id)).toEqual(['a', 'c', 'b'])
  })
  it('attaches job, cost code and submitter, leaving unknowns null', () => {
    const b = q.find(c => c.id === 'b')
    expect(b).toMatchObject({ job_number: 101, project_name: 'Main St', cost_code: '03-300', budget_line: 'Concrete', submitted_by_name: 'Sam Super' })
    const a = q.find(c => c.id === 'a')
    expect(a).toMatchObject({ job_number: null, cost_code: null, submitted_by_name: null })
  })
})

describe('budget line picking', () => {
  const lines = [
    { id: 'L1', cost_code: '03-300', description: 'Concrete' },
    { id: 'L2', cost_code: '06-100', description: 'Rough carpentry & lumber' },
    { id: 'L3', cost_code: '09-900', description: 'Paint' },
  ]
  it('groups lines by job, sorted by code', () => {
    const g = budgetLinesByJob([
      { id: 'b', job_id: 'j1', cost_code: '10-200', description: 'B', budget_amount: 5 },
      { id: 'a', job_id: 'j1', cost_code: '2-100', description: 'A' },
      { id: 'x', job_id: 'j2', cost_code: '01', description: 'X' },
    ])
    expect(g.j1).toEqual([{ id: 'a', cost_code: '2-100', description: 'A' }, { id: 'b', cost_code: '10-200', description: 'B' }])
    expect(g.j2.map(b => b.id)).toEqual(['x'])
  })
  it('labels as code · description', () => {
    expect(budgetLineLabel(lines[0])).toBe('03-300 · Concrete')
    expect(budgetLineLabel({ cost_code: null, description: 'Misc' })).toBe('Misc')
  })
  it('suggests by description words, or nothing on no match or a tie', () => {
    expect(suggestBudgetLine('2x4 lumber, Home Depot', lines)?.id).toBe('L2')
    expect(suggestBudgetLine('Concrete pump', lines)?.id).toBe('L1')
    expect(suggestBudgetLine('Fuel', lines)).toBeNull()
    expect(suggestBudgetLine('Paint', [...lines, { id: 'L4', cost_code: '09-910', description: 'Paint touch-up' }])).toBeNull()
  })
  it('splits a bulk approve into ready, needs-line and not-allowed', () => {
    const costs = [
      { id: 'a', has_budget_line: true, can_approve: true },
      { id: 'b', has_budget_line: false, can_approve: true },
      { id: 'c', has_budget_line: false, can_approve: true },
      { id: 'd', has_budget_line: true, can_approve: false },
    ]
    const r = splitForApproval(costs, { b: 'L1' })
    expect(r.ready).toEqual([{ cost: costs[0], budget_item_id: null }, { cost: costs[1], budget_item_id: 'L1' }])
    expect(r.needLine.map(c => c.id)).toEqual(['c'])
    expect(r.notAllowed.map(c => c.id)).toEqual(['d'])
  })
  it('does not count a line from another job', () => {
    const [c] = buildApprovalQueue([{ id: 'c', job_id: 'j1', budget_item_id: 'x' }], { budgetItems: [{ id: 'x', job_id: 'j2', cost_code: '01' }] })
    expect(c).toMatchObject({ has_budget_line: false, cost_code: null })
  })
})
