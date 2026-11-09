/**
 * Prompt63: Business Dev job profit uses revised subcontract amounts and every row.
 *
 * - Revised amounts (adjusted_contract_value) come from the subcontract_summary view, merged
 *   by id onto base subcontracts rows (which keep job_id / budget_item_id / contract_value).
 * - Every read's error returns 500, never { profits } with subcontracts / costs left out.
 * - budget_items, approved direct_costs, subcontracts and subcontract_summary are paged.
 *
 * The mock behaves like PostgREST: it returns only the selected columns, errors (42703) on a
 * column the relation does not have, honors .range() / .limit() by slicing, and caps any
 * response at 1,000 rows.
 */

const JOB = '8ae26b84-c4df-4a75-a466-48ee7bed9f0c'
const JOB2 = '11111111-2222-3333-4444-555555555555'
const MAX_ROWS = 1000

// Live columns (see LIVE SCHEMA): the base table has no revised-amount columns; the view
// has no budget_item_id / budget_allocations / vendor_name.
const SCHEMA = {
  jobs: ['id', 'contract_value', 'project_name'],
  budget_items: ['id', 'job_id', 'budget_amount', 'owner_amount', 'forecast_eac', 'cost_code', 'description'],
  direct_costs: ['id', 'job_id', 'budget_item_id', 'amount', 'status'],
  subcontracts: ['id', 'job_id', 'sub_id', 'contract_value', 'description', 'status', 'budget_item_id', 'vendor_name', 'budget_allocations'],
  subcontract_summary: ['id', 'job_id', 'sub_id', 'contract_value', 'description', 'onedrive_url', 'status', 'created_at', 'approved_change_orders', 'adjusted_contract_value', 'remaining_balance'],
}

let db, selects, failWith, mockAuth

function mockQuery(table) {
  const filters = []
  let cols = ''
  let rangeArgs = null
  let limitN = null
  const run = () => {
    const forced = failWith && failWith(table, rangeArgs)
    if (forced) return { data: null, error: forced }
    if (!SCHEMA[table]) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
    const wanted = cols.split(',').map(c => c.trim()).filter(Boolean)
    const missing = wanted.find(c => !SCHEMA[table].includes(c))
    if (missing) return { data: null, error: { code: '42703', message: `column ${table}.${missing} does not exist` } }
    let rows = (db[table] || []).filter(r => filters.every(f => f(r)))
    if (rangeArgs) rows = rows.slice(rangeArgs[0], rangeArgs[1] + 1)
    if (limitN != null) rows = rows.slice(0, limitN)
    rows = rows.slice(0, MAX_ROWS)
    return { data: rows.map(r => Object.fromEntries(wanted.map(c => [c, r[c] ?? null]))), error: null }
  }
  const q = {
    select: c => { cols = c; selects.push({ table, cols: c }); return q },
    order: () => q,
    limit: n => { limitN = n; return q },
    range: (a, b) => { rangeArgs = [a, b]; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: t => mockQuery(t) }) }))
jest.mock('../lib/server-auth', () => {
  const actual = jest.requireActual('../lib/server-auth')
  return { ...actual, requirePM: async () => (actual.isPM(mockAuth.role) ? mockAuth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }) }
})

const route = require('../app/api/job-profit/route')

const post = job_ids => route.POST(new Request('http://x/api/job-profit', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_ids }),
}))
const as = role => { mockAuth = { userId: 'u1', email: 'me@nv.co', role, error: null } }

const baseDb = () => ({
  jobs: [{ id: JOB, contract_value: 50000 }],
  budget_items: [{ id: 'b1', job_id: JOB, budget_amount: 10000, owner_amount: 10000, forecast_eac: null, cost_code: '0100', description: 'Framing' }],
  direct_costs: [],
  // A decoy revised amount on the base row: a real select of it errors (column missing);
  // a mock that ignored the schema would hand back 77,777 instead of the view's 33,000.
  subcontracts: [{ id: 'sc1', job_id: JOB, budget_item_id: 'b1', contract_value: 30000, adjusted_contract_value: 77777, approved_change_orders: 47777 }],
  subcontract_summary: [{ id: 'sc1', job_id: JOB, contract_value: 30000, approved_change_orders: 3000, adjusted_contract_value: 33000 }],
})

