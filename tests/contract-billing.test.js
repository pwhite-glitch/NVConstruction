/**
 * lib/contract-billing.js — crediting sub billings to the right subcontract via
 * billing_sov_lines -> subcontract_sov_lines. Reproduces Braum's Conway: A&B Dirt
 * Movers has Dirtwork + Underground Utility on one job, and every billing used to
 * count on both contracts.
 */
import { allocateJobBillings, billingForContract, cumulativeOnContract, linesMismatch } from '../lib/contract-billing'

const dirt = { id: 'c-dirt', sub_id: 'sub-ab', vendor_name: 'A&B Dirt Movers', description: 'Dirtwork' }
const util = { id: 'c-util', sub_id: 'sub-ab', vendor_name: 'A&B Dirt Movers', description: 'Underground Utility' }
const other = { id: 'c-elec', sub_id: 'sub-sparky', vendor_name: 'Sparky Electric LLC' }
const sovLines = [
  { id: 'l-dirt-1', subcontract_id: 'c-dirt' },
  { id: 'l-dirt-2', subcontract_id: 'c-dirt' },
  { id: 'l-util-1', subcontract_id: 'c-util' },
  { id: 'l-elec-1', subcontract_id: 'c-elec' },
]
const sub = (id, amount, status, extra = {}) => ({ id, sub_id: 'sub-ab', company_name: 'A&B Dirt Movers Inc', amount_billed: amount, retainage_held: 0, status, submitted_at: '2026-01-0' + id.slice(-1) + 'T12:00:00Z', ...extra })
const line = (billing_submission_id, sov_line_id, amount) => ({ billing_submission_id, sov_line_id, amount })

