/**
 * Estimate -> job budget.
 *
 * Incident: Convert to Job inserted budget_items with columns that don't exist
 * (amount, category) and ignored the error, so every converted job had an
 * empty budget. Now: line mapping lives in lib/estimate-to-job.js and the
 * writes go through /api/estimates/to-job -> Postgres functions (migration 039).
 */

let db
let mockRpcCalls
let mockRpcResult
let mockAuth

function mockQuery(table) {
  const filters = []
  let range = null
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    let data = rows()
    if (range) data = data.slice(range[0], range[1] + 1)
    return { data, error: null }
  }
  const q = {
    select: () => q,
    order: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    range: (a, b) => { range = [a, b]; return q },
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data[0] ?? null })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockQuery(table),
    rpc: async (fn, args) => { mockRpcCalls.push({ fn, args }); return mockRpcResult(fn, args) },
  }),
}))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => mockAuth,
  isPM: role => ['pm', 'apm', 'super', 'admin'].includes(role),
}))

const route = require('../app/api/estimates/to-job/route')
const {
  lineCost, linePrice, estimateTotal, mapEstimateLinesToBudget, findDuplicates, planLink, budgetSnapshot, JOB_LINK_ROLES,
} = require('../lib/estimate-to-job')
const { calcTotal } = require('../lib/calc-total')

const EST = 'est-1'
const LOADED = '2026-11-04T15:00:00.123456+00:00'

function seed() {
  mockRpcCalls = []
  mockAuth = { userId: 'u1', role: 'pm', error: null }
  mockRpcResult = fn => fn === 'budget_line_references' ? { data: [], error: null } : { data: { job_id: 'job-new', lines_added: 2 }, error: null }
  db = {
    estimates: [{
      id: EST, estimate_number: 'EST-2026-007', project_name: "Braum's Tyler", owner_name: 'Braum', status: 'negotiating',
      created_by: 'u1', allowed_users: [], updated_at: LOADED, job_id: null, markup_pct: 10, markup_flat: 500, taxable: false,
      estimate_line_items: [
        { estimate_id: EST, description: 'Site work', amount: 1000, markup_pct: null, markup_flat: null, sort_order: 0 },
        { estimate_id: EST, description: 'Framing', amount: 2000, markup_pct: 20, markup_flat: 50, sort_order: 1, cost_code: '06-100' },
      ],
    }],
    jobs: [
      { id: 'job-a', job_number: '2026-001', project_name: 'Empty job', contract_value: null, status: 'active', is_preview_data: false, archived: false, source_estimate_id: null },
      { id: 'job-b', job_number: '2026-002', project_name: 'Has lines', contract_value: 90000, status: 'active', is_preview_data: false, archived: false, source_estimate_id: null },
      { id: 'job-prev', job_number: 'PV-1', project_name: 'Preview', contract_value: null, status: 'active', is_preview_data: true, archived: false, source_estimate_id: null },
      { id: 'job-arch', job_number: '2025-9', project_name: 'Archived', contract_value: null, status: 'active', is_preview_data: false, archived: true, source_estimate_id: null },
      { id: 'job-linked', job_number: '2026-003', project_name: 'Linked', contract_value: null, status: 'active', is_preview_data: false, archived: false, source_estimate_id: 'other-est' },
    ],
    budget_items: [
      { id: 'b1', job_id: 'job-b', cost_code: '02-000', description: 'Site Work', budget_amount: 5000, owner_amount: 5500, sort_order: 0 },
      { id: 'b2', job_id: 'job-b', cost_code: '06-100', description: 'Carpentry', budget_amount: 7000, owner_amount: 7700, sort_order: 1 },
    ],
    profiles: [{ id: 'u1', full_name: 'Pat PM' }],
  }
}

const post = body => route.POST(new Request('http://x/api/estimates/to-job', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}))
const jobB = () => db.budget_items.filter(b => b.job_id === 'job-b')

