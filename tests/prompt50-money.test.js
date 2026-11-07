/**
 * Prompt 50 items 10, 11, 15: residential budget math (approved costs, credits,
 * commitments) and owner/lender draw funding/schedule rules. Pure helpers.
 */
import {
  signedDcAmount, approvedDcTotal, contractCommittedForItem, unlinkedContracts,
  committedTotalForLines, contractRevisedValue, revisedContract,
} from '../lib/residential-money'
import {
  ownerDrawFunding, pctFunded, drawFundedAmount, priorDrawnByLine, buildDrawSchedule,
  validateDrawLines, drawStatusChangeError, isDrawEditable, drawAttachmentPathOk,
} from '../lib/owner-draws'

describe('approved direct costs (item 11)', () => {
  const dcs = [
    { status: 'approved', amount: 100, budget_item_id: 'b1' },
    { status: 'approved', amount: 20, is_credit: true, budget_item_id: 'b1' },
    { status: 'pending', amount: 500, budget_item_id: 'b1' },
    { status: 'rejected', amount: 900, budget_item_id: 'b1' },
    { status: 'approved', amount: 7, budget_item_id: 'b2' },
  ]
  test('100 expense − 20 credit = 80; pending and rejected excluded', () => {
    expect(approvedDcTotal(dcs, 'b1')).toBe(80)
    expect(approvedDcTotal(dcs)).toBe(87)
    expect(signedDcAmount({ amount: '20', is_credit: true })).toBe(-20)
  })
})

describe('commitments (item 11) — same code as commercial committedForItem', () => {
  const contracts = [
    { id: 'c1', contract_value: 1000, budget_allocations: [{ budget_item_id: 'b1', amount: 300 }, { budget_item_id: 'b2', amount: 100 }] },
    { id: 'c2', contract_value: 500, budget_item_id: 'b2' },
    { id: 'c3', contract_value: 50 }, // unlinked
  ]
  const subCOs = [
    { subcontract_id: 'c1', status: 'approved', amount: 400 },                                       // split 3:1
    { subcontract_id: 'c2', status: 'approved', amount: 60, sov: [{ budget_item_id: 'b1', amount: 60 }] }, // explicit line
    { subcontract_id: 'c2', status: 'rejected', amount: 999 },
    { subcontract_id: 'c2', status: 'pending', amount: 888 },
  ]
  const lines = [{ id: 'b1' }, { id: 'b2' }]
  test('split allocations and approved sub COs, rejected/pending ignored', () => {
    expect(contractCommittedForItem(contracts, subCOs, 'b1')).toBeCloseTo(750 + 300 + 60)
    expect(contractCommittedForItem(contracts, subCOs, 'b2')).toBeCloseTo(250 + 100 + 500)
  })
  test('total = sum of lines (no double count); unlinked contract flagged, not counted', () => {
    expect(committedTotalForLines(contracts, subCOs, lines)).toBeCloseTo(1110 + 850)
    expect(unlinkedContracts(contracts).map(c => c.id)).toEqual(['c3'])
  })
  test('contract revised value adds approved sub COs only; homeowner contract unaffected', () => {
    expect(contractRevisedValue(contracts[1], subCOs)).toBe(560)
    expect(revisedContract({ contract_value: 1000 }, [{ status: 'approved', amount: 50 }, { status: 'pending', amount: 9 }])).toBe(1050)
  })
  test('commercial page uses the shared function', () => {
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'app/jobdetail/page.js'), 'utf8')
    expect(src).toContain('const contractCommitted = contractCommittedForItem(contracts, allCOs, budgetItemId)')
  })
})

describe('owner/lender draw funding (item 10, 15)', () => {
  test('1000 requested / 800 funded shows 800 cash and 200 variance', () => {
    const f = ownerDrawFunding([{ status: 'funded', amount_requested: 1000, amount_funded: 800 }])
    expect(f).toMatchObject({ requested: 1000, fundedKnown: 800, unknownFunded: 0, variance: 200 })
    expect(pctFunded(f, 10000)).toBeCloseTo(8)
  })
  test('legacy funded row (no amount_funded) is unknown — never assumed = requested', () => {
    const d = { status: 'funded', amount_requested: 1000, amount_funded: null }
    expect(drawFundedAmount(d)).toBeNull()
    const f = ownerDrawFunding([d, { status: 'submitted', amount_requested: 500 }])
    expect(f).toMatchObject({ requested: 1500, fundedKnown: 0, unknownFunded: 1, variance: 0 })
    expect(pctFunded(f, 5000)).toBeNull()
  })
  test('drafts and void excluded from requested; no denominator → null', () => {
    const f = ownerDrawFunding([{ status: 'draft', amount_requested: 300 }, { status: 'void', amount_requested: 700 }])
    expect(f.requested).toBe(0)
    expect(f.drafts).toBe(300)
    expect(pctFunded(f, 0)).toBeNull()
  })
})

