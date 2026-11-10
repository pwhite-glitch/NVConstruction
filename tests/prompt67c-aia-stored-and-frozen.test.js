/**
 * Prompt 67C — owner pay apps (AIA G702/G703)
 *   #5 materials stored on site (G703 Column F) + AIA column letters
 *   #7 prime apps freeze their schedule of values when they leave draft
 */
const fs = require('fs')
const path = require('path')

const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: () => false,
  }
})

const {
  g703Row, storedBalanceBefore, storedBalanceByKey, storedInstalledError, storedToDate, hasStoredColumns,
} = require('../lib/aia-g703')
const { totalCompletedToDate, contractSumToDate, contractCap } = require('../lib/contract-cap')
const { aiaCurrentPaymentDue } = require('../lib/cash-outlook')
const { rollupGeneralConditions } = require('../lib/gc-rollup')
const aiaRoute = require('../app/api/aia-draw/route')

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
function fnBody(src, decl) {
  const i = src.indexOf(decl)
  if (i < 0) throw new Error(`not found: ${decl}`)
  const rest = src.slice(i + decl.length)
  const m = rest.search(/\n  (async )?function \w+\(/)
  return decl + (m < 0 ? rest : rest.slice(0, m))
}

// ── lib/aia-g703.js ───────────────────────────────────────────────────────────
describe('g703Row', () => {
  test('stored this period adds to F and G; % and H use G', () => {
    const r = g703Row({ scheduled: 1000, prevCompleted: 100, thisCompleted: 50, storedThis: 200, retPct: 0.1 })
    expect(r).toMatchObject({ C: 1000, D: 100, E: 50, F: 200, G: 350, H: 650 })
    expect(r.pct).toBeCloseTo(35)
    expect(r.I_work).toBeCloseTo(15)
    expect(r.I_stored).toBeCloseTo(20)
    expect(r.I).toBeCloseTo(35)
  })

  test('installed from stored moves F → E; G unchanged', () => {
    const before = g703Row({ scheduled: 1000, prevCompleted: 100, thisCompleted: 50, storedPrevBalance: 200, retPct: 0.1 })
    // the page adds the installed amount to this period (E) in the same edit
    const after = g703Row({ scheduled: 1000, prevCompleted: 100, thisCompleted: 50 + 120, storedPrevBalance: 200, storedInstalledThis: 120, retPct: 0.1 })
    expect(before.F).toBe(200)
    expect(after.F).toBe(80)
    expect(after.E).toBe(170)
    expect(after.G).toBe(before.G)
    expect(after.I).toBeCloseTo(before.I)
  })

  test('installed more than the carried-in balance is an error; within it is fine', () => {
    expect(storedInstalledError({ storedPrevBalance: 100, storedInstalledThis: 150, label: 'Steel' })).toMatch(/more than the material stored/)
    expect(storedInstalledError({ storedPrevBalance: 100, storedInstalledThis: 100 })).toBeNull()
    expect(storedInstalledError({ storedPrevBalance: 0, storedInstalledThis: 0 })).toBeNull()
  })

  test('5a / 5b split at the same rate', () => {
    const r = g703Row({ scheduled: 5000, prevCompleted: 1000, thisCompleted: 500, storedPrevBalance: 300, storedThis: 200, retPct: 0.05 })
    expect(r.I_work).toBeCloseTo(75) // (1000 + 500) × 5%
    expect(r.I_stored).toBeCloseTo(25) // 500 × 5%
    expect(r.I).toBeCloseTo(r.G * 0.05)
  })

  test('carried-in stored balance: Σ(stored − installed) by key, never below 0', () => {
    const prev = [
      { budget_item_id: 'B1', stored_this_period: 500, stored_installed_this_period: 0 },
      { budget_item_id: 'B1', stored_this_period: 0, stored_installed_this_period: 200 },
      { budget_item_id: 'B2', stored_this_period: 0, stored_installed_this_period: 50 },
      { budget_item_id: 'B3' }, // legacy row without the columns
    ]
    expect(storedBalanceBefore(prev.filter(l => l.budget_item_id === 'B1'))).toBe(300)
    expect(storedBalanceByKey(prev, l => l.budget_item_id)).toEqual({ B1: 300, B2: 0, B3: 0 })
    expect(storedToDate({ storedPrevBalance: 300, storedThis: 100, storedInstalledThis: 50 })).toBe(350)
    expect(hasStoredColumns([{ id: 1 }])).toBe(false)
    expect(hasStoredColumns([{ id: 1, stored_this_period: 0 }])).toBe(true)
  })
})

describe('legacy lines (no stored fields) equal today to the cent', () => {
  // totalCompletedToDate exactly as it was before this package
  const r2 = n => Math.round(n * 100) / 100
  const oldTotal = lines => r2((lines || []).reduce((a, line) => {
    const scheduled = r2(Number(line.budget_amount || 0))
    const prevAmt = line.dollar_prev != null ? r2(Number(line.dollar_prev)) : r2(scheduled * Math.max(0, parseFloat(line.pct_prev) || 0) / 100)
    const thisAmt = line.dollar_this !== undefined ? r2(Number(line.dollar_this) || 0) : r2(scheduled * Math.max(0, parseFloat(line.pct_this) || 0) / 100)
    return a + prevAmt + thisAmt
  }, 0))
  const fixture = [
    { budget_amount: 12345.67, dollar_prev: 1000.01, dollar_this: 333.33 },
    { budget_amount: 999.99, pct_prev: '12.5', pct_this: '7.333' },
    { budget_amount: 0.1, dollar_prev: null, pct_prev: '33.3333', dollar_this: 0.03 },
    { budget_amount: 50000, dollar_prev: 25000.5, pct_this: '0' },
  ]
  test('totalCompletedToDate unchanged', () => {
    expect(totalCompletedToDate(fixture)).toBe(oldTotal(fixture))
  })
  test('stored material counts in total completed & stored (cap includes F)', () => {
    const withStored = fixture.map((l, i) => (i === 0 ? { ...l, stored_prev_balance: 100, stored_this: 50, stored_installed_this: 25 } : l))
    expect(totalCompletedToDate(withStored)).toBe(r2(oldTotal(fixture) + 125))
  })
  test('GC rollup sums F and the 5a / 5b parts', () => {
    const rows = [
      { budget_item_id: 'G1', scheduled: 100, prevAmt: 10, thisAmt: 5, storedAmt: 20, totalAmt: 35, retainage: 3.5, retainageWork: 1.5, retainageStored: 2 },
      { budget_item_id: 'G2', scheduled: 200, prevAmt: 20, thisAmt: 5, storedAmt: 10, totalAmt: 35, retainage: 3.5, retainageWork: 2.5, retainageStored: 1 },
    ]
    const [gc] = rollupGeneralConditions(rows, new Set(['G1', 'G2']))
    expect(gc).toMatchObject({ storedAmt: 30, totalAmt: 70, retainage: 7, retainageWork: 4, retainageStored: 3 })
  })
})

describe('contractSumToDate (frozen)', () => {
  const job = { contract_value: 100000 }
  const primeCOs = [{ status: 'approved', amount: 5000 }]
  test('frozen prime app uses saved lines 1 + 2, not today', () => {
    const app = { schedule_frozen_at: '2026-11-01T00:00:00Z', original_contract_sum: 90000, net_change_orders: 2500 }
    expect(contractSumToDate({ job, app, primeCOs })).toBe(92500)
  })
  test('unfrozen app unchanged', () => {
    expect(contractSumToDate({ job, app: {}, primeCOs })).toBe(105000)
  })
})

// HIGH-1: on nv_role 'sub' jobs the frozen line 3 must equal the live line 3 at submit.
describe('contractSumToDate (frozen, NV is the sub)', () => {
  const FROZEN = '2026-11-05T00:00:00Z'
  // Same header freezePrimeAiaSchedule saves: original = live line 3 (sub rule), net = approved prime COs
  const freeze = ({ job, primeCOs, nvSubcontracts }) => ({
    schedule_frozen_at: FROZEN,
    original_contract_sum: job.nv_role === 'sub' ? contractSumToDate({ job, app: {}, primeCOs, nvSubcontracts }) : job.contract_value,
    net_change_orders: (primeCOs || []).filter(c => c.status === 'approved').reduce((a, c) => a + c.amount, 0),
  })
  const subJob = { nv_role: 'sub', contract_value: 90000 }
  const primeCOs = [{ status: 'approved', amount: 5000 }]
  const nvSubcontracts = [{ contract_value: 100000, change_orders: [{ status: 'approved', amount: 5000 }] }]

  test('sub job WITH an approved prime CO: frozen line 3 === live line 3', () => {
    const live = contractSumToDate({ job: subJob, app: {}, primeCOs, nvSubcontracts })
    const app = freeze({ job: subJob, primeCOs, nvSubcontracts })
    expect(live).toBe(105000)
    expect(contractSumToDate({ job: subJob, app, primeCOs, nvSubcontracts })).toBe(live)
    // later prime COs / subcontract changes don't move the frozen line 3
    expect(contractSumToDate({ job: subJob, app, primeCOs: [...primeCOs, { status: 'approved', amount: 9000 }], nvSubcontracts: [] })).toBe(105000)
  })

  test('sub job with no subcontracts (falls back to job value): frozen === live', () => {
    const live = contractSumToDate({ job: subJob, app: {}, primeCOs, nvSubcontracts: [] })
    const app = freeze({ job: subJob, primeCOs, nvSubcontracts: [] })
    expect(live).toBe(90000)
    expect(contractSumToDate({ job: subJob, app, primeCOs, nvSubcontracts: [] })).toBe(live)
  })

  test('prime job: frozen = original + net, unchanged', () => {
    const primeJob = { contract_value: 100000 }
    const app = freeze({ job: primeJob, primeCOs })
    expect(contractSumToDate({ job: primeJob, app, primeCOs })).toBe(105000)
    expect(contractSumToDate({ job: primeJob, app: { ...app, original_contract_sum: 90000, net_change_orders: 2500 }, primeCOs })).toBe(92500)
  })

  test('cap on a frozen sub app rejects billing above the live-at-submit line 3', () => {
    const app = freeze({ job: subJob, primeCOs, nvSubcontracts })
    const sum = contractSumToDate({ job: subJob, app, primeCOs, nvSubcontracts })
    const lines = total => [{ budget_amount: 200000, dollar_prev: 0, dollar_this: total }]
    expect(contractCap(sum, totalCompletedToDate(lines(105000))).isOver).toBe(false)
    const over = contractCap(sum, totalCompletedToDate(lines(107500)))
    expect(over.isOver).toBe(true)
    expect(over.remaining).toBe(-2500)
  })
})

// ── lib/cash-outlook aiaCurrentPaymentDue ────────────────────────────────────
describe('aiaCurrentPaymentDue', () => {
  const budgetItems = [{ id: 'B1', job_id: 'J', owner_amount: 10000 }, { id: 'B2', job_id: 'J', budget_amount: 5000 }]
  const app1 = { id: 'A1', job_id: 'J', app_number: 1, retainage_pct: 10, status: 'submitted' }

  test('stored material raises current payment due by (1 − ret%) × stored', () => {
    const base = aiaCurrentPaymentDue({ app: app1, apps: [app1], linesByApp: { A1: [{ budget_item_id: 'B1', dollar_this_period: 1000 }] }, budgetItems })
    const withStored = aiaCurrentPaymentDue({ app: app1, apps: [app1], linesByApp: { A1: [{ budget_item_id: 'B1', dollar_this_period: 1000, stored_this_period: 500, stored_installed_this_period: 0 }] }, budgetItems })
    expect(base.due).toBe(900)
    expect(withStored.due).toBe(r2x(900 + 0.9 * 500))
    expect(withStored.totalStored).toBe(500)
    expect(withStored.totalCompleted).toBe(1500)
  })

  test('stored carried into the next app is in previous certificates (not billed twice)', () => {
    const app2 = { id: 'A2', job_id: 'J', app_number: 2, retainage_pct: 10, status: 'draft' }
    const linesByApp = {
      A1: [{ budget_item_id: 'B1', dollar_this_period: 1000, stored_this_period: 500, stored_installed_this_period: 0 }],
      // install all 500 this period: E += 500, F → 0
      A2: [{ budget_item_id: 'B1', dollar_this_period: 500, stored_this_period: 0, stored_installed_this_period: 500 }],
    }
    const r = aiaCurrentPaymentDue({ app: app2, apps: [app1, app2], linesByApp, budgetItems })
    expect(r.totalCompleted).toBe(1500)
    expect(r.due).toBe(0)
  })

  test('frozen app uses line.scheduled_value even after budgetItems change', () => {
    const frozen = { ...app1, schedule_frozen_at: '2026-11-02T00:00:00Z' }
    const lines = { A1: [{ budget_item_id: 'B1', pct_this_period: 10, dollar_this_period: null, scheduled_value: 5000 }] }
    const changedBudget = [{ id: 'B1', job_id: 'J', owner_amount: 20000 }, { id: 'B9', job_id: 'J', owner_amount: 7000 }]
    const r = aiaCurrentPaymentDue({ app: frozen, apps: [frozen], linesByApp: lines, budgetItems: changedBudget })
    expect(r.totalThis).toBe(500)
    expect(r.due).toBe(450)
    expect(r.warnings).not.toContain('line_without_budget_item')
  })

  test('unfrozen legacy app unchanged (live budget, no stored columns)', () => {
    const lines = { A1: [{ budget_item_id: 'B1', pct_this_period: 10, dollar_this_period: null, scheduled_value: null }, { budget_item_id: 'B2', dollar_this_period: 250 }] }
    const r = aiaCurrentPaymentDue({ app: app1, apps: [app1], linesByApp: lines, budgetItems })
    expect(r.totalThis).toBe(1250)
    expect(r.totalStored).toBe(0)
    expect(r.due).toBe(1125)
  })
})
function r2x(n) { return Math.round(n * 100) / 100 }

// ── /api/aia-draw ─────────────────────────────────────────────────────────────
function rpcModel(a, db) {
  const l = db.aia_application_lines.find(x => x.application_id === a.p_app_id && x.budget_item_id === a.p_budget_item_id)
  if (l) Object.assign(l, { dollar_this_period: a.p_new_this, pct_this_period: a.p_new_pct })
  const c = db.direct_costs.find(r => r.id === a.p_cost_id)
  Object.assign(c, { drawn_application_id: a.p_app_id, drawn_aia_delta: a.p_applied })
  return { data: { ok: true }, error: null }
}
function seedDraw({ line = {}, prevApp = null, prevLine = null } = {}) {
  resetMockState({
    jobs: [{ id: 'J1' }],
    pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }],
    budget_items: [{ id: 'L1', job_id: 'J1', budget_amount: 10000, owner_amount: 10000 }],
    aia_applications: [
      ...(prevApp ? [prevApp] : []),
      { id: 'A1', job_id: 'J1', app_number: 2, status: 'draft', payment_received: false, markup_pct: 10, nv_subcontract_id: null },
    ],
    aia_application_lines: [
      ...(prevLine ? [prevLine] : []),
      { id: 'ln1', application_id: 'A1', budget_item_id: 'L1', dollar_this_period: 500, pct_this_period: 5, dollar_prev: 0, ...line },
    ],
    direct_costs: [{ id: 'exp', job_id: 'J1', status: 'approved', amount: 1000, is_credit: false, budget_item_id: 'L1', drawn_application_id: null, drawn_aia_delta: null }],
  })
  mockState.rpc.aia_dc_draw_apply = rpcModel
  mockState.auth = { userId: 'pm1', role: 'pm', error: null }
}
const draw = () => aiaRoute.POST(new Request('http://x/api/aia-draw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draw', cost_id: 'exp', app_id: 'A1' }) }))