// ── Line mapping ────────────────────────────────────────────────────────────
describe('line mapping: cost vs price with markup', () => {
  test('budget_amount = cost, owner_amount = cost * (1 + pct) + per-line flat', () => {
    const est = { markup_pct: 10 }
    const lines = [
      { description: 'Global %', amount: 1000, markup_pct: null, markup_flat: null, sort_order: 0 },
      { description: 'Own % + flat', amount: 2000, markup_pct: 20, markup_flat: 50, sort_order: 1 },
      { description: 'Zero % overrides global', amount: 300, markup_pct: 0, markup_flat: null, sort_order: 2 },
      { description: 'Blank strings fall back', amount: '400', markup_pct: '', markup_flat: '', sort_order: 3 },
    ]
    expect(mapEstimateLinesToBudget(est, lines)).toEqual([
      { description: 'Global %', cost_code: null, budget_amount: 1000, owner_amount: 1100, sort_order: 0 },
      { description: 'Own % + flat', cost_code: null, budget_amount: 2000, owner_amount: 2450, sort_order: 1 },
      { description: 'Zero % overrides global', cost_code: null, budget_amount: 300, owner_amount: 300, sort_order: 2 },
      { description: 'Blank strings fall back', cost_code: null, budget_amount: 400, owner_amount: 440, sort_order: 3 },
    ])
  })

  test('drops lines without a description, keeps estimate order, renumbers sort_order', () => {
    const lines = [
      { description: 'Second', amount: 2, sort_order: 5 },
      { description: '   ', amount: 99, sort_order: 1 },
      { description: 'First', amount: 1, sort_order: 0 },
    ]
    expect(mapEstimateLinesToBudget({}, lines).map(l => [l.description, l.sort_order])).toEqual([['First', 0], ['Second', 1]])
  })

  test('cost_code copied when the estimate line has one, else null', () => {
    const out = mapEstimateLinesToBudget({}, [
      { description: 'A', amount: 1, cost_code: ' 03-300 ' },
      { description: 'B', amount: 1, cost_code: '' },
      { description: 'C', amount: 1 },
    ])
    expect(out.map(l => l.cost_code)).toEqual(['03-300', null, null])
  })

  test('rounds to cents', () => {
    const [l] = mapEstimateLinesToBudget({ markup_pct: 7.5 }, [{ description: 'x', amount: 333.33 }])
    expect(l.budget_amount).toBe(333.33)
    expect(l.owner_amount).toBe(358.33) // 358.329750
  })

  test('null / missing amounts are zero, not NaN', () => {
    expect(lineCost({ amount: null })).toBe(0)
    expect(linePrice({ amount: undefined, markup_flat: 25 }, 10)).toBe(25)
  })

  test('estimateTotal matches the estimate screen (lib/calc-total) incl. global flat and tax', () => {
    const est = { markup_pct: 10, markup_flat: 500, taxable: true }
    const lines = [
      { description: 'a', amount: 1000, markup_pct: null, markup_flat: null },
      { description: 'b', amount: 2000, markup_pct: 20, markup_flat: 50 },
    ]
    const expected = Math.round(calcTotal({ ...est, estimate_line_items: lines }) * 100) / 100
    expect(estimateTotal(est, lines)).toBe(expected)
    expect(expected).toBe(1100 + 2450 + 500 + 3000 * 0.0825)
  })
})

