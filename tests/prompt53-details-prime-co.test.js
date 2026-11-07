/**
 * Prompt 53 items 15 + 16 (in-memory DB, nothing real written, no migration applied):
 *  15. Commercial Details save → POST /api/jobs/details with the commercial allow-list;
 *      archived jobs: non-Owner can't change status / unarchive, Owner "set Active" can.
 *  16. Prime CO approve / apply / reject → POST /api/prime-change-orders/review, one
 *      transaction (public.prime_co_review, migration 049). The RPC is simulated here by
 *      a JS stand-in with the same all-or-nothing rules; missing RPC → 503, no writes.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  return { requireAuth: async () => mockState.auth }
})

const details = require('../app/api/jobs/details/route')
const review = require('../app/api/prime-change-orders/review/route')
const { commercialDetailsUpdate, residentialDetailsUpdate, jobDetailsUpdate, COMMERCIAL_DETAIL_FIELDS } = require('../lib/job-details')
const { normalizeSov, primeCOLineIds, primeCORpcError, canReviewPrimeCO } = require('../lib/prime-co-review')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const JC = '11111111-1111-4111-8111-111111111111' // commercial
const JR = '22222222-2222-4222-8222-222222222222' // residential
const JX = '33333333-3333-4333-8333-333333333333' // other commercial job
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const B3 = 'b3000000-0000-4000-8000-000000000003'
const BR = 'b4000000-0000-4000-8000-000000000004'
const BX = 'b9000000-0000-4000-8000-000000000009'
const CO1 = 'c1000000-0000-4000-8000-000000000001'
const CO2 = 'c2000000-0000-4000-8000-000000000002'
const CO3 = 'c3000000-0000-4000-8000-000000000003'
const COR = 'c4000000-0000-4000-8000-000000000004'
const COX = 'c5000000-0000-4000-8000-000000000005'

const req = (url, body, headers = {}) => new Request(`http://x${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null, ...extra } }
const json = async r => ({ status: r.status, body: await r.json() })
const writes = () => mockState.calls.filter(c => c.op !== 'rpc')

// ── JS stand-in for public.prime_co_review (same rules as migrations/049) ──────────
// Works on a copy and commits only when every step succeeded (transaction). Lines in
// mockState.failLines make the budget update throw mid-way.
function primeCoReviewSim(args, db) {
  const snapshot = JSON.parse(JSON.stringify(db))
  const fail = message => { for (const k of Object.keys(db)) db[k] = snapshot[k]; return { data: null, error: { message } } }
  const co = db.prime_change_orders.find(c => c.id === args.p_co_id)
  if (!co) return fail('prime_co_not_found')
  if (co.job_id !== args.p_job_id) return fail('prime_co_wrong_job')
  const applied = !!co.budget_applied
  let sov = co.sov
  let line = co.budget_item_id
  let sign = 1
  if (args.p_action === 'approve') {
    if (co.status !== 'pending') return fail('prime_co_not_pending')
    if (applied) return fail('prime_co_already_applied')
    if (args.p_set_sov) sov = args.p_sov
    if (args.p_residential && !line) line = args.p_budget_item_id
  } else if (args.p_action === 'apply') {
    if (co.status !== 'approved') return fail('prime_co_not_approved')
    if (applied) return fail('prime_co_already_applied')
  } else if (args.p_action === 'reject') {
    if (co.status === 'pending' || (co.status === 'approved' && !applied)) { co.status = 'rejected'; return { data: { ok: true, status: 'rejected' }, error: null } }
    if (co.status === 'approved' && applied) { if (!args.p_allow_reverse) return fail('prime_co_reverse_not_allowed'); sign = -1 } else return fail('prime_co_not_pending')
  }
  const deltas = {}
  for (const r of Array.isArray(sov) ? sov : []) if (r && r.budget_item_id && Number(r.amount)) deltas[r.budget_item_id] = Math.round(((deltas[r.budget_item_id] || 0) + Number(r.amount)) * 100) / 100
  for (const k of Object.keys(deltas)) if (!deltas[k]) delete deltas[k]
  if (!Object.keys(deltas).length && args.p_residential && line && Number(co.amount)) deltas[line] = Number(co.amount)
  if (!Object.keys(deltas).length && (args.p_action !== 'approve' || args.p_residential)) return fail('prime_co_no_lines')
  for (const id of Object.keys(deltas).sort()) {
    const b = db.budget_items.find(x => x.id === id && x.job_id === co.job_id)
    if (!b) return fail('prime_co_line_wrong_job')
  }
  for (const id of Object.keys(deltas).sort()) {
    if ((mockState.failLines || []).includes(id)) return fail(`update of ${id} failed`)
    const b = db.budget_items.find(x => x.id === id)
    const d = sign * deltas[id]
    const oldBudget = b.budget_amount
    b.budget_amount = Number(oldBudget || 0) + d
    b.owner_amount = Number(b.owner_amount ?? oldBudget ?? 0) + d
  }
  if (args.p_action === 'approve') {
    co.status = 'approved'
    if (Object.keys(deltas).length) co.budget_applied = true
    if (args.p_set_sov) co.sov = sov
    if (args.p_residential && !co.budget_item_id && line) co.budget_item_id = line
  } else if (args.p_action === 'apply') co.budget_applied = true
  else { co.status = 'rejected'; co.budget_applied = false }
  return { data: { ok: true, status: co.status, budget_applied: !!co.budget_applied, lines: Object.keys(deltas).length }, error: null }
}

function seed() {
  resetMockState({
    jobs: [
      { id: JC, job_type: 'commercial', status: 'active', archived: false, pm_email: 'pm@nv.com', contract_value: 100000, project_name: 'Braum', job_number: '7469', billing_frequency: 'monthly' },
      { id: JR, job_type: 'residential', status: 'active', archived: false, pm_email: 'pm@nv.com', contract_value: 50000, project_name: 'NoLo', job_number: 'R-101' },
      { id: JX, job_type: 'commercial', status: 'active', archived: true, pm_email: null, contract_value: 1, project_name: 'Other', job_number: '7000' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: JC, user_id: 'u-apm' }, { id: 'a2', job_id: JC, user_id: 'u-super' }, { id: 'a3', job_id: JR, user_id: 'u-apm' }],
    budget_items: [
      { id: B1, job_id: JC, description: 'Site', budget_amount: 1000, owner_amount: 1200 },
      { id: B2, job_id: JC, description: 'Concrete', budget_amount: 2000, owner_amount: null },
      { id: B3, job_id: JC, description: 'Steel', budget_amount: 3000, owner_amount: 3000 },
      { id: BR, job_id: JR, description: 'Framing', budget_amount: 900, owner_amount: 1000 },
      { id: BX, job_id: JX, description: 'Foreign', budget_amount: 5, owner_amount: 5 },
    ],
    prime_change_orders: [
      { id: CO1, job_id: JC, status: 'pending', amount: 600, budget_applied: false, budget_item_id: null, sov: [{ budget_item_id: B1, amount: 100 }, { budget_item_id: B2, amount: 200 }, { budget_item_id: B3, amount: 300 }] },
      { id: CO2, job_id: JC, status: 'approved', amount: 50, budget_applied: false, budget_item_id: null, sov: [{ budget_item_id: B1, amount: 50 }] },
      { id: CO3, job_id: JC, status: 'pending', amount: 75, budget_applied: false, budget_item_id: null, sov: [{ budget_item_id: B1, amount: 75 }] },
      { id: COR, job_id: JR, status: 'pending', amount: 250, budget_applied: false, budget_item_id: null, sov: null },
      { id: COX, job_id: JC, status: 'pending', amount: 5, budget_applied: false, budget_item_id: null, sov: [{ budget_item_id: BX, amount: 5 }] },
    ],
  })
  mockState.failLines = []
}
beforeEach(seed)
const enableRpc = () => { mockState.rpc.prime_co_review = primeCoReviewSim; mockState.rpc.prime_co_revise = primeCoReviseSim }

// ── JS stand-in for public.prime_co_revise (same rules as migrations/049) ──────────
// Nets old → new linked SOV per line, moves lines, THEN writes the CO; all or nothing.
function primeCoReviseSim(args, db) {
  const snapshot = JSON.parse(JSON.stringify(db))
  const fail = message => { for (const k of Object.keys(db)) db[k] = snapshot[k]; return { data: null, error: { message } } }
  const co = db.prime_change_orders.find(c => c.id === args.p_co_id)
  if (!co) return fail('prime_co_not_found')
  if (co.job_id !== args.p_job_id) return fail('prime_co_wrong_job')
  if (co.status !== 'approved' || !co.budget_applied) return fail('prime_co_not_applied')
  const deltas = {}
  const add = (rows, sign) => { for (const r of Array.isArray(rows) ? rows : []) if (r && r.budget_item_id && r.amount !== '' && r.amount != null) deltas[r.budget_item_id] = Math.round(((deltas[r.budget_item_id] || 0) + sign * Number(r.amount)) * 100) / 100 }
  add(co.sov, -1); add(args.p_sov, 1)
  for (const k of Object.keys(deltas)) if (!deltas[k]) delete deltas[k]
  for (const id of Object.keys(deltas).sort()) if (!db.budget_items.find(x => x.id === id && x.job_id === co.job_id)) return fail('prime_co_line_wrong_job')
  for (const id of Object.keys(deltas).sort()) {
    if ((mockState.failLines || []).includes(id)) return fail(`update of ${id} failed`)
    const b = db.budget_items.find(x => x.id === id)
    const oldBudget = b.budget_amount
    b.budget_amount = Number(oldBudget || 0) + deltas[id]
    b.owner_amount = Number(b.owner_amount ?? oldBudget ?? 0) + deltas[id]
  }
  Object.assign(co, { description: args.p_description, amount: args.p_amount, notes: args.p_notes, sov: args.p_sov })
  return { data: { ok: true, status: 'approved', budget_applied: true, lines: Object.keys(deltas).length, deltas }, error: null }
}
const line = id => mockState.db.budget_items.find(b => b.id === id)
const co = id => mockState.db.prime_change_orders.find(c => c.id === id)
const post = (body, headers) => review.POST(req('/api/prime-change-orders/review', body, headers))

// ═══════════════════════════════ 15. Details ═══════════════════════════════
const FULL_COMMERCIAL = {
  job_number: '7469', project_name: 'Braum Conway', location: 'Conway, AR',
  contract_value: 125000.5, markup_pct: 12.5, payment_type: 'owner_pays_direct',
  billing_frequency: 'biweekly', billing_due_day: 5, billing_anchor_date: '2026-11-13',
  start_date: '2026-11-01', status: 'active',
  sub_billing_start: '2026-11-10', sub_billing_frequency: 'biweekly', sub_billing_due: 2, sub_billing_anchor: '2026-11-10',
  owner_billing_start: '2026-11-25', owner_billing_frequency: 'monthly', owner_billing_due: 25, owner_billing_anchor: '2026-11-25',
  owner_company: 'Braum Inc', owner_name: 'Pat', owner_email: 'pat@braum.com', owner_phone: '555',
  architect_name: 'Ari', architect_company: 'Arch Co', architect_email: 'ari@arch.com',
  engineer_name: 'Eng', engineer_company: 'Eng Co', engineer_email: 'eng@eng.com',
  permit_number: 'BP-9', permit_date: '2026-10-30', scope_notes: 'Store', pm_email: 'pm@nv.com',
  billing_type: 'draw_request', rollup_general_conditions: true, nv_role: 'sub',
}

describe('15. commercial Details allow-list (lib/job-details.js)', () => {
  test('every field the commercial Details form submits is kept and validated', () => {
    const r = commercialDetailsUpdate(FULL_COMMERCIAL, { status: 'on_hold', archived: false }, { isOwner: false })
    expect(r.error).toBeUndefined()
    expect(r.fields).toEqual(FULL_COMMERCIAL)
    expect(Object.keys(FULL_COMMERCIAL).every(k => COMMERCIAL_DETAIL_FIELDS.includes(k))).toBe(true)
  })
  test('the page sends exactly the allow-listed keys (nothing silently dropped)', () => {
    const page = read('app/jobdetail/page.js')
    const body = page.slice(page.indexOf('async function saveJob(e)'), page.indexOf('// Owner-only Archive / Unarchive'))
    const obj = body.slice(body.indexOf('const fields = {'), body.indexOf('\n    }\n', body.indexOf('const fields = {')))
    const keys = [...obj.matchAll(/(?:^|[\s,{])([a-z_]+):/g)].map(m => m[1])
    expect(keys.length).toBeGreaterThan(30)
    for (const k of keys) expect(COMMERCIAL_DETAIL_FIELDS).toContain(k)
    for (const k of Object.keys(FULL_COMMERCIAL)) expect(keys).toContain(k)
  })
  test.each([
    [{ payment_type: 'cash' }], [{ billing_frequency: 'daily' }], [{ nv_role: 'owner' }], [{ billing_type: 'invoice' }],
    [{ markup_pct: 'abc' }], [{ markup_pct: -1 }], [{ markup_pct: 5000 }], [{ billing_frequency: 'monthly', billing_due_day: 40 }],
    [{ billing_frequency: 'weekly', billing_due_day: 7 }], [{ billing_anchor_date: 'soon' }], [{ architect_email: 'nope' }],
    [{ engineer_email: 'x@' }], [{ rollup_general_conditions: 'yes' }], [{ contract_value: 'abc' }], [{ status: 'archived' }],
  ])('invalid %j is refused', fields => {
    expect(commercialDetailsUpdate(fields, { status: 'active' }).error).toBeTruthy()
  })
  test('unknown / protected keys are dropped (archived, job_type, id)', () => {
    expect(commercialDetailsUpdate({ archived: false, job_type: 'residential', id: 'x', created_at: 'y', permit_number: 'P' }, {}).fields).toEqual({ permit_number: 'P' })
  })
  test('residential jobs keep the residential set (commercial keys dropped)', () => {
    expect(jobDetailsUpdate({ markup_pct: 10, permit_number: 'P' }, { job_type: 'residential' }).fields).toEqual({ permit_number: 'P' })
    expect(jobDetailsUpdate({ markup_pct: 10 }, { job_type: 'commercial' }).fields).toEqual({ markup_pct: 10 })
    expect(jobDetailsUpdate({ markup_pct: 10 }, { job_type: null }).fields).toEqual({ markup_pct: 10 })
    expect(residentialDetailsUpdate({ markup_pct: 10 }).fields).toEqual({})
  })
})

describe('15. POST /api/jobs/details for a commercial job', () => {
  test('full commercial save is written and the saved row is returned', async () => {
    as('pm')
    const r = await json(await details.POST(req('/api/jobs/details', { id: JC, fields: FULL_COMMERCIAL })))
    expect(r.status).toBe(200)
    expect(r.body.job).toMatchObject({ markup_pct: 12.5, payment_type: 'owner_pays_direct', nv_role: 'sub', billing_type: 'draw_request', rollup_general_conditions: true, architect_email: 'ari@arch.com' })
    expect(r.body.unarchived).toBe(false)
  })
  test('invalid input fails with nothing written', async () => {
    as('pm')
    const r = await json(await details.POST(req('/api/jobs/details', { id: JC, fields: { ...FULL_COMMERCIAL, payment_type: 'bogus' } })))
    expect(r.status).toBe(400)
    expect(mockState.calls.filter(c => c.op === 'update')).toHaveLength(0)
  })
  test('fields must be an object', async () => {
    as('pm')
    expect((await details.POST(req('/api/jobs/details', { id: JC, fields: [1] }))).status).toBe(400)
  })
  test('archived job: non-Owner editing other fields never unarchives; forged archived/status refused', async () => {
    as('admin')
    // Same status + forged archived:false → saved, still archived
    const ok = await json(await details.POST(req('/api/jobs/details', { id: JX, fields: { status: 'active', archived: false, permit_number: 'P1' } })))
    expect(ok.status).toBe(200)
    expect(mockState.db.jobs[2]).toMatchObject({ archived: true, permit_number: 'P1' })
    mockState.db.jobs[2].status = 'complete'
    const bad = await json(await details.POST(req('/api/jobs/details', { id: JX, fields: { status: 'active' } })))
    expect(bad.status).toBe(400)
    expect(mockState.db.jobs[2]).toMatchObject({ archived: true, status: 'complete' })
  })
  test('Owner deliberately setting Active unarchives (existing rule)', async () => {
    as('principal')
    mockState.db.jobs[2].status = 'on_hold'
    const r = await json(await details.POST(req('/api/jobs/details', { id: JX, fields: { status: 'active' } })))
    expect(r.body).toMatchObject({ ok: true, unarchived: true })
    expect(mockState.db.jobs[2]).toMatchObject({ archived: false, status: 'active' })
  })
  test('unassigned APM and supers are refused', async () => {
    as('apm')
    expect((await details.POST(req('/api/jobs/details', { id: JX, fields: { permit_number: 'x' } }))).status).toBe(403)
    as('super')
    expect((await details.POST(req('/api/jobs/details', { id: JC, fields: { permit_number: 'x' } }))).status).toBe(403)
  })
})

describe('15. commercial page saveJob', () => {
  const page = read('app/jobdetail/page.js')
  const body = page.slice(page.indexOf('async function saveJob(e)'), page.indexOf('// Owner-only Archive / Unarchive'))
  test('posts to /api/jobs/details; no direct jobs.update, no schema-cache field-dropping retry, no archived:false', () => {
    expect(body).toContain("authFetch('/api/jobs/details'")
    expect(body).not.toMatch(/from\('jobs'\)\.update/)
    expect(body).not.toContain('schema cache')
    expect(body).not.toMatch(/archived\s*=\s*false|archived:\s*false/)
  })
  test('local state comes from the server row; errors keep input; busy cleared in finally', () => {
    expect(body).toContain('const saved = data.job')
    expect(body).toContain('setJob(j => ({ ...j, ...saved }))')
    expect(body).toMatch(/finally \{\s*setSaving\(false\)/)
  })
  test('Status select is disabled for archived non-Owners', () => {
    expect(page).toContain("onChange={e => update('status', e.target.value)} disabled={!!job.archived && !isPrincipal(userRole)}")
  })
})

// ═══════════════════════════════ 16. Prime CO ═══════════════════════════════
describe('16. helpers', () => {
  test('normalizeSov validates rows', () => {
    expect(normalizeSov([]).sov).toBeNull()
    expect(normalizeSov([{ budget_item_id: B1, amount: '12.345', description: 'x' }]).sov).toEqual([{ budget_item_id: B1, amount: 12.35, description: 'x' }])
    expect(normalizeSov([{ budget_item_id: 'nope', amount: 1 }]).error).toBeTruthy()
    expect(normalizeSov([{ budget_item_id: B1, amount: 'abc' }]).error).toBeTruthy()
    expect(normalizeSov({}).error).toBeTruthy()
  })
  test('primeCOLineIds: SOV lines; residential falls back to budget_item_id', () => {
    expect(primeCOLineIds({ sov: [{ budget_item_id: B1, amount: 5 }, { budget_item_id: B1, amount: -5 }, { budget_item_id: B2, amount: 0 }] })).toEqual([])
    expect(primeCOLineIds({ sov: null, amount: 9, budget_item_id: BR }, { residential: true })).toEqual([BR])
    expect(primeCOLineIds({ sov: null, amount: 9 }, { residential: true, budgetItemId: BR })).toEqual([BR])
    expect(primeCOLineIds({ sov: null, amount: 9, budget_item_id: BR })).toEqual([])
  })
  test('reviewer roles', () => {
    expect(['principal', 'pm', 'apm', 'admin'].every(r => canReviewPrimeCO(r, false))).toBe(true)
    expect(canReviewPrimeCO('super', false)).toBe(false)
    expect(canReviewPrimeCO('apm', true)).toBe(false)
    expect(canReviewPrimeCO('pm', true)).toBe(true)
  })
  test('missing function maps to 503 migration-required', () => {
    expect(primeCORpcError({ code: 'PGRST202', message: 'Could not find the function public.prime_co_review' })).toMatchObject({ status: 503, migration_required: '049' })
    expect(primeCORpcError({ message: 'prime_co_already_applied' }).status).toBe(409)
  })
})

describe('16. POST /api/prime-change-orders/review', () => {
  test('migration 049 missing: 503, nothing written, no client-loop fallback', async () => {
    as('pm')
    const r = await json(await post({ co_id: CO1, action: 'approve' }))
    expect(r.status).toBe(503)
    expect(r.body.migration_required).toBe('049')
    expect(writes()).toHaveLength(0)
    expect(co(CO1)).toMatchObject({ status: 'pending', budget_applied: false })
    expect(line(B1).budget_amount).toBe(1000)
  })

  test('approve applies every line and sets the flag together; contract_value untouched', async () => {
    enableRpc(); as('pm')
    const r = await json(await post({ co_id: CO1, action: 'approve' }))
    expect(r.status).toBe(200)
    expect(co(CO1)).toMatchObject({ status: 'approved', budget_applied: true })
    expect(line(B1)).toMatchObject({ budget_amount: 1100, owner_amount: 1300 })
    expect(line(B2)).toMatchObject({ budget_amount: 2200, owner_amount: 2200 })
    expect(line(B3)).toMatchObject({ budget_amount: 3300, owner_amount: 3300 })
    expect(mockState.db.jobs[0].contract_value).toBe(100000)
    expect(writes()).toHaveLength(0) // only the RPC wrote
  })

  test.each([[B1, 'first'], [B2, 'middle'], [B3, 'last']])('%s (%s) line failure: CO stays pending, no flag, no line moved; retry applies once', async (bad) => {
    enableRpc(); as('pm')
    mockState.failLines = [bad]
    const r = await json(await post({ co_id: CO1, action: 'approve' }))
    expect(r.status).toBe(500)
    expect(co(CO1)).toMatchObject({ status: 'pending', budget_applied: false })
    expect([line(B1).budget_amount, line(B2).budget_amount, line(B3).budget_amount]).toEqual([1000, 2000, 3000])
    mockState.failLines = []
    expect((await post({ co_id: CO1, action: 'approve' })).status).toBe(200)
    expect([line(B1).budget_amount, line(B2).budget_amount, line(B3).budget_amount]).toEqual([1100, 2200, 3300])
  })

  test('double / concurrent approve of the same CO applies once', async () => {
    enableRpc(); as('pm')
    const [a, b] = await Promise.all([post({ co_id: CO1, action: 'approve' }), post({ co_id: CO1, action: 'approve' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(line(B1).budget_amount).toBe(1100)
  })

  test('two COs on the same line both land (no lost increment)', async () => {
    enableRpc(); as('pm')
    await Promise.all([post({ co_id: CO3, action: 'approve' }), post({ co_id: CO2, action: 'apply' })])
    expect(line(B1)).toMatchObject({ budget_amount: 1125, owner_amount: 1325 })
  })

  test('apply: failure keeps approved / not applied (retry offered); success sets flag; second apply refused', async () => {
    enableRpc(); as('pm')
    mockState.failLines = [B1]
    expect((await post({ co_id: CO2, action: 'apply' })).status).toBe(500)
    expect(co(CO2)).toMatchObject({ status: 'approved', budget_applied: false })
    mockState.failLines = []
    expect((await post({ co_id: CO2, action: 'apply' })).status).toBe(200)
    expect(co(CO2).budget_applied).toBe(true)
    expect((await post({ co_id: CO2, action: 'apply' })).status).toBe(409)
    expect(line(B1).budget_amount).toBe(1050)
  })

  test('wrong-job line refused before any RPC / mutation', async () => {
    enableRpc(); as('principal')
    const r = await json(await post({ co_id: COX, action: 'approve' }))
    expect(r.status).toBe(400)
    expect(mockState.calls.some(c => c.op === 'rpc')).toBe(false)
    expect(line(BX).budget_amount).toBe(5)
    // ...also when assigned in the approve request
    const r2 = await json(await post({ co_id: CO3, action: 'approve', sov: [{ budget_item_id: BX, amount: 75 }] }))
    expect(r2.status).toBe(400)
    expect(co(CO3).status).toBe('pending')
  })

  test('approve with assigned SOV saves the lines in the same transaction', async () => {
    enableRpc(); as('pm')
    const r = await post({ co_id: CO3, action: 'approve', sov: [{ budget_item_id: B2, amount: 75, description: 'x' }] })
    expect(r.status).toBe(200)
    expect(co(CO3)).toMatchObject({ status: 'approved', budget_applied: true, sov: [{ budget_item_id: B2, amount: 75, description: 'x' }] })
    expect(line(B2).budget_amount).toBe(2075)
    expect(line(B1).budget_amount).toBe(1000)
  })

  test('access: super (even assigned), unassigned PM/APM, subs refused; assigned APM ok (commercial)', async () => {
    enableRpc()
    for (const [role, extra] of [['super', {}], ['pm', { email: 'other@nv.com', userId: 'u-x' }], ['apm', { userId: 'u-y' }], ['subcontractor', {}], ['owner', {}]]) {
      as(role, extra)
      expect((await post({ co_id: CO1, action: 'approve' })).status).toBe(403)
    }
    expect(co(CO1).status).toBe('pending')
    as('apm')
    expect((await post({ co_id: CO1, action: 'approve' })).status).toBe(200)
  })

  test('preview session refused at the route (middleware blocks too)', async () => {
    enableRpc(); as('principal')
    const r = await post({ co_id: CO1, action: 'approve' }, { cookie: 'nvc_preview=abc; other=1' })
    expect(r.status).toBe(403)
    expect(co(CO1).status).toBe('pending')
    expect(mockState.calls).toHaveLength(0)
  })

  test('bad input', async () => {
    enableRpc(); as('pm')
    expect((await post({ co_id: 'x', action: 'approve' })).status).toBe(400)
    expect((await post({ co_id: CO1, action: 'flag' })).status).toBe(400)
    expect((await post({ co_id: 'c9000000-0000-4000-8000-000000000009', action: 'approve' })).status).toBe(404)
    expect((await post({ co_id: CO1, action: 'approve', sov: 'x' })).status).toBe(400)
  })

  test('commercial reject: pending → rejected, no budget change; approved+applied not reversible here', async () => {
    enableRpc(); as('pm')
    expect((await post({ co_id: CO3, action: 'reject' })).status).toBe(200)
    expect(co(CO3).status).toBe('rejected')
    co(CO2).budget_applied = true
    expect((await post({ co_id: CO2, action: 'reject' })).status).toBe(409)
    expect(line(B1).budget_amount).toBe(1000)
  })

  describe('residential', () => {
    test('approve needs a line; picked line + flag + sov saved together; contract unchanged', async () => {
      enableRpc(); as('pm')
      expect((await post({ co_id: COR, action: 'approve' })).status).toBe(400)
      expect(co(COR).status).toBe('pending')
      const r = await post({ co_id: COR, action: 'approve', budget_item_id: BR })
      expect(r.status).toBe(200)
      expect(co(COR)).toMatchObject({ status: 'approved', budget_applied: true, budget_item_id: BR })
      expect(line(BR)).toMatchObject({ budget_amount: 1150, owner_amount: 1250 })
      expect(mockState.db.jobs[1].contract_value).toBe(50000)
    })
    test('failure leaves pending with nothing applied; retry safe', async () => {
      enableRpc(); as('pm')
      mockState.failLines = [BR]
      expect((await post({ co_id: COR, action: 'approve', budget_item_id: BR })).status).toBe(500)
      expect(co(COR)).toMatchObject({ status: 'pending', budget_applied: false, budget_item_id: null })
      expect(line(BR).budget_amount).toBe(900)
      mockState.failLines = []
      expect((await post({ co_id: COR, action: 'approve', budget_item_id: BR })).status).toBe(200)
      expect((await post({ co_id: COR, action: 'approve', budget_item_id: BR })).status).toBe(409)
      expect(line(BR).budget_amount).toBe(1150)
    })
    test('reject & reverse (Owner/PM) takes the amounts back off in the same transaction', async () => {
      enableRpc(); as('pm')
      await post({ co_id: COR, action: 'approve', budget_item_id: BR })
      mockState.failLines = [BR]
      expect((await post({ co_id: COR, action: 'reject' })).status).toBe(500)
      expect(co(COR)).toMatchObject({ status: 'approved', budget_applied: true })
      expect(line(BR).budget_amount).toBe(1150)
      mockState.failLines = []
      expect((await post({ co_id: COR, action: 'reject' })).status).toBe(200)
      expect(co(COR)).toMatchObject({ status: 'rejected', budget_applied: false })
      expect(line(BR)).toMatchObject({ budget_amount: 900, owner_amount: 1000 })
    })
    test('APM and admin cannot review residential COs (page offers Owner/PM only)', async () => {
      enableRpc()
      as('apm'); expect((await post({ co_id: COR, action: 'approve', budget_item_id: BR })).status).toBe(403)
      as('admin'); expect((await post({ co_id: COR, action: 'approve', budget_item_id: BR })).status).toBe(403)
    })
    test('residential approve refuses sov; commercial approve refuses budget_item_id', async () => {
      enableRpc(); as('principal')
      expect((await post({ co_id: COR, action: 'approve', sov: [] })).status).toBe(400)
      expect((await post({ co_id: CO1, action: 'approve', budget_item_id: B1 })).status).toBe(400)
    })
  })
})

// ═════════════ 53b A. Edit (revise) / delete of commercial prime COs ═════════════
describe('53b A. revise / delete through POST /api/prime-change-orders/review', () => {
  // CO2 approved + applied with SOV B1 50; budget lines already include it.
  const applied = () => { Object.assign(co(CO2), { budget_applied: true, description: 'Old', notes: null }) }
  const lines = () => [line(B1).budget_amount, line(B2).budget_amount, line(B3).budget_amount]
  const NEW_SOV = [{ budget_item_id: B1, amount: 20, description: 'a' }, { budget_item_id: B2, amount: 40, description: 'b' }]
  const revise = (extra = {}) => post({ co_id: CO2, action: 'revise', description: 'New', amount: 60, notes: 'n', sov: NEW_SOV, ...extra })

  test('successful revise nets old → new once (B1 −30, B2 +40) and saves the CO; contract untouched', async () => {
    enableRpc(); applied(); as('pm')
    const r = await json(await revise())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, resynced: true })
    expect(lines()).toEqual([970, 2040, 3000])
    expect(line(B1).owner_amount).toBe(1170)
    expect(co(CO2)).toMatchObject({ description: 'New', amount: 60, notes: 'n', status: 'approved', budget_applied: true, sov: NEW_SOV })
    expect(mockState.db.jobs[0].contract_value).toBe(100000)
    expect(writes()).toHaveLength(0) // only the RPC wrote
  })

  test('retry / double click after success does not double-apply', async () => {
    enableRpc(); applied(); as('pm')
    expect((await revise()).status).toBe(200)
    expect((await revise()).status).toBe(200)
    const [a, b] = await Promise.all([revise(), revise()])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(lines()).toEqual([970, 2040, 3000])
  })

  test.each([[B1, 'reversed line'], [B2, 'new line']])('revise failure on %s (%s) leaves stored SOV, CO and every budget line unchanged; retry applies once', async (bad) => {
    enableRpc(); applied(); as('pm')
    const before = JSON.parse(JSON.stringify(co(CO2)))
    mockState.failLines = [bad]
    expect((await revise()).status).toBe(500)
    expect(co(CO2)).toEqual(before)
    expect(lines()).toEqual([1000, 2000, 3000])
    mockState.failLines = []
    expect((await revise()).status).toBe(200)
    expect(lines()).toEqual([970, 2040, 3000])
  })

  test('migration 049 missing: 503 before any mutation, no /api/budget-items style fallback', async () => {
    mockState.rpc.prime_co_review = primeCoReviewSim // review present, revise missing
    applied(); as('pm')
    const r = await json(await revise())
    expect(r.status).toBe(503)
    expect(r.body.migration_required).toBe('049')
    expect(r.body.error).toMatch(/prime_co_revise/)
    expect(writes()).toHaveLength(0)
    expect(co(CO2)).toMatchObject({ description: 'Old', sov: [{ budget_item_id: B1, amount: 50 }] })
    expect(lines()).toEqual([1000, 2000, 3000])
  })

  test('preview cannot take the resync path (route 403, no RPC, nothing written)', async () => {
    enableRpc(); applied(); as('principal')
    const r = await post({ co_id: CO2, action: 'revise', description: 'New', amount: 60, sov: NEW_SOV }, { cookie: 'nvc_preview=x' })
    expect(r.status).toBe(403)
    expect(mockState.calls).toHaveLength(0)
    expect(co(CO2)).toMatchObject({ description: 'Old', sov: [{ budget_item_id: B1, amount: 50 }] })
    expect(lines()).toEqual([1000, 2000, 3000])
  })

  test('revise to a line on another job refused before the RPC', async () => {
    enableRpc(); applied(); as('pm')
    expect((await revise({ sov: [{ budget_item_id: BX, amount: 50 }] })).status).toBe(400)
    expect(mockState.calls.some(c => c.op === 'rpc')).toBe(false)
    expect(line(BX).budget_amount).toBe(5)
  })

  test('pending / approved-not-applied edit saves metadata only: no RPC, no budget move, never sets status or flag', async () => {
    as('pm') // RPC not even present
    const r = await json(await post({ co_id: CO3, action: 'revise', description: 'Edited', amount: 80, notes: '', sov: [{ budget_item_id: B2, amount: 80 }] }))
    expect(r.status).toBe(200)
    expect(r.body.resynced).toBe(false)
    expect(co(CO3)).toMatchObject({ description: 'Edited', amount: 80, notes: null, status: 'pending', budget_applied: false, sov: [{ budget_item_id: B2, amount: 80, description: '' }] })
    const upd = mockState.calls.filter(c => c.table === 'prime_change_orders' && c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(Object.keys(upd[0].payload).sort()).toEqual(['amount', 'description', 'notes', 'sov'])
    expect(mockState.calls.some(c => c.table === 'budget_items')).toBe(false)
    expect(lines()).toEqual([1000, 2000, 3000])
    // approved, not applied: same
    expect((await post({ co_id: CO2, action: 'revise', description: 'A', amount: 50, sov: [{ budget_item_id: B1, amount: 50 }] })).status).toBe(200)
    expect(co(CO2)).toMatchObject({ description: 'A', status: 'approved', budget_applied: false })
  })

  test('un-applied edit that races an apply lands nowhere (409)', async () => {
    as('pm')
    mockState.beforeWrite = (t, op) => { if (t === 'prime_change_orders' && op === 'update') { co(CO2).budget_applied = true; mockState.beforeWrite = null } }
    const r = await post({ co_id: CO2, action: 'revise', description: 'Racy', amount: 999, sov: [{ budget_item_id: B1, amount: 999 }] })
    expect(r.status).toBe(409)
    expect(co(CO2)).toMatchObject({ amount: 50, sov: [{ budget_item_id: B1, amount: 50 }] })
  })

  test('revise input validation, residential refused, supers / unassigned refused', async () => {
    enableRpc(); applied(); as('pm')
    expect((await revise({ description: '  ' })).status).toBe(400)
    expect((await revise({ amount: 'abc' })).status).toBe(400)
    expect((await revise({ sov: [{ budget_item_id: B1, amount: 'x' }] })).status).toBe(400)
    expect((await post({ co_id: COR, action: 'revise', description: 'x', amount: 1 })).status).toBe(400)
    as('super'); expect((await revise()).status).toBe(403)
    as('apm', { userId: 'u-y' }); expect((await revise()).status).toBe(403)
    expect(lines()).toEqual([1000, 2000, 3000])
  })

  test('delete of an applied CO is refused: no delete, no budget loop, nothing changed', async () => {
    enableRpc(); applied(); as('principal')
    const r = await json(await post({ co_id: CO2, action: 'delete' }))
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/already applied to the budget/)
    expect(co(CO2)).toBeTruthy()
    expect(mockState.calls).toHaveLength(0)
    expect(lines()).toEqual([1000, 2000, 3000])
  })

  test('delete: numbered refused; unnumbered pending deleted with no budget touch; preview refused; race with apply → 409', async () => {
    as('pm')
    co(CO3).co_number = 4
    expect((await post({ co_id: CO3, action: 'delete' })).status).toBe(409)
    expect(co(CO3)).toBeTruthy()
    co(CO3).co_number = null
    expect((await post({ co_id: CO3, action: 'delete' }, { cookie: 'nvc_preview=x' })).status).toBe(403)
    expect(co(CO3)).toBeTruthy()
    expect((await post({ co_id: CO3, action: 'delete' })).status).toBe(200)
    expect(co(CO3)).toBeUndefined()
    expect(mockState.calls.some(c => c.table === 'budget_items')).toBe(false)
    mockState.beforeWrite = (t, op) => { if (t === 'prime_change_orders' && op === 'delete') { co(CO2).budget_applied = true; mockState.beforeWrite = null } }
    expect((await post({ co_id: CO2, action: 'delete' })).status).toBe(409)
    expect(co(CO2)).toBeTruthy()
  })
})

describe('53b A. commercial page Edit / Delete use the API only', () => {
  const page = read('app/jobdetail/page.js')
  const del = page.slice(page.indexOf('async function deletePrimeCO'), page.indexOf('async function savePrimeCO'))
  const save = page.slice(page.indexOf('async function savePrimeCO'), page.indexOf('async function pushSubCOToPrime'))
  test('adjustBudgetLines and the sovBudgetDeltas client loop are gone', () => {
    expect(page).not.toContain('adjustBudgetLines')
    expect(page).not.toContain('sovBudgetDeltas')
    expect(page).not.toContain('applyCODeltas')
  })
  test('save posts action revise; no browser prime_change_orders write; no /api/budget-items', () => {
    expect(save).toContain("action: 'revise'")
    expect(save).toContain('postPrimeCOReview(')
    expect(save).not.toMatch(/from\('prime_change_orders'\)/)
    expect(save).not.toContain('/api/budget-items')
  })
  test('delete posts action delete; refuses applied/numbered first; no browser delete', () => {
    expect(del).toContain("action: 'delete'")
    expect(del).toContain('coDeleteBlock(co)')
    expect(del).toContain('PRIME_CO_APPLIED_NO_DELETE')
    expect(del).not.toMatch(/from\('prime_change_orders'\)/)
    expect(del).not.toContain('/api/budget-items')
  })
  test('Save / Delete disabled in role preview (postPrimeCOReview also checks)', () => {
    expect(page).toContain('disabled={savingPrimeCO || primeCOReviewLocked ||')
    expect(page).toContain('disabled={!!coDeleteBlock(co) || !!co.budget_applied || primeCOReviewLocked}')
  })
  test('no prime_change_orders update/delete left in any page', () => {
    for (const f of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js', 'app/owner/page.js', 'app/dashboard/page.js']) {
      expect(read(f)).not.toMatch(/from\('prime_change_orders'\)\.(update|delete)/)
    }
  })
})

describe('16. pages no longer write CO status / flag from the browser', () => {
  test('commercial: review/apply go through the API; no pre-write claim or flag', () => {
    const page = read('app/jobdetail/page.js')
    const s = page.slice(page.indexOf('async function postPrimeCOReview'), page.indexOf('async function deletePrimeCO'))
    expect(s).toContain("authFetch('/api/prime-change-orders/review'")
    expect(s).not.toMatch(/from\('prime_change_orders'\)/)
    expect(s).not.toContain('budget_applied: true')
    expect(s).toContain('isPreviewActive()')
    const approve = page.slice(page.indexOf('async function approvePrimeCOWithSOV'), page.indexOf('// ── Prime Contract Change Orders'))
    expect(approve).not.toMatch(/from\('prime_change_orders'\)/)
    // Apply to Budget still offered for any approved, unapplied CO
    expect(page).toContain("co.status === 'approved' && hasSov && !co.budget_applied && (")
    expect(page).toContain('disabled={primeCOReviewLocked}')
  })
  test('residential: approve / reject go through the API; no client budget loop', () => {
    const page = read('app/residentialjobdetail/page.js')
    const s = page.slice(page.indexOf('async function reviewPrimeCO(co, payload'), page.indexOf('// Sub change orders: same review'))
    expect(s).toContain("api('/api/prime-change-orders/review'")
    expect(s).not.toMatch(/from\('prime_change_orders'\)/)
    expect(s).not.toContain('/api/budget-items')
    expect(page).not.toContain('applyCODeltas')
    expect(page).toContain('const busy = reviewingCOId === co.id || inPreview')
  })
})

describe('16. migration 049 (written, not applied)', () => {
  const sql = read('migrations/049_prime_co_review_rpc.sql')
  test('one transactional function, locks CO and job-scoped lines, service_role only', () => {
    expect(sql).toMatch(/NOT applied/i)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.prime_co_review(')
    expect(sql).toMatch(/FROM public\.prime_change_orders WHERE id = p_co_id FOR UPDATE/)
    expect(sql).toMatch(/co\.job_id IS DISTINCT FROM p_job_id/)
    expect(sql).toMatch(/b\.job_id = co\.job_id\s+ORDER BY b\.id\s+FOR UPDATE/)
    expect(sql).toContain("RAISE EXCEPTION 'prime_co_line_wrong_job'")
    expect(sql).toContain("RAISE EXCEPTION 'prime_co_already_applied'")
    expect(sql).toMatch(/budget_amount = coalesce\(b\.budget_amount, 0\) \+ v_sign \* d\.value::numeric/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.prime_co_review[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.prime_co_review[\s\S]*TO service_role/)
  })
  test('53b: prime_co_revise locks the applied CO, nets lines, writes the CO last; service_role only', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.prime_co_revise('))
    expect(fn).toMatch(/FROM public\.prime_change_orders WHERE id = p_co_id FOR UPDATE/)
    expect(fn).toMatch(/co\.job_id IS DISTINCT FROM p_job_id/)
    expect(fn).toContain("RAISE EXCEPTION 'prime_co_not_applied'")
    expect(fn).toMatch(/-\(e->>'amount'\)::numeric/) // stored lines reversed
    expect(fn).toMatch(/b\.job_id = co\.job_id\s+ORDER BY b\.id\s+FOR UPDATE/)
    expect(fn).toContain("RAISE EXCEPTION 'prime_co_line_wrong_job'")
    expect(fn.indexOf('SET description = p_description')).toBeGreaterThan(fn.indexOf('UPDATE public.budget_items b'))
    expect(fn).not.toMatch(/SET[^;]*\bstatus\s*=|budget_applied\s*=/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.prime_co_revise[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.prime_co_revise[\s\S]*TO service_role/)
    expect(sql).not.toMatch(/^\s*DROP\b/im)
  })
  test('the budget update comes before the CO flag write (flag never claimed first)', () => {
    const lineUpd = sql.indexOf('UPDATE public.budget_items b')
    const flag = sql.indexOf("UPDATE public.prime_change_orders SET status = v_status, budget_applied = v_flag")
    expect(lineUpd).toBeGreaterThan(0)
    expect(flag).toBeGreaterThan(lineUpd)
  })
  test('additive only: no jobs / contract_value change, no table DDL, no data DML outside the function', () => {
    expect(sql).not.toMatch(/contract_value\s*=/)
    expect(sql).not.toMatch(/UPDATE public\.jobs/i)
    expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE|CREATE TABLE|DELETE FROM/i)
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '')
    expect(outside).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im)
  })
  test('applied migrations 042 / 044 / 045 / 046 / 047 are byte-for-byte untouched', () => {
    const files = ['042_drawings_aia_numbers_owner_draws.sql', '044_job_lifecycle_and_schedule_access.sql', '045_billing_integrity_co_numbers_lookahead.sql', '046_residential_access_and_bank_draws.sql', '047_cash_outlook_expected_payment_dates.sql']
    const out = execSync(`git diff --name-only HEAD -- ${files.map(f => 'migrations/' + f).join(' ')}`, { cwd: ROOT }).toString().trim()
    expect(out).toBe('')
  })
})