describe('Bank-line schedule (item 10)', () => {
  const lines = [{ id: 'b1', description: 'Framing', budget_amount: 900, owner_amount: 1000 }, { id: 'b2', description: 'Roof', budget_amount: 333.33, owner_amount: null }]
  const draws = [
    { id: 'd1', draw_number: 1, status: 'funded', schedule_lines: [{ budget_item_id: 'b1', this_period: 250.105 }] },
    { id: 'd2', draw_number: 2, status: 'submitted', schedule_lines: [{ budget_item_id: 'b1', this_period: 100 }, { budget_item_id: 'b2', this_period: 33.33 }] },
    { id: 'd3', draw_number: 3, status: 'draft', schedule_lines: [{ budget_item_id: 'b1', this_period: 999 }] },
    { id: 'd4', draw_number: 4, status: 'void', schedule_lines: [{ budget_item_id: 'b1', this_period: 999 }] },
  ]
  test('previous carries forward from earlier non-draft, non-void draws only', () => {
    expect(priorDrawnByLine(draws, { excludeId: 'd3', drawNumber: 3 })).toEqual({ b1: 350.11, b2: 33.33 })
    expect(priorDrawnByLine(draws, { excludeId: 'd2', drawNumber: 2 })).toEqual({ b1: 250.11 })
  })
  test('rows: scheduled (Bank, falls back to Cost), total, %, balance; totals rounded to cents', () => {
    const { rows, totals } = buildDrawSchedule(lines, { b1: 350.11 }, { b1: 49.89, b2: 0.1 })
    expect(rows[0]).toMatchObject({ scheduled: 1000, previous: 350.11, this_period: 49.89, total: 400, balance: 600 })
    expect(rows[0].pct).toBeCloseTo(40)
    expect(rows[1]).toMatchObject({ scheduled: 333.33, total: 0.1, balance: 333.23 })
    expect(totals).toMatchObject({ scheduled: 1333.33, this_period: 49.99, total: 400.1 })
  })
  test('server validation: foreign / duplicate lines and a sum ≠ requested are rejected', () => {
    expect(validateDrawLines([{ budget_item_id: 'other-job-line', this_period: 5 }], lines, 5).error).toMatch(/not a budget line on this job/)
    expect(validateDrawLines([{ budget_item_id: 'b1', this_period: 5 }, { budget_item_id: 'b1', this_period: 5 }], lines, 10).error).toMatch(/twice/)
    expect(validateDrawLines([{ budget_item_id: 'b1', this_period: 'abc' }], lines, 5).error).toMatch(/number/)
    expect(validateDrawLines([{ budget_item_id: 'b1', this_period: 600 }], lines, 500).error).toMatch(/total \$600\.00 but the amount requested is \$500\.00/)
    const ok = validateDrawLines([{ budget_item_id: 'b1', this_period: '100.005' }, { budget_item_id: 'b2', this_period: 0 }], lines, 100.01)
    expect(ok.lines).toEqual([{ budget_item_id: 'b1', description: 'Framing', scheduled_value: 1000, this_period: 100.01 }])
  })
  test('status rules: only draft editable; void final; funded not voidable', () => {
    expect(isDrawEditable({ status: 'draft' })).toBe(true)
    expect(isDrawEditable({ status: 'submitted' })).toBe(false)
    expect(drawStatusChangeError('draft', 'submitted')).toBeNull()
    expect(drawStatusChangeError('submitted', 'approved')).toBeNull()
    expect(drawStatusChangeError('funded', 'void')).toMatch(/can't/)
    expect(drawStatusChangeError('void', 'draft')).toMatch(/can't/)
    expect(drawStatusChangeError('draft', 'paid')).toMatch(/Unknown/)
  })
  test('attachments only inside the draw folder of its job', () => {
    expect(drawAttachmentPathOk('JOB1/owner-draws/d1/123-inv.pdf', 'job1', 'd1')).toBe(true)
    expect(drawAttachmentPathOk('job2/owner-draws/d1/x.pdf', 'job1', 'd1')).toBe(false)
    expect(drawAttachmentPathOk('job1/owner-draws/d1/../../x.pdf', 'job1', 'd1')).toBe(false)
    expect(drawAttachmentPathOk('job1/owner-draws/d2/x.pdf', 'job1', 'd1')).toBe(false)
  })
})