beforeEach(() => {
  selects = []
  failWith = null
  db = baseDb()
  as('principal')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => console.error.mockRestore())

describe('revised subcontract amounts', () => {
  test('line uses summary adjusted 33,000 in EAC (not 30,000, not budget-only 10,000, not decoy)', async () => {
    const res = await post([JOB])
    expect(res.status).toBe(200)
    const { profits } = await res.json()
    expect(profits[JOB]).toEqual({
      contract_value: 50000, eac: 33000, projected_profit: 17000, margin_pct: 34, has_budget: true, unassigned_cost: 0,
    })
  })

  test('revised columns are selected from subcontract_summary, never from subcontracts', async () => {
    await post([JOB])
    const base = selects.filter(s => s.table === 'subcontracts')
    const view = selects.filter(s => s.table === 'subcontract_summary')
    expect(base.length).toBeGreaterThan(0)
    expect(view.length).toBeGreaterThan(0)
    for (const s of base) {
      expect(s.cols).not.toMatch(/adjusted_contract_value|approved_change_orders/)
      expect(s.cols).toMatch(/budget_item_id/)
    }
    expect(view.every(s => /adjusted_contract_value/.test(s.cols))).toBe(true)
    // Only known relations are read (no misspelled view name).
    expect(selects.every(s => SCHEMA[s.table])).toBe(true)
  })

  test('selecting revised columns from the base table fails (mock enforces live schema)', async () => {
    const r = await mockQuery('subcontracts').select('job_id, budget_item_id, contract_value, approved_change_orders, adjusted_contract_value').in('job_id', [JOB])
    expect(r.error).toMatchObject({ code: '42703' })
  })

  test('no summary row: falls back to contract_value 30,000', async () => {
    db.subcontract_summary = []
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].eac).toBe(30000)
    expect(profits[JOB].projected_profit).toBe(20000)
  })

  test('unassigned contract uses the revised amount in the unassigned bucket', async () => {
    db.subcontracts[0].budget_item_id = null
    const { profits } = await (await post([JOB])).json()
    // Line falls back to budget 10,000; unassigned commitment 33,000.
    expect(profits[JOB].unassigned_cost).toBe(33000)
    expect(profits[JOB].eac).toBe(43000)
  })

  test('profit line and forecast_eac behave as before', async () => {
    db.budget_items.push({ id: 'b2', job_id: JOB, budget_amount: 5000, owner_amount: 5000, forecast_eac: null, cost_code: '1111', description: 'Profit' })
    db.budget_items.push({ id: 'b3', job_id: JOB, budget_amount: 2000, owner_amount: 2000, forecast_eac: 2500, cost_code: '0200', description: 'Paint' })
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].eac).toBe(33000 + 2500)
  })
})

describe('failed reads return 500, not partial profits', () => {
  test.each(['subcontract_summary', 'subcontracts', 'budget_items', 'direct_costs', 'jobs'])('%s errors → 500', async table => {
    failWith = t => (t === table ? { code: 'XX000', message: 'connection reset' } : null)
    const res = await post([JOB])
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.profits).toBeUndefined()
    expect(body.error).toMatch(/could not load/i)
  })

  test('a later page erroring → 500 (not the first page as the total)', async () => {
    db.direct_costs = Array.from({ length: 1500 }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, job_id: JOB, budget_item_id: 'b1', amount: 10, status: 'approved' }))
    failWith = (t, range) => (t === 'direct_costs' && range && range[0] >= 1000 ? { code: 'XX000', message: 'timeout' } : null)
    expect((await post([JOB])).status).toBe(500)
  })
})

describe('paging past 1,000 rows', () => {
  test('2,500 approved costs across two jobs are all counted', async () => {
    db.jobs.push({ id: JOB2, contract_value: 100000 })
    db.budget_items.push({ id: 'b9', job_id: JOB2, budget_amount: 0, owner_amount: 0, forecast_eac: null, cost_code: '0100', description: 'Site' })
    db.subcontracts = []
    db.subcontract_summary = []
    db.direct_costs = [
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `a${String(i).padStart(5, '0')}`, job_id: JOB, budget_item_id: 'b1', amount: 10, status: 'approved' })),
      ...Array.from({ length: 1300 }, (_, i) => ({ id: `b${String(i).padStart(5, '0')}`, job_id: JOB2, budget_item_id: 'b9', amount: 20, status: 'approved' })),
      { id: 'zz-pending', job_id: JOB, budget_item_id: 'b1', amount: 99999, status: 'pending' },
    ]
    const { profits } = await (await post([JOB, JOB2])).json()
    expect(profits[JOB].eac).toBe(12000)            // 1,200 × 10 > budget 10,000
    expect(profits[JOB2].eac).toBe(26000)           // 1,300 × 20
    expect(profits[JOB2].projected_profit).toBe(74000)
    const costReads = selects.filter(s => s.table === 'direct_costs')
    expect(costReads.length).toBe(3)                // pages 0, 1000, 2000
  })

  test('1,200 budget lines are all counted (revenue and EAC)', async () => {
    db.jobs = [{ id: JOB, contract_value: 0 }]       // revenue from summed owner_amount
    db.subcontracts = []
    db.subcontract_summary = []
    db.budget_items = Array.from({ length: 1200 }, (_, i) => ({ id: `l${String(i).padStart(5, '0')}`, job_id: JOB, budget_amount: 100, owner_amount: 150, forecast_eac: null, cost_code: '0100', description: 'Line' }))
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].contract_value).toBe(180000)
    expect(profits[JOB].eac).toBe(120000)
    expect(profits[JOB].projected_profit).toBe(60000)
  })

  test('1,100 subcontracts and summary rows are all merged', async () => {
    db.subcontracts = Array.from({ length: 1100 }, (_, i) => ({ id: `s${String(i).padStart(5, '0')}`, job_id: JOB, budget_item_id: null, contract_value: 100 }))
    db.subcontract_summary = db.subcontracts.map(s => ({ id: s.id, job_id: JOB, adjusted_contract_value: 110 }))
    const { profits } = await (await post([JOB])).json()
    expect(profits[JOB].unassigned_cost).toBe(121000)
  })
})

describe('Owner-only', () => {
  test.each(['pm', 'apm', 'super', 'admin'])('%s → 403', async role => {
    as(role)
    expect((await post([JOB])).status).toBe(403)
    expect(selects).toEqual([])
  })
  test('principal with job_ids: [] → 200', async () => {
    const res = await post([])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profits: {} })
  })
})
