import { describe, it, expect } from '@jest/globals'
import {
  DC_APPROVER_ROLES, submittedAt, daysWaiting, signedAmount, queueTotal, buildApprovalQueue,
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