describe('allocateJobBillings', () => {
  test('two contracts, same sub: each billing is split by its lines, not counted on both', () => {
    const submissions = [sub('b1', 150000, 'approved', { retainage_held: 15000 }), sub('b2', 192000, 'approved')]
    const billingLines = [
      line('b1', 'l-dirt-1', 100000), line('b1', 'l-util-1', 50000),
      line('b2', 'l-dirt-2', 42000), line('b2', 'l-util-1', 150000),
    ]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines })
    expect(r.byContract['c-dirt'].billedApproved).toBe(142000)
    expect(r.byContract['c-util'].billedApproved).toBe(200000)
    // Together they equal the job total, not double it
    expect(r.byContract['c-dirt'].billedApproved + r.byContract['c-util'].billedApproved).toBe(342000)
    // Retainage split pro rata to each contract's share of b1
    expect(r.byContract['c-dirt'].retainageApproved).toBe(10000)
    expect(r.byContract['c-util'].retainageApproved).toBe(5000)
    // Submission list per contract carries this contract's portion
    const b1OnUtil = r.byContract['c-util'].submissions.find(e => e.submission.id === 'b1')
    expect(b1OnUtil.amount).toBe(50000)
    expect(r.unassigned).toHaveLength(0)
  })

  test('a billing only on one contract does not appear on the other', () => {
    const submissions = [sub('b1', 30000, 'approved')]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines: [line('b1', 'l-util-1', 30000)] })
    expect(r.byContract['c-util'].submissions.map(e => e.submission.id)).toEqual(['b1'])
    expect(r.byContract['c-dirt'].submissions).toHaveLength(0)
    expect(r.byContract['c-dirt'].billedApproved).toBe(0)
  })

  test('pending and rejected billings are listed but not counted as billed', () => {
    const submissions = [sub('b1', 10000, 'approved'), sub('b2', 20000, 'pending'), sub('b3', 40000, 'rejected')]
    const billingLines = [line('b1', 'l-dirt-1', 10000), line('b2', 'l-dirt-1', 20000), line('b3', 'l-dirt-2', 40000)]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines })
    expect(r.byContract['c-dirt'].billedApproved).toBe(10000)
    expect(r.byContract['c-dirt'].submissions).toHaveLength(3)
  })

  test('no lines + sub has exactly one contract on the job: header amount goes to that contract', () => {
    const submissions = [{ id: 'e1', sub_id: 'sub-sparky', company_name: 'Sparky Electric', amount_billed: 7500, retainage_held: 750, status: 'approved' }]
    const r = allocateJobBillings({ contracts: [dirt, util, other], sovLines, submissions, billingLines: [] })
    expect(r.byContract['c-elec'].billedApproved).toBe(7500)
    expect(r.byContract['c-elec'].retainageApproved).toBe(750)
    expect(r.byContract['c-elec'].submissions[0].viaFallback).toBe(true)
    expect(r.unassigned).toHaveLength(0)
  })

  test('no lines fallback matches by loose company name when there is no sub_id', () => {
    const contract = { id: 'c-x', sub_id: null, vendor_name: 'A&B Dirt Movers' }
    const submissions = [{ id: 'x1', sub_id: null, company_name: 'A&B Dirt Movers Inc', amount_billed: 500, status: 'approved' }]
    const r = allocateJobBillings({ contracts: [contract], sovLines: [], submissions, billingLines: [] })
    expect(r.byContract['c-x'].billedApproved).toBe(500)
  })

  test('no lines + sub has two contracts: unassigned, added to neither contract', () => {
    const submissions = [sub('b1', 342000, 'approved')]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines: [] })
    expect(r.unassigned.map(s => s.id)).toEqual(['b1'])
    expect(r.bySubmission.b1.unassigned).toBe(true)
    expect(r.byContract['c-dirt'].billedApproved).toBe(0)
    expect(r.byContract['c-util'].billedApproved).toBe(0)
  })

  test('flags header vs lines mismatch, and counts lines (not header) on the contract', () => {
    const submissions = [sub('b1', 12000, 'approved'), sub('b2', 5000, 'approved')]
    const billingLines = [line('b1', 'l-dirt-1', 10000), line('b2', 'l-dirt-1', 2500), line('b2', 'l-dirt-2', 2500)]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines })
    expect(r.bySubmission.b1).toMatchObject({ mismatch: true, linesTotal: 10000, header: 12000 })
    expect(r.bySubmission.b2.mismatch).toBe(false)
    expect(r.byContract['c-dirt'].billedApproved).toBe(15000)
  })

  test('uses the joined subcontract_id when a line is not in sovLines', () => {
    const submissions = [sub('b1', 100, 'approved')]
    const billingLines = [{ billing_submission_id: 'b1', sov_line_id: 'l-new', amount: 100, subcontract_sov_lines: { subcontract_id: 'c-util' } }]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines: [], submissions, billingLines })
    expect(r.byContract['c-util'].billedApproved).toBe(100)
  })
})

describe('billingForContract / cumulativeOnContract', () => {
  test('billingForContract uses all job contracts for the fallback', () => {
    const submissions = [sub('b1', 1000, 'approved')]
    // With both contracts known the line-less billing is unassigned...
    expect(billingForContract({ contract: dirt, contracts: [dirt, util], sovLines, submissions, billingLines: [] }).billedApproved).toBe(0)
    // ...with only one it falls back to it
    expect(billingForContract({ contract: dirt, contracts: [dirt], sovLines, submissions, billingLines: [] }).billedApproved).toBe(1000)
  })

  test('cumulative to date skips rejected, includes this billing', () => {
    const submissions = [sub('b1', 100, 'approved'), sub('b2', 200, 'rejected'), sub('b3', 300, 'pending')]
    const billingLines = [line('b1', 'l-dirt-1', 100), line('b2', 'l-dirt-1', 200), line('b3', 'l-dirt-1', 300)]
    const r = allocateJobBillings({ contracts: [dirt, util], sovLines, submissions, billingLines })
    expect(cumulativeOnContract(r.byContract['c-dirt'], 'b1')).toBe(100)
    expect(cumulativeOnContract(r.byContract['c-dirt'], 'b3')).toBe(400)
    expect(cumulativeOnContract(r.byContract['c-util'], 'b1')).toBe(null)
  })

  test('linesMismatch ignores sub-cent rounding', () => {
    expect(linesMismatch(100, 100.004)).toBe(false)
    expect(linesMismatch(100, 100.01)).toBe(true)
  })
})
