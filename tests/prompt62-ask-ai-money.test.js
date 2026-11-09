/**
 * Prompt 62: Ask AI money numbers. The system prompt's owner billing comes from prime
 * AIA pay apps (commercial) or res_owner_draws (residential), never sub billing; owner COs
 * come from prime_change_orders; direct-cost totals use every row; committed uses revised
 * subcontract values. No Gemini / network: the builder is pure, and the route test mocks
 * Supabase and fetch.
 */
import { buildSystemPrompt, fmt, RECENT_COST_SAMPLE } from '../lib/ask-ai-context'
import { ownerPayApps } from '../lib/owner-pay-apps'
import { revisedContract } from '../lib/residential-money'

const JOB_ID = 'job-1'
const section = (prompt, heading) => {
  const start = prompt.indexOf(heading)
  if (start < 0) return ''
  const rest = prompt.slice(start)
  const end = rest.indexOf('\n\n')
  return end < 0 ? rest : rest.slice(0, end)
}

// ── 1. Commercial owner billing ───────────────────────────────────────────────
describe('commercial owner billing = prime AIA pay apps', () => {
  const job = { project_name: 'Plaza', job_type: 'commercial', contract_value: 500000 }
  const budgetItems = [{ id: 'b1', description: 'Sitework', budget_amount: 100000, owner_amount: 100000 }]
  const primeApps = [
    { id: 'a1', job_id: JOB_ID, app_number: 1, status: 'approved', retainage_pct: 0, nv_subcontract_id: null, amount_received: 12000 },
    { id: 'a2', job_id: JOB_ID, app_number: 2, status: 'draft', retainage_pct: 0, nv_subcontract_id: null },
  ]
  const primeLinesByApp = {
    a1: [{ application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 12000 }],
    a2: [{ application_id: 'a2', budget_item_id: 'b1', dollar_this_period: 7000 }],
  }
  const billings = [{ id: 's1', amount_billed: 50000, status: 'approved', sub_id: 'x' }]
  const prompt = buildSystemPrompt({ job, budgetItems, primeApps, primeLinesByApp, billings })
  const expected = ownerPayApps({ apps: primeApps, linesByApp: primeLinesByApp, budgetItems }).billed_to_date

  test('owner billed equals ownerPayApps billed_to_date, not sub billing', () => {
    expect(expected).toBe(12000)
    const owner = section(prompt, 'OWNER BILLING')
    expect(owner).toContain(`billed ${fmt(expected)} to date`)
    expect(owner).not.toContain('$50,000')
    expect(owner).toContain('Pay App #1 [approved]')
    expect(owner).toContain('current payment due $12,000')
    expect(owner).not.toContain('Pay App #2') // draft left out
    expect(owner).toContain('Received from owner')
  })
  test('the $50k sub invoice is labeled sub billing', () => {
    expect(section(prompt, 'SUB BILLING')).toContain('approved $50,000')
    expect(prompt).not.toMatch(/OWNER BILLING — approved/)
  })
  test('unknown job_type is treated as commercial', () => {
    const p = buildSystemPrompt({ job: { ...job, job_type: null }, budgetItems, primeApps, primeLinesByApp, billings })
    expect(section(p, 'OWNER BILLING')).toContain('prime AIA pay apps')
  })
})