describe('duplicates and link planning', () => {
  const existing = [
    { id: 'b1', description: 'Site Work', cost_code: '02-000', sort_order: 0 },
    { id: 'b2', description: 'Carpentry', cost_code: '06-100', sort_order: 1 },
  ]
  test('matches by description (case/space-insensitive) first, then cost code', () => {
    const d = findDuplicates(existing, [
      { description: '  site   work', cost_code: null, sort_order: 0 },
      { description: 'Framing', cost_code: '06-100', sort_order: 1 },
      { description: 'Roofing', cost_code: '07-000', sort_order: 2 },
    ])
    expect(d.map(x => [x.sort_order, x.existing_id, x.match])).toEqual([[0, 'b1', 'description'], [1, 'b2', 'cost_code']])
  })

  const base = () => ({
    estimate: { markup_pct: 10 },
    estimateLines: [{ description: 'Site work', amount: 100 }, { description: 'Roofing', amount: 50 }],
    job: { contract_value: 1000 },
    jobLines: existing,
  })

  test('job with lines requires add/replace', () => {
    expect(planLink({ ...base(), opts: { contract_action: 'keep' } }).code).toBe('mode_required')
  })
  test('duplicates must each be resolved in add mode', () => {
    expect(planLink({ ...base(), opts: { mode: 'add', contract_action: 'keep' } }).code).toBe('duplicates_unresolved')
  })
  test('replace mode ignores duplicates', () => {
    const { plan } = planLink({ ...base(), opts: { mode: 'replace', contract_action: 'keep' } })
    expect(plan.lines.every(l => l.merge_into === null)).toBe(true)
  })
  test('merge sets merge_into, keep_both does not', () => {
    const merge = planLink({ ...base(), opts: { mode: 'add', duplicate_actions: { 0: 'merge' }, contract_action: 'keep' } }).plan
    expect(merge.lines.map(l => l.merge_into)).toEqual(['b1', null])
    const keep = planLink({ ...base(), opts: { mode: 'add', duplicate_actions: { 0: 'keep_both' }, contract_action: 'keep' } }).plan
    expect(keep.lines.map(l => l.merge_into)).toEqual([null, null])
  })
  test('contract: set/keep when empty, keep/replace when set; never silent', () => {
    const empty = { ...base(), job: { contract_value: null }, jobLines: [] }
    expect(planLink({ ...empty, opts: {} }).code).toBe('contract_choice_required')
    expect(planLink({ ...empty, opts: { contract_action: 'replace' } }).code).toBe('contract_choice_required')
    expect(planLink({ ...empty, opts: { contract_action: 'set' } }).plan).toMatchObject({ set_contract: true, contract_value: 165 })
    expect(planLink({ ...base(), opts: { mode: 'replace', contract_action: 'set' } }).code).toBe('contract_choice_required')
    expect(planLink({ ...base(), opts: { mode: 'replace', contract_action: 'keep' } }).plan).toMatchObject({ set_contract: false, contract_value: null })
    expect(planLink({ ...base(), opts: { mode: 'replace', contract_action: 'replace' } }).plan).toMatchObject({ set_contract: true, contract_value: 165 })
  })
})

// ── Route guards ────────────────────────────────────────────────────────────
describe('/api/estimates/to-job guards', () => {
  beforeEach(seed)

  test('unauthenticated -> 401 from requireAuth, nothing called', async () => {
    mockAuth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect(res.status).toBe(401)
    expect(mockRpcCalls).toEqual([])
  })

  test.each(['subcontractor', 'super', 'admin', 'owner', null])('role %s -> 403', async role => {
    mockAuth = { userId: 'u1', role, error: null }
    for (const action of ['list_jobs', 'preview_link', 'convert', 'link']) {
      const res = await post({ action, id: EST, job_id: 'job-a', expected_updated_at: LOADED, job_number: 'x' })
      expect(res.status).toBe(403)
    }
    expect(mockRpcCalls).toEqual([])
  })

  test('pm, apm and dev are allowed', () => {
    expect([...JOB_LINK_ROLES].sort()).toEqual(['apm', 'dev', 'pm'])
  })

  test('dev who is not creator/allowed on the estimate -> 403', async () => {
    mockAuth = { userId: 'someone-else', role: 'dev', error: null }
    const res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect(res.status).toBe(403)
    expect(mockRpcCalls).toEqual([])
  })
})