describe('/api/aia-draw bound includes stored material', () => {
  test('no stored material: today\'s bound (full $1,100 fits)', async () => {
    seedDraw({ line: { stored_this_period: 0, stored_installed_this_period: 0 } })
    const res = await draw()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 1100, new_this: 1600 })
  })

  test('draw bounded by scheduled − (prev + stored balance)', async () => {
    // this app stores 9,000: G = 0 + 500 + 9,000 → only 500 more fits under 10,000
    seedDraw({ line: { stored_this_period: 9000, stored_installed_this_period: 0 } })
    const res = await draw()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 500, new_this: 1000 })
  })

  test('stored balance carried in from an earlier app counts; dollar_prev stays completed-only', async () => {
    const prevApp = { id: 'A0', job_id: 'J1', app_number: 1, status: 'submitted', payment_received: false, markup_pct: 10, nv_subcontract_id: null }
    const prevLine = { id: 'ln0', application_id: 'A0', budget_item_id: 'L1', dollar_this_period: 2000, pct_this_period: 20, stored_this_period: 7000, stored_installed_this_period: 0 }
    seedDraw({ prevApp, prevLine, line: { stored_this_period: 0, stored_installed_this_period: 0 } })
    let rpcArgs
    mockState.rpc.aia_dc_draw_apply = (a, db) => { rpcArgs = a; return rpcModel(a, db) }
    const res = await draw()
    // hi = 10,000 − (2,000 + 7,000) = 1,000 → this goes 500 → 1,000
    expect(await res.json()).toMatchObject({ applied: 500, new_this: 1000 })
    expect(rpcArgs.p_dollar_prev).toBe(2000)
  })

  // LOW-3: a frozen app bounds the draw against the line's saved Column C
  const lockedFrozen = extra => {
    const a = mockState.db.aia_applications.find(x => x.id === 'A1')
    Object.assign(a, { status: 'submitted', ...extra })
    mockState.auth = { userId: 'own', role: 'principal', error: null }
  }
  const drawOverride = () => aiaRoute.POST(new Request('http://x/api/aia-draw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draw', cost_id: 'exp', app_id: 'A1', override_app_number: '2' }) }))

  test('frozen app: bound uses saved scheduled_value, not the live budget', async () => {
    seedDraw({ line: { stored_this_period: 0, stored_installed_this_period: 0, scheduled_value: 1000 } })
    lockedFrozen({ schedule_frozen_at: '2026-11-05T00:00:00Z' })
    const res = await drawOverride()
    expect(res.status).toBe(200)
    // saved C = 1,000 → only 500 more fits (live budget is 10,000)
    expect(await res.json()).toMatchObject({ applied: 500, new_this: 1000 })
  })

  test('not frozen: saved scheduled_value ignored, live budget bound', async () => {
    seedDraw({ line: { stored_this_period: 0, stored_installed_this_period: 0, scheduled_value: 1000 } })
    lockedFrozen({ schedule_frozen_at: null })
    const res = await drawOverride()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 1100, new_this: 1600 })
  })

  test('schedule_frozen_at column missing (063 not applied) → live bound, no 500', async () => {
    seedDraw({ line: { scheduled_value: 1000 } })
    lockedFrozen({})
    mockState.missingSelectCols = { aia_applications: ['schedule_frozen_at'], aia_application_lines: ['stored_this_period'] }
    const res = await drawOverride()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 1100, new_this: 1600 })
  })

  test('missing stored columns (063 not applied) → today\'s bound, no 500', async () => {
    seedDraw()
    mockState.missingSelectCols = { aia_application_lines: ['stored_this_period'] }
    const res = await draw()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ applied: 1100, new_this: 1600 })
  })
})