// ── 2. Residential owner billing ──────────────────────────────────────────────
describe('residential owner billing = res_owner_draws', () => {
  const job = { project_name: 'House', job_type: 'residential', contract_value: 300000 }
  const resDraws = [
    { id: 'd1', draw_number: 1, status: 'funded', amount_requested: 40000, amount_funded: 39000 },
    { id: 'd2', draw_number: 2, status: 'funded', amount_requested: 25000, amount_funded: null },
    { id: 'd3', draw_number: 3, status: 'submitted', amount_requested: 15000 },
    { id: 'd4', draw_number: 4, status: 'draft', amount_requested: 9000 },
    { id: 'd5', draw_number: 5, status: 'void', amount_requested: 8000 },
  ]
  const billings = [{ id: 's1', amount_billed: 50000, status: 'approved' }]
  // Internal draw_requests and AIA apps are never passed / used for residential.
  const primeApps = [{ id: 'a1', job_id: JOB_ID, app_number: 1, status: 'approved', nv_subcontract_id: null }]
  const prompt = buildSystemPrompt({ job, resDraws, billings, primeApps })
  const owner = section(prompt, 'OWNER BILLING')

  test('requested excludes drafts and voids', () => {
    expect(owner).toContain('requested $80,000 to date')
  })
  test('funded draw with no amount_funded is unknown, not its requested amount', () => {
    expect(owner).toContain('received $39,000 known')
    expect(owner).toMatch(/1 funded draw with the funded amount NOT recorded/)
    expect(owner).toContain('Draw 2 [funded]: requested $25,000, received UNKNOWN')
    expect(owner).not.toContain('received $25,000')
    expect(owner).not.toContain('received $64,000')
  })
  test('drafts listed separately, not as submitted draws', () => {
    expect(owner).toContain('1 draft draw ($9,000) not yet submitted')
    expect(owner).not.toContain('Draw 4')
    expect(owner).not.toContain('Draw 5')
  })
  test('sub billing and AIA apps are not the owner figure', () => {
    expect(owner).not.toContain('$50,000')
    expect(owner).not.toContain('Pay App')
  })
})

// ── 3. Owner (prime) vs sub change orders ─────────────────────────────────────
describe('change orders', () => {
  const job = { project_name: 'Plaza', job_type: 'commercial', contract_value: 100000, approved_change_orders: 99999 }
  const primeChangeOrders = [
    { id: 'p1', co_number: 1, description: 'Owner adds canopy', amount: 15000, status: 'approved' },
    { id: 'p2', co_number: null, description: 'Owner pending', amount: 4000, status: 'pending' },
  ]
  const changeOrders = [
    { description: 'Sub asks for rock', amount: 3000, status: 'pending', direction: 'sub_to_pm' },
    { description: 'Add scope to sub', amount: 2000, status: 'approved', direction: 'pm_to_sub' },
    { description: 'Odd row', amount: 100, status: 'approved', direction: 'weird' },
  ]
  const prompt = buildSystemPrompt({ job, primeChangeOrders, changeOrders })

  test('prime COs in their own owner section', () => {
    const owner = section(prompt, 'OWNER / PRIME CHANGE ORDERS')
    expect(owner).toContain('PCO-001 Owner adds canopy: $15,000 [approved]')
    expect(owner).toContain('Owner pending: $4,000 [pending]')
    expect(owner).not.toContain('Sub asks for rock')
  })
  test('sub COs labeled by direction, never "(from owner)"', () => {
    const sub = section(prompt, 'SUB CHANGE ORDERS')
    expect(sub).toMatch(/Sub asks for rock: \$3,000 \[pending\] Sub → PM \(from sub\)/)
    expect(sub).toMatch(/Add scope to sub: \$2,000 \[approved\] PM → Sub \(to sub\)/)
    expect(sub).toContain('direction: weird')
    expect(prompt).not.toContain('(from owner)')
  })
  test('contract value = revisedContract(job, primeCOs), not jobs.approved_change_orders', () => {
    const rev = revisedContract(job, primeChangeOrders)
    expect(rev).toBe(115000)
    expect(prompt).toContain(`Contract Value: ${fmt(rev)} (base $100,000 + approved owner COs $15,000)`)
    expect(prompt).not.toContain('$99,999')
  })
})