describe('convert', () => {
  beforeEach(seed)

  test('missing / mismatched expected_updated_at -> 409 stale, no RPC', async () => {
    for (const extra of [{}, { expected_updated_at: '2026-11-04T14:00:00Z' }, { expected_updated_at: null }]) {
      const res = await post({ action: 'convert', id: EST, job_number: '2026-010', ...extra })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('stale')
    }
    expect(mockRpcCalls).toEqual([])
  })

  test('estimate already has a job -> 409, no RPC', async () => {
    db.estimates[0].job_id = 'job-x'
    const res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_linked')
    expect(mockRpcCalls).toEqual([])
  })

  test('job number required', async () => {
    const res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '  ' })
    expect(res.status).toBe(400)
  })

  test('sends real budget_items columns, contract value = estimate total', async () => {
    const res = await post({ action: 'convert', id: EST, expected_updated_at: '2026-11-04T15:00:00.123456Z', job_number: ' 2026-010 ', start_date: '2026-12-01' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, job_id: 'job-new' })
    expect(mockRpcCalls).toHaveLength(1)
    const { fn, args } = mockRpcCalls[0]
    expect(fn).toBe('convert_estimate_to_job')
    expect(args).toMatchObject({
      p_estimate_id: EST,
      p_expected_updated_at: LOADED,
      p_job: { job_number: '2026-010', project_name: "Braum's Tyler", owner_name: 'Braum', start_date: '2026-12-01' },
      p_contract_value: 1100 + 2450 + 500,
      p_user_id: 'u1', p_user_role: 'pm', p_user_name: 'Pat PM',
    })
    expect(args.p_lines).toEqual([
      { description: 'Site work', cost_code: null, budget_amount: 1000, owner_amount: 1100, sort_order: 0 },
      { description: 'Framing', cost_code: '06-100', budget_amount: 2000, owner_amount: 2450, sort_order: 1 },
    ])
    for (const l of args.p_lines) expect(Object.keys(l).sort()).toEqual(['budget_amount', 'cost_code', 'description', 'owner_amount', 'sort_order'])
  })

  test('database errors are surfaced, not swallowed', async () => {
    mockRpcResult = () => ({ data: null, error: { message: 'NV_STALE: Someone else saved this estimate. Reload to see the latest.' } })
    let res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('stale')

    mockRpcResult = () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "jobs_job_number_key"' } })
    res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/jobs_job_number_key/)

    mockRpcResult = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.convert_estimate_to_job' } })
    res = await post({ action: 'convert', id: EST, expected_updated_at: LOADED, job_number: '2026-010' })
    expect((await res.json()).code).toBe('migration_missing')
  })
})