// LOW-1: installed-from-stored survives the pinned (GC-tracked) recalc
describe('recalcPinnedLines keeps installed from stored', () => {
  const recalcPinnedLines = new Function(fnBody(read('app/jobdetail/page.js'), 'function recalcPinnedLines(') + '\nreturn recalcPinnedLines')()
  const pinned = new Set(['GC'])
  const base = [
    { budget_item_id: 'B1', budget_amount: 10000, dollar_prev: 2000, dollar_this: 3000 }, // 50% overall
    { budget_item_id: 'GC', budget_amount: 1000, dollar_prev: 100, dollar_this: 0, stored_prev_balance: 300, stored_installed_this: 0 },
  ]
  const gcRow = lines => lines.find(l => l.budget_item_id === 'GC')
  const G = l => g703Row({ scheduled: l.budget_amount, prevCompleted: l.dollar_prev, thisCompleted: l.dollar_this, storedPrevBalance: l.stored_prev_balance, storedInstalledThis: l.stored_installed_this }).G

  test('E rises by the installed amount and G is unchanged', () => {
    const before = gcRow(recalcPinnedLines(base, pinned))
    expect(before.dollar_this).toBe(400) // 50% × 1,000 − 100
    // the onChange adds 200 to dollar_this, then recalc runs
    const edited = base.map(l => l.budget_item_id === 'GC' ? { ...l, stored_installed_this: 200, dollar_this: l.dollar_this + 200 } : l)
    const after = gcRow(recalcPinnedLines(edited, pinned))
    expect(after.dollar_this).toBe(600)
    expect(parseFloat(after.pct_this)).toBeCloseTo(60)
    expect(G(after)).toBe(G(before))
  })

  test('repeated recalc does not double-add', () => {
    const edited = base.map(l => l.budget_item_id === 'GC' ? { ...l, stored_installed_this: 200 } : l)
    let lines = recalcPinnedLines(edited, pinned)
    lines = recalcPinnedLines(lines, pinned)
    lines = recalcPinnedLines(lines, pinned)
    expect(gcRow(lines).dollar_this).toBe(600)
  })

  test('no installed amount: pinned line unchanged from today', () => {
    const r = gcRow(recalcPinnedLines(base, pinned))
    expect(r.dollar_this).toBe(400)
    expect(parseFloat(r.pct_this)).toBeCloseTo(40)
  })
})