// ── 4. Direct costs beyond 100 ────────────────────────────────────────────────
describe('direct costs are totaled over every row', () => {
  const budgetItems = [{ id: 'b1', description: 'Framing', budget_amount: 500000 }]
  const costs = Array.from({ length: 150 }, (_, i) => ({
    id: `c${i}`, description: `Cost ${i}`, amount: 100, status: 'approved', category: 'material',
    cost_date: '2026-11-01', budget_item_id: 'b1', is_credit: i === 149,
  }))
  const prompt = buildSystemPrompt({ job: { job_type: 'commercial' }, budgetItems, costs })
  test('approved total and line figure include all 150 rows (one credit)', () => {
    // 149 × $100 − one $100 credit = $14,800
    expect(prompt).toContain('DIRECT COSTS — approved total $14,800 (150 costs on the job)')
    expect(prompt).toContain('Framing: budget $500,000, committed $0, direct costs $14,800')
  })
  test('recent sample is capped but says totals include everything', () => {
    const listed = prompt.split('\n').filter(l => /^\s+• 2026-11-01 Cost /.test(l))
    expect(listed).toHaveLength(RECENT_COST_SAMPLE)
    expect(prompt).toContain(`Most recent ${RECENT_COST_SAMPLE} of 150`)
  })
})

// ── 5. Committed uses revised values ──────────────────────────────────────────
test('total committed matches the per-line revised committed', () => {
  const budgetItems = [{ id: 'b1', description: 'Concrete', budget_amount: 40000 }]
  const contracts = [
    { id: 'k1', vendor_name: 'A Co', contract_value: 10000, adjusted_contract_value: 11000, budget_item_id: 'b1' },
    { id: 'k2', vendor_name: 'B Co', contract_value: 20000, adjusted_contract_value: 22000, budget_item_id: 'b1' },
  ]
  const prompt = buildSystemPrompt({ job: { job_type: 'commercial' }, budgetItems, contracts })
  expect(prompt).toContain('SUBCONTRACTS (2, total committed $33,000 revised)')
  expect(prompt).toContain('Concrete: budget $40,000, committed $33,000')
  expect(prompt).not.toContain('total committed $30,000')
  expect(prompt).toContain('A Co: contract $10,000, revised $11,000')
})

test('a split contract puts its revised value on each line by allocation share', () => {
  const budgetItems = [
    { id: 'b1', description: 'First', budget_amount: 50000 },
    { id: 'b2', description: 'Second', budget_amount: 50000 },
    { id: 'b3', description: 'Third', budget_amount: 5000 },
  ]
  const contracts = [
    { id: 'k1', vendor_name: 'Split Co', contract_value: 30000, adjusted_contract_value: 33000, budget_item_id: 'b3',
      budget_allocations: [{ budget_item_id: 'b1', amount: 10000 }, { budget_item_id: 'b2', amount: 20000 }] },
    // No line at all: in the header, on no line.
    { id: 'k2', vendor_name: 'Loose Co', contract_value: 4000, adjusted_contract_value: 4000 },
  ]
  const prompt = buildSystemPrompt({ job: { job_type: 'commercial' }, budgetItems, contracts })
  expect(prompt).toContain('First: budget $50,000, committed $11,000')
  expect(prompt).toContain('Second: budget $50,000, committed $22,000')
  // Allocations win over budget_item_id (same rule as contractCommittedForItem).
  expect(prompt).toContain('Third: budget $5,000, committed $0')
  expect(prompt).not.toContain('committed $33,000,')
  expect(prompt).toContain('SUBCONTRACTS (2, total committed $37,000 revised)')
  // Fully allocated contract: line sum equals its revised value.
  const alone = buildSystemPrompt({ job: { job_type: 'commercial' }, budgetItems, contracts: [contracts[0]] })
  expect(alone).toContain('SUBCONTRACTS (1, total committed $33,000 revised)')
  const lineSum = [...alone.matchAll(/committed \$([\d,]+), direct/g)].reduce((a, m) => a + Number(m[1].replace(/,/g, '')), 0)
  expect(lineSum).toBe(33000)
})