describe('link', () => {
  beforeEach(seed)

  test('list_jobs: only active, non-preview, non-archived, unlinked; with budget total and line count', async () => {
    const res = await post({ action: 'list_jobs' })
    expect(res.status).toBe(200)
    expect((await res.json()).jobs).toEqual([
      { id: 'job-a', job_number: '2026-001', project_name: 'Empty job', contract_value: null, budget_total: 0, line_count: 0 },
      { id: 'job-b', job_number: '2026-002', project_name: 'Has lines', contract_value: 90000, budget_total: 12000, line_count: 2 },
    ])
  })

  test.each(['job-prev', 'job-arch', 'job-linked'])('ineligible job %s -> 409', async jobId => {
    const res = await post({ action: 'preview_link', id: EST, job_id: jobId })
    expect(res.status).toBe(409)
    const res2 = await post({ action: 'link', id: EST, job_id: jobId, expected_updated_at: LOADED, expected_job_lines: [], expected_contract_value: null, contract_action: 'keep' })
    expect(res2.status).toBe(409)
    expect(mockRpcCalls).toEqual([])
  })

  test('preview shows duplicates and references', async () => {
    mockRpcResult = () => ({ data: [{ source_table: 'purchase_orders', source_column: 'budget_item_id', ref_count: 2 }], error: null })
    const res = await post({ action: 'preview_link', id: EST, job_id: 'job-b' })
    const body = await res.json()
    expect(body.duplicates).toEqual([
      { sort_order: 0, existing_id: 'b1', match: 'description' },
      { sort_order: 1, existing_id: 'b2', match: 'cost_code' },
    ])
    expect(body.references).toHaveLength(1)
    expect(body.job_snapshot).toEqual(budgetSnapshot(jobB()))
  })

  const linkBody = extra => ({
    action: 'link', id: EST, job_id: 'job-b', expected_updated_at: LOADED,
    expected_job_lines: budgetSnapshot(jobB()), expected_contract_value: 90000, ...extra,
  })

  test('stale estimate -> 409, no RPC', async () => {
    const res = await post(linkBody({ expected_updated_at: '2026-01-01T00:00:00Z', mode: 'replace', contract_action: 'keep' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('stale')
    expect(mockRpcCalls).toEqual([])
  })

  test('estimate already linked -> 409', async () => {
    db.estimates[0].job_id = 'job-a'
    const res = await post(linkBody({ mode: 'replace', contract_action: 'keep' }))
    expect(res.status).toBe(409)
    expect(mockRpcCalls).toEqual([])
  })

  test('job lines changed since preview -> 409 job_changed', async () => {
    const seen = budgetSnapshot(jobB())
    db.budget_items[0].budget_amount = 5001
    const res = await post(linkBody({ expected_job_lines: seen, mode: 'replace', contract_action: 'keep' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('job_changed')
    expect(mockRpcCalls).toEqual([])
  })

  test('contract value changed since preview -> 409 job_changed', async () => {
    const res = await post(linkBody({ expected_contract_value: 80000, mode: 'replace', contract_action: 'keep' }))
    expect(res.status).toBe(409)
    expect(mockRpcCalls).toEqual([])
  })

  test('job has lines and no mode -> 400; unresolved duplicates -> 400; no contract choice -> 400', async () => {
    expect((await post(linkBody({ contract_action: 'keep' }))).status).toBe(400)
    expect((await (await post(linkBody({ mode: 'add', contract_action: 'keep' }))).json()).code).toBe('duplicates_unresolved')
    expect((await (await post(linkBody({ mode: 'replace' }))).json()).code).toBe('contract_choice_required')
    expect(mockRpcCalls).toEqual([])
  })

  test('add + merge/keep both + replace contract -> RPC gets the plan', async () => {
    mockRpcResult = () => ({ data: { job_id: 'job-b', lines_added: 1, lines_merged: 1 }, error: null })
    const res = await post(linkBody({ mode: 'add', duplicate_actions: { 0: 'merge', 1: 'keep_both' }, contract_action: 'replace' }))
    expect(res.status).toBe(200)
    const { fn, args } = mockRpcCalls[0]
    expect(fn).toBe('link_estimate_to_job')
    expect(args).toMatchObject({
      p_estimate_id: EST, p_job_id: 'job-b', p_expected_updated_at: LOADED, p_mode: 'add',
      p_set_contract: true, p_contract_value: 4050, p_expected_contract_value: 90000, p_user_name: 'Pat PM',
    })
    expect(args.p_expected_lines).toEqual(budgetSnapshot(jobB()))
    expect(args.p_lines.map(l => [l.description, l.merge_into])).toEqual([['Site work', 'b1'], ['Framing', null]])
  })

  test('replace refused by the database when lines are referenced -> 409 with the message', async () => {
    mockRpcResult = () => ({ data: null, error: { message: "NV_REFERENCED: Cannot replace: these records use the job's budget lines: purchase_orders.budget_item_id (2)" } })
    const res = await post(linkBody({ mode: 'replace', contract_action: 'keep' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'referenced', error: "Cannot replace: these records use the job's budget lines: purchase_orders.budget_item_id (2)" })
  })

  test('link without a preview snapshot -> 400', async () => {
    const res = await post({ action: 'link', id: EST, job_id: 'job-a', expected_updated_at: LOADED, contract_action: 'set' })
    expect(res.status).toBe(400)
    expect(mockRpcCalls).toEqual([])
  })
})
