/**
 * Prompt 67A #8: EAC Forecast.
 * - Auto EAC = max(budget, committed, spent): unbought scope is not savings.
 * - The job page and /api/job-profit (Business Dev) use the same lib/eac-forecast.js.
 * - Tabbing through the EAC input saves nothing; saveForecastEac checks the response.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requirePM: async () => (mockState.auth && PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})

const {
  committedForBudgetLine, spentForBudgetLine, autoEacForLine, eacForLine, jobEacSummary,
  laborCostForLine, contractCommittedForLine, eacBlurAction,
} = require('../lib/eac-forecast')
const jobProfit = require('../app/api/job-profit/route')

describe('lib/eac-forecast', () => {
  const line = { id: 'b1', budget_amount: 50000, owner_amount: 60000, forecast_eac: null, cost_code: '0100', description: 'Framing' }

  test('$50,000 line with one $1,200 cost → auto EAC $50,000 (not $1,200)', () => {
    const directCosts = [{ id: 'd1', budget_item_id: 'b1', amount: 1200, status: 'approved' }]
    const { rows } = jobEacSummary({ items: [line], directCosts })
    expect(rows[0].committed).toBe(1200)
    expect(rows[0].spent).toBe(1200)
    expect(rows[0].autoEac).toBe(50000)
    expect(rows[0].eac).toBe(50000)
    expect(rows[0].variance).toBe(0)
    expect(rows[0].projProfit).toBe(10000)
  })

  test('committed above budget → committed', () => {
    const contracts = [{ id: 'c1', budget_item_id: 'b1', contract_value: 62000 }]
    const { rows } = jobEacSummary({ items: [line], contracts })
    expect(rows[0].autoEac).toBe(62000)
    expect(rows[0].variance).toBe(-12000)
  })

  test('spent above both → spent', () => {
    expect(autoEacForLine({ budget: 100, committed: 50, spent: 200 })).toBe(200)
    expect(autoEacForLine({ budget: 100, committed: 150, spent: 120 })).toBe(150)
    expect(autoEacForLine({ budget: 100, committed: 10, spent: 20 })).toBe(100)
    // bought out (no flag in the schema yet) → budget ignored
    expect(autoEacForLine({ budget: 100, committed: 10, spent: 20, boughtOut: true })).toBe(20)
  })

  test('credit subtracts (is_credit or negative amount); pending ignored', () => {
    const costs = [
      { budget_item_id: 'b1', amount: 1000, status: 'approved' },
      { budget_item_id: 'b1', amount: 200, is_credit: true, status: 'approved' },
      { budget_item_id: 'b1', amount: -50, status: 'approved' },
      { budget_item_id: 'b1', amount: 999, status: 'pending' },
    ]
    expect(spentForBudgetLine(costs, 'b1')).toBe(750)
    expect(committedForBudgetLine({ itemId: 'b1', directCosts: costs })).toBe(750)
  })

  test('allocations split a contract across lines; approved COs follow the split', () => {
    const contracts = [{ id: 'c1', contract_value: 10000, budget_allocations: [{ budget_item_id: 'b1', amount: 3000 }, { budget_item_id: 'b2', amount: 1000 }] }]
    const cos = [{ subcontract_id: 'c1', status: 'approved', amount: 400 }, { subcontract_id: 'c1', status: 'pending', amount: 9999 }]
    expect(contractCommittedForLine(contracts, cos, 'b1')).toBeCloseTo(7500 + 300)
    expect(contractCommittedForLine(contracts, cos, 'b2')).toBeCloseTo(2500 + 100)
  })

  test('revised amount not explained by loaded COs is spread by the allocation (prompt63 revised values)', () => {
    const contracts = [{ id: 'c1', contract_value: 10000, adjusted_contract_value: 10800, budget_allocations: [{ budget_item_id: 'b1', amount: 3 }, { budget_item_id: 'b2', amount: 1 }] }]
    expect(contractCommittedForLine(contracts, [], 'b1')).toBeCloseTo(8100)
    expect(contractCommittedForLine(contracts, [], 'b2')).toBeCloseTo(2700)
    // COs loaded and matching the view → nothing extra
    const cos = [{ subcontract_id: 'c1', status: 'approved', amount: 800 }]
    expect(contractCommittedForLine(contracts, cos, 'b1')).toBeCloseTo(8100)
  })

  test('override wins', () => {
    expect(eacForLine({ forecast_eac: 1234 }, 50000)).toBe(1234)
    expect(eacForLine({ forecast_eac: 0 }, 50000)).toBe(0)
    expect(eacForLine({ forecast_eac: null }, 50000)).toBe(50000)
    const { rows } = jobEacSummary({ items: [{ ...line, forecast_eac: 45000 }] })
    expect(rows[0]).toMatchObject({ autoEac: 50000, eac: 45000, variance: 5000 })
  })

  test('labor: pm_allocation × weekly rate × % × days, injectable now; budget_line text match', () => {
    const emp = { weekly_salary: 700, weekly_truck: 0, weekly_healthcare: 0, weekly_taxes: 0 }
    const allocs = [
      { allocation_type: 'pm_allocation', budget_item_id: 'b1', percentage: 50, start_date: '2026-10-01', end_date: null, employees: emp },
      { allocation_type: 'pm_allocation', budget_item_id: null, budget_line: '0100 — Framing', percentage: null, start_date: '2026-10-01', end_date: '2026-10-08', employees: emp },
      { allocation_type: 'other', budget_item_id: 'b1', start_date: '2026-10-01', employees: emp },
    ]
    const now = new Date('2026-10-15T00:00:00')
    // 700 × 50% × 14/7 = 700 ; 700 × 100% × 7/7 = 700
    expect(laborCostForLine(allocs, line, now)).toBeCloseTo(1400)
  })

  test('profit line is revenue only; totals', () => {
    const items = [line, { id: 'p', budget_amount: 5000, owner_amount: null, cost_code: '1111', description: 'Profit' }]
    const { rows, totals } = jobEacSummary({ items })
    expect(rows[1]).toMatchObject({ profit: true, variance: null, projProfit: 5000 })
    expect(totals).toMatchObject({ revenue: 65000, costEac: 50000, eac: 55000, projProfit: 15000, variance: 0 })
  })

  test('eacBlurAction: tab-through saves nothing; equal-to-auto clears an override; empty clears; junk reverts', () => {
    expect(eacBlurAction({ shown: '50000', typed: '50000', hasOverride: false, autoEac: 50000.4 })).toEqual({ save: false })
    expect(eacBlurAction({ shown: '45000', typed: '45000', hasOverride: true, autoEac: 50000 })).toEqual({ save: false })
    expect(eacBlurAction({ shown: '50000', typed: '48000', hasOverride: false, autoEac: 50000 })).toEqual({ save: true, value: 48000 })
    expect(eacBlurAction({ shown: '45000', typed: '50000', hasOverride: true, autoEac: 50000.4 })).toEqual({ save: true, value: null })
    expect(eacBlurAction({ shown: '45000', typed: '', hasOverride: true, autoEac: 50000 })).toEqual({ save: true, value: null })
    expect(eacBlurAction({ shown: '50000', typed: '', hasOverride: false, autoEac: 50000 })).toEqual({ save: false })
    expect(eacBlurAction({ shown: '50000', typed: 'abc', hasOverride: false, autoEac: 50000 })).toEqual({ save: false, revert: true })
  })
})

// ── /api/job-profit matches the job page ────────────────────────────────────
const JOB = 'job-eac'
const EMP = { weekly_salary: 1000, weekly_truck: 0, weekly_healthcare: 0, weekly_taxes: 0 }
function fixture() {
  return {
    jobs: [{ id: JOB, contract_value: 0 }],
    budget_items: [
      { id: 'b1', job_id: JOB, budget_amount: 50000, owner_amount: 60000, forecast_eac: null, cost_code: '0100', description: 'Framing' },
      { id: 'b2', job_id: JOB, budget_amount: 15000, owner_amount: 22000, forecast_eac: null, cost_code: '0200', description: 'Electrical' },
      { id: 'b3', job_id: JOB, budget_amount: 5000, owner_amount: 5000, forecast_eac: null, cost_code: '1111', description: 'Profit' },
      { id: 'b4', job_id: JOB, budget_amount: 3000, owner_amount: null, forecast_eac: 4000, cost_code: '0300', description: 'Paint' },
    ],
    direct_costs: [
      { id: 'd1', job_id: JOB, budget_item_id: 'b1', amount: 1200, status: 'approved', is_credit: false },
      { id: 'd2', job_id: JOB, budget_item_id: 'b1', amount: 300, status: 'approved', is_credit: true },
      { id: 'd3', job_id: JOB, budget_item_id: 'b2', amount: 999, status: 'pending', is_credit: false },
    ],
    subcontracts: [
      { id: 'sc1', job_id: JOB, budget_item_id: null, contract_value: 40000, status: 'active', budget_allocations: [{ budget_item_id: 'b1', amount: 30000 }, { budget_item_id: 'b2', amount: 10000 }] },
      // Draft with no explicit allocations: its SOV lines put it on b2 (as on the job page).
      { id: 'sc2', job_id: JOB, budget_item_id: null, contract_value: 5000, status: 'draft', budget_allocations: null },
    ],
    subcontract_summary: [
      { id: 'sc1', job_id: JOB, contract_value: 40000, adjusted_contract_value: 41000 },
      { id: 'sc2', job_id: JOB, contract_value: 5000, adjusted_contract_value: 5000 },
    ],
    subcontract_sov_lines: [
      { id: 'sv1', subcontract_id: 'sc2', budget_item_id: 'b2', scheduled_value: 5000 },
      { id: 'sv2', subcontract_id: 'sc2', budget_item_id: null, scheduled_value: 123 },
    ],
    change_orders: [
      { id: 'co1', subcontract_id: 'sc1', status: 'approved', amount: 1000, sov: null },
      { id: 'co2', subcontract_id: 'sc1', status: 'pending', amount: 9999, sov: null },
    ],
    purchase_orders: [
      { id: 'po1', job_id: JOB, budget_item_id: 'b1', amount: 2500, status: 'issued' },
      { id: 'po2', job_id: JOB, budget_item_id: 'b1', amount: 7777, status: 'draft' },
    ],
    employee_job_allocations: [
      { id: 'a1', job_id: JOB, allocation_type: 'pm_allocation', budget_item_id: 'b2', budget_line: null, percentage: 50, start_date: '2026-10-01', end_date: '2026-10-29', employees: EMP },
    ],
  }
}
const post = job_ids => jobProfit.POST(new Request('http://x/api/job-profit', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_ids }),
}))

describe('/api/job-profit uses the same EAC as the job page', () => {
  beforeEach(() => {
    resetMockState(fixture())
    mockState.auth = { userId: 'o1', email: 'owner@nv.co', role: 'principal', error: null }
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => console.error.mockRestore())

  test('allocations, SOV-derived allocations, approved CO, PO, labor and a credit', async () => {
    const res = await post([JOB])
    expect(res.status).toBe(200)
    const { profits } = await res.json()

    // What the job page computes (contracts merged like loadContracts: SOV lines → allocations).
    const db = fixture()
    const contracts = db.subcontracts.map(c => ({
      ...c,
      budget_allocations: c.budget_allocations?.length ? c.budget_allocations : (c.id === 'sc2' ? [{ budget_item_id: 'b2', amount: 5000 }] : []),
      adjusted_contract_value: db.subcontract_summary.find(s => s.id === c.id).adjusted_contract_value,
    }))
    const { totals } = jobEacSummary({
      items: db.budget_items, contracts, subCOs: db.change_orders, directCosts: db.direct_costs,
      purchaseOrders: db.purchase_orders, allocations: db.employee_job_allocations,
    })
    // b1: max(50,000, 30,750 + 2,500 PO + 900 DC) = 50,000 ; b2: 10,250 + 5,000 + 2,000 labor = 17,250 > 15,000
    // b3 profit (revenue only) ; b4 override 4,000
    expect(totals.costEac).toBeCloseTo(50000 + 17250 + 4000)
    expect(totals.projProfit).toBeCloseTo(90000 - 71250)

    expect(profits[JOB]).toEqual({
      contract_value: 90000,
      eac: Math.round(totals.costEac),
      projected_profit: Math.round(totals.projProfit),
      margin_pct: Math.round(totals.projProfit / 90000 * 100),
      has_budget: true,
      unassigned_cost: 0,
    })
  })

  test('unassigned costs and contracts still count against profit', async () => {
    mockState.db.direct_costs.push({ id: 'd9', job_id: JOB, budget_item_id: null, amount: 800, status: 'approved' })
    mockState.db.subcontracts.push({ id: 'sc9', job_id: JOB, budget_item_id: null, contract_value: 600, status: 'active', budget_allocations: [] })
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].unassigned_cost).toBe(800)
    expect(profits[JOB].eac).toBe(71250 + 800)
  })

  test('only approved COs and issued/received POs are read', async () => {
    await post([JOB])
    // Pending CO (9,999) and draft PO (7,777) would push b1/b2 far above the numbers above.
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].eac).toBe(71250)
  })

  test('non-principal → 403, nothing read', async () => {
    mockState.auth = { userId: 'p1', email: 'pm@nv.co', role: 'pm', error: null }
    const res = await post([JOB])
    expect(res.status).toBe(403)
  })

  test.each(['budget_items', 'direct_costs', 'subcontracts', 'subcontract_summary', 'jobs', 'purchase_orders', 'employee_job_allocations', 'change_orders', 'subcontract_sov_lines'])(
    '%s read fails → 500', async table => {
      mockState.failSelect[table] = 'connection reset'
      const res = await post([JOB])
      expect(res.status).toBe(500)
      expect((await res.json()).profits).toBeUndefined()
    })

  test('a table that does not exist yet reads as empty (no 500)', async () => {
    mockState.failSelect.purchase_orders = "Could not find the table 'public.purchase_orders' in the schema cache"
    const res = await post([JOB])
    expect(res.status).toBe(200)
  })
})

describe('job page source', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app/jobdetail/page.js'), 'utf8')

  test('EAC input onBlur no longer saves unconditionally', () => {
    expect(src).not.toContain("onBlur={e => saveForecastEac(item.id, e.target.value === '' ? '' : e.target.value)}")
    const i = src.indexOf('e.target.dataset.shown = e.target.value')
    expect(i).toBeGreaterThan(0)
    const blur = src.slice(i, i + 1200)
    expect(blur).toContain('eacBlurAction(')
    expect(blur).toContain('if (act.save) saveForecastEac(')
  })

  test('saveForecastEac checks the response before updating local state', () => {
    const start = src.indexOf('async function saveForecastEac(')
    const body = src.slice(start, src.indexOf('\n  }\n', start))
    expect(body).toMatch(/res\.ok/)
    expect(body).toMatch(/json\.error/)
    expect(body).toMatch(/setErrMsg\(/)
    expect(body.indexOf('if (errText)')).toBeLessThan(body.lastIndexOf('forecast_eac: val'))
  })

  test('EAC view uses the shared lib and the new copy', () => {
    expect(src).toContain("from '../../lib/eac-forecast'")
    expect(src).toContain('jobEacSummary({')
    expect(src).toContain('The auto EAC is the larger of the budget, committed')
    expect(src).not.toContain('const autoEac = totalActual > 0 ? totalActual : Number(item.budget_amount)')
  })
})