// ── Route: loads every cost page and the right owner-billing source ───────────
describe('POST /api/ask-ai builds the prompt from the right tables', () => {
  let db, selects, captured, failWith
  function mockQuery(table) {
    const filters = []
    let rangeArgs = null
    let cols = ''
    const run = () => {
      const err = failWith && failWith(table, rangeArgs, cols)
      if (err) return { data: null, error: err }
      let rows = (db[table] || []).filter(r => filters.every(f => f(r)))
      if (rangeArgs) rows = rows.slice(rangeArgs[0], rangeArgs[1] + 1)
      return { data: rows, error: null }
    }
    const q = {
      select: c => { cols = c; selects.push({ table, cols: c }); return q },
      order: () => q, limit: () => q,
      range: (a, b) => { rangeArgs = [a, b]; return q },
      eq: (c, v) => { filters.push(r => c.includes('.') || r[c] === v); return q },
      in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
      is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
      maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data[0] ?? null })),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  let route
  beforeAll(() => {
    jest.resetModules()
    jest.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: t => mockQuery(t) }) }))
    jest.doMock('../lib/server-auth', () => ({ requireAuth: async () => ({ userId: 'u1', email: 'o@nv.co', role: 'principal', error: null }) }))
    jest.doMock('../lib/roles', () => ({ denyUnlessOnJob: async () => null }))
    route = require('../app/api/ask-ai/route')
  })
  beforeEach(() => {
    selects = []
    captured = null
    failWith = null
    process.env.GEMINI_API_KEY = 'test-key-not-real'
    global.fetch = jest.fn(async (url, init) => {
      captured = JSON.parse(init.body)
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    })
  })
  afterAll(() => { delete process.env.GEMINI_API_KEY; delete global.fetch })

  const post = () => route.POST(new Request('http://x/api/ask-ai', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: JOB_ID, messages: [{ role: 'user', content: 'how much billed?' }] }),
  }))
  const baseDb = jobType => ({
    jobs: [{ id: JOB_ID, project_name: 'J', contract_value: 1000, job_type: jobType }],
    budget_items: [{ id: 'b1', job_id: JOB_ID, description: 'L', budget_amount: 1000, owner_amount: 1000 }],
    direct_costs: Array.from({ length: 2500 }, (_, i) => ({ id: `c${i}`, job_id: JOB_ID, amount: 1, status: 'approved', budget_item_id: 'b1', cost_date: '2026-01-01' })),
    change_orders: [], billing_submissions: [{ id: 's1', job_id: JOB_ID, amount_billed: 50000, status: 'approved' }],
    billing_sov_lines: [], subcontracts: [], subcontracts_summary: [],
    prime_change_orders: [{ id: 'p1', job_id: JOB_ID, co_number: 1, description: 'Owner CO', amount: 500, status: 'approved' }],
    aia_applications: [{ id: 'a1', job_id: JOB_ID, app_number: 1, status: 'submitted', retainage_pct: 0, nv_subcontract_id: null }],
    aia_application_lines: [{ application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 300 }],
    res_owner_draws: [{ id: 'd1', job_id: JOB_ID, draw_number: 1, status: 'funded', amount_requested: 700, amount_funded: null }],
  })

  test('commercial: all 2,500 costs, prime apps, prime COs; no draws; contract unchanged', async () => {
    db = baseDb('commercial')
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: 'ok' })
    const sys = captured.messages[0].content
    expect(captured.messages[0].role).toBe('system')
    expect(sys).toContain('approved total $2,500 (2500 costs on the job)')
    expect(sys).toContain('OWNER BILLING (prime AIA pay apps) — billed $300 to date')
    expect(sys).toContain('Contract Value: $1,500')
    expect(selects.some(s => s.table === 'res_owner_draws')).toBe(false)
    expect(selects.filter(s => s.table === 'prime_change_orders').every(s => !/nv_cost/.test(s.cols))).toBe(true)
    expect(captured.max_tokens).toBe(1024)
  })
  test('residential: draws only, no AIA apps; funded-unknown stays unknown', async () => {
    db = baseDb('residential')
    await post()
    const sys = captured.messages[0].content
    expect(sys).toContain('OWNER BILLING (owner/lender draws) — requested $700 to date')
    expect(sys).toContain('received UNKNOWN')
    expect(selects.some(s => s.table === 'aia_applications' || s.table === 'aia_application_lines')).toBe(false)
    expect(selects.some(s => s.table === 'draw_requests')).toBe(false)
  })
  test('no prime apps: lines query skipped', async () => {
    db = { ...baseDb('commercial'), aia_applications: [] }
    await post()
    expect(selects.some(s => s.table === 'aia_application_lines')).toBe(false)
    expect(captured.messages[0].content).toContain('No submitted prime pay applications')
  })

  // ── Failed money reads stop before Gemini (no partial / zero totals as complete) ──
  const READ_ERR = { code: 'XX000', message: 'connection reset' }
  const expectFailedClosed = async res => {
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/could not load/i)
    expect(body.reply).toBeUndefined()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(captured).toBeNull()
  }

  test('second direct-cost page errors: 500, Gemini not called, no "1000 costs on the job"', async () => {
    db = baseDb('commercial')
    failWith = (t, range) => (t === 'direct_costs' && range && range[0] === 1000 ? READ_ERR : null)
    const res = await post()
    await expectFailedClosed(res)
    expect(JSON.stringify(captured || {})).not.toContain('1000 costs on the job')
  })
  test('aia_applications errors on a commercial job: 500, not "billed $0" / "No submitted prime pay applications"', async () => {
    db = { ...baseDb('commercial'),
      aia_applications: [{ id: 'a1', job_id: JOB_ID, app_number: 1, status: 'approved', retainage_pct: 0, nv_subcontract_id: null }],
      aia_application_lines: [{ application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 12000 }] }
    failWith = t => (t === 'aia_applications' ? READ_ERR : null)
    await expectFailedClosed(await post())
  })
  test('aia_application_lines errors when apps were returned: 500', async () => {
    db = baseDb('commercial')
    failWith = t => (t === 'aia_application_lines' ? READ_ERR : null)
    await expectFailedClosed(await post())
  })
  test('prime_change_orders errors (not a missing column): 500, no base-only Contract Value', async () => {
    db = baseDb('commercial')
    failWith = t => (t === 'prime_change_orders' ? READ_ERR : null)
    await expectFailedClosed(await post())
  })
  test('prime_change_orders still errors after the co_number fallback: 500', async () => {
    db = baseDb('commercial')
    failWith = t => (t === 'prime_change_orders' ? { code: '42703', message: 'column prime_change_orders.co_number does not exist' } : null)
    await expectFailedClosed(await post())
    expect(selects.filter(s => s.table === 'prime_change_orders')).toHaveLength(2)
  })
  test('co_number fallback that succeeds still answers with the owner CO', async () => {
    db = baseDb('commercial')
    failWith = (t, r, cols) => (t === 'prime_change_orders' && /co_number/.test(cols) ? { code: '42703', message: 'column prime_change_orders.co_number does not exist' } : null)
    const res = await post()
    expect(res.status).toBe(200)
    expect(captured.messages[0].content).toContain('Contract Value: $1,500')
  })
  test('res_owner_draws errors on a residential job: 500, Gemini not called', async () => {
    db = baseDb('residential')
    failWith = t => (t === 'res_owner_draws' ? READ_ERR : null)
    await expectFailedClosed(await post())
  })
  test('res_owner_draws still errors after the amount_funded fallback: 500', async () => {
    db = baseDb('residential')
    failWith = t => (t === 'res_owner_draws' ? { code: '42703', message: 'column res_owner_draws.amount_funded does not exist' } : null)
    await expectFailedClosed(await post())
    expect(selects.filter(s => s.table === 'res_owner_draws')).toHaveLength(2)
  })
  test('amount_funded fallback that succeeds keeps funded draws UNKNOWN received', async () => {
    db = baseDb('residential')
    failWith = (t, r, cols) => (t === 'res_owner_draws' && /amount_funded/.test(cols) ? { code: '42703', message: 'column res_owner_draws.amount_funded does not exist' } : null)
    const res = await post()
    expect(res.status).toBe(200)
    expect(captured.messages[0].content).toContain('received UNKNOWN')
  })
})