// ── Page source ───────────────────────────────────────────────────────────────
describe('job page source', () => {
  const job = read('app/jobdetail/page.js')
  const gen = fnBody(job, 'function generateAIAFromApp(')

  test('G703 printout letters match the AIA form', () => {
    expect(gen).toMatch(/<th>C<br>Scheduled<br>Value<\/th>/)
    expect(gen).toMatch(/<th>F<br>Materials Presently<br>Stored<\/th>/)
    expect(gen).toMatch(/<th>G<br>Total Completed/)
    expect(gen).toContain('<th style="width:70px" class="left">Cost Code</th>')
    expect(gen).not.toContain('B<br>Cost Code')
    expect(gen).toContain('B — Description of Work')
    expect(gen).toContain('%<br>(G÷C)')
  })

  test('G702 has 5a, 5b and the total line; line 7 includes the carried-in stored balance', () => {
    expect(gen).toContain('<td>5a</td><td>${retPctLabel}% of Completed Work (Column D + E on G703)</td>')
    expect(gen).toContain('<td>5b</td><td>${retPctLabel}% of Stored Material (Column F on G703)</td>')
    expect(gen).toContain('Total Retainage (Lines 5a + 5b or Total in Column I of G703)')
    expect(gen).toContain('(totalPrev + totalStoredPrev) * (1 - prevRetPct)')
    expect(gen).toContain('g703Row(')
  })

  test('"LA License # CL 10283" unchanged (same count as origin/main)', () => {
    expect((job.match(/LA License # CL 10283/g) || []).length).toBe(3)
  })

  test('create and save write scheduled_value (and line_description)', () => {
    const create = fnBody(job, 'async function createAiaApplication(')
    expect(create).toContain('scheduled_value: Math.round(bAmt * 100) / 100')
    expect(create).toContain('line_description: aiaLineDescription(b)')
    const save = fnBody(job, 'async function saveAiaLines(')
    expect(save).toContain('updates.scheduled_value =')
    expect(save).toContain('updates.line_description =')
    expect(save).toContain('updates.stored_this_period =')
    expect(save).toContain('updates.stored_installed_this_period =')
    expect(save).toContain('fallbackCols: AIA_STORED_COLS')
    expect(save).toContain('need database migration 063')
    // locked apps can't change stored amounts
    expect(save).toContain('sl?.stored_this_period')
  })

  test('status change freezes the schedule (status set last) and back-to-draft clears it', () => {
    const save = fnBody(job, 'async function saveAiaLines(')
    expect(save).toContain('freezePrimeAiaSchedule(activeAia)')
    expect(save).toContain("status: freezing ? prevStatus : newStatus")
    expect(save).toContain('schedule_frozen_at: null')
    const freeze = fnBody(job, 'async function freezePrimeAiaSchedule(')
    expect(freeze).toContain('schedule_frozen_at: new Date().toISOString()')
    expect(freeze).toContain('original_contract_sum')
    expect(freeze).toContain('net_change_orders')
    expect(job).toContain("const AIA_FREEZE_COLS = ['original_contract_sum', 'net_change_orders', 'schedule_frozen_at']")
  })

  test('frozen load reads saved lines; legacy note printed on G702 and G703', () => {
    const open = fnBody(job, 'async function openAiaApp(')
    expect(open).toContain('if (app.schedule_frozen_at)')
    expect(open).toContain('l.scheduled_value')
    expect(gen).toContain('Schedule rebuilt from the current budget — this application was submitted before the portal saved its schedule of values.')
    expect((gen.match(/\$\{scheduleRebuilt \?/g) || []).length).toBe(2)
  })

  test('G703 editor has the stored inputs (hidden until 063)', () => {
    expect(job).toContain('{aiaStoredEnabled && <th title="New material stored on site / in a yard this period (G703 Column F)"')
    expect(job).toContain('aria-label="Stored this period"')
    expect(job).toContain('aria-label="Installed from stored"')
    expect(job).toContain('Stored to date (F)')
  })
})

// ── Migration 063 ─────────────────────────────────────────────────────────────
describe('migration 063', () => {
  const sql = read('migrations/063_aia_stored_materials_and_frozen_schedule.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('IF NOT EXISTS for every column', () => {
    const adds = code.match(/ADD COLUMN[^;]*/g) || []
    expect(adds.length).toBe(7)
    for (const a of adds) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/)
    for (const c of ['stored_this_period', 'stored_installed_this_period', 'scheduled_value', 'line_description', 'original_contract_sum', 'net_change_orders', 'schedule_frozen_at']) {
      expect(code).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`))
    }
  })
  test('no UPDATE / DELETE of existing rows; has a commented ROLLBACK', () => {
    expect(code).not.toMatch(/\bUPDATE\b/i)
    expect(code).not.toMatch(/\bDELETE\b/i)
    expect(sql).toMatch(/-- ROLLBACK:/)
  })
  test('CHECK constraints added only if missing', () => {
    expect(code).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/)
    expect(code).toContain('CHECK (stored_this_period >= 0)')
    expect(code).toContain('CHECK (stored_installed_this_period >= 0)')
  })
})
