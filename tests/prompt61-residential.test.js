/**
 * Prompt 61 — seven approved residential findings (11/8 review). In-memory DB only
 * (tests/helpers/mock-db.js): nothing real is read, written, emailed or migrated.
 *  1) billingDrawLockError: first review on an OPEN draw allowed; closed / approved→pending locked.
 *  2) draw package print: approved in the totals, pending "awaiting approval" outside them,
 *     rejected dollars left out; residential / commercial pickers approved-only.
 *  3) (billing-entry approval email + waiver: tests/prompt49-money-guards.test.js)
 *  4) migration 058 (unused): nv_cost + residential cost / price split, commercial unchanged.
 *  5) /api/owner-res-draws: who may read, residential only, unknown funded stays unknown.
 *  6) /api/res-inspections: office + assigned supers only; field app + office page wiring.
 *  7) /api/res-owner-draws: attachment compare-and-set with retry; submitted_date only on
 *     draft → submitted.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({
  Resend: function () {
    const { mockState } = require('./helpers/mock-db')
    this.emails = { send: async msg => { (mockState.emails = mockState.emails || []).push(msg); return { data: { id: 'e1' }, error: null } } }
  },
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (mockState.auth.error ? mockState.auth : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const req = (method, url, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.test`, role, error: null, ...extra } }
const noSession = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const json = async r => ({ status: r.status, body: await r.json() })

// ── 1) lock helper ────────────────────────────────────────────────────────────
describe('1) billingDrawLockError / isFirstReviewOnOpenDraw', () => {
  const { billingDrawLockError, isFirstReviewOnOpenDraw } = require('../lib/billing-fields')
  const open = { id: 'D', status: 'open', draw_number: 4 }
  const closed = { id: 'D', status: 'closed', draw_number: 4 }
  const pending = { status: 'pending', draw_request_id: 'D', amount_billed: 100, retainage_held: 0, retainage_pct: 0, billing_period: '2026-10-01', nv_reimbursement: false }
  const approved = { ...pending, status: 'approved' }

  test('pending → approved / rejected on an open draw: allowed', () => {
    expect(billingDrawLockError(pending, open, { status: 'approved' })).toBeNull()
    expect(billingDrawLockError(pending, open, { status: 'rejected', rejection_reason: 'x' })).toBeNull()
    expect(isFirstReviewOnOpenDraw('pending', 'approved', open)).toBe(true)
  })
  test('closed draw, unknown draw, approved → pending, pending → pending with money: locked', () => {
    expect(billingDrawLockError(pending, closed, { status: 'approved' })?.status).toBe(409)
    expect(billingDrawLockError(pending, null, { status: 'approved' })?.status).toBe(409)
    expect(billingDrawLockError(approved, open, { status: 'pending' })?.status).toBe(409)
    expect(billingDrawLockError(pending, open, { status: 'approved', amount_billed: 1 })?.status).toBe(409)
    expect(billingDrawLockError(pending, open, { amount_billed: 1 })?.status).toBe(409)
    expect(billingDrawLockError(pending, open, { billing_period: '2026-11-01' })?.status).toBe(409)
    expect(isFirstReviewOnOpenDraw('rejected', 'approved', open)).toBe(false)
  })
  test('untagged: never locked', () => {
    expect(billingDrawLockError({ ...pending, draw_request_id: null }, null, { status: 'approved', amount_billed: 5 })).toBeNull()
  })
})

// ── 2) print + pickers ───────────────────────────────────────────────────────
describe('2) draw package print counts approved billings only', () => {
  const { buildDrawPackageHtml } = require('../lib/residential-print')
  const html = buildDrawPackageHtml({
    job: { job_number: 'R-1', project_name: 'Lot 9' },
    draw: { draw_number: 5, title: 'Draw 5' },
    costs: [{ description: 'Lumber', amount: 1000 }, { description: 'Return', amount: 100, is_credit: true }],
    billings: [
      { company_name: 'Approved Co', amount_billed: 2000, status: 'approved' },
      { company_name: 'Waiting Co', amount_billed: 4444, status: 'pending' },
      { company_name: 'Rejected Co', amount_billed: 7777, status: 'rejected' },
    ],
  })
  const grand = html.slice(html.indexOf('Grand Total'), html.indexOf('Grand Total') + 200)

  test('Grand Total = costs net of credits + approved billings', () => {
    expect(grand).toContain('$2,900.00')
    expect(html).toMatch(/Sub Billings Total<\/td><td class="num">\$2,000\.00/)
  })
  test('pending listed as awaiting approval, outside every total', () => {
    expect(html).toContain('Awaiting Approval — not included in the total')
    expect(html).toContain('Waiting Co')
    expect(html.indexOf('Waiting Co')).toBeGreaterThan(html.indexOf('Grand Total'))
    expect(html).not.toContain('$7,344.00') // 2900 + 4444 would be a pending-inclusive total
  })
  test('rejected dollars do not appear anywhere in the package', () => {
    expect(html).not.toContain('Rejected Co')
    expect(html).not.toContain('7,777')
    expect(html).not.toContain('$10,677.00')
  })
  test('nothing approved: no Grand Total from pending dollars', () => {
    const h = buildDrawPackageHtml({ job: {}, draw: { draw_number: 1 }, billings: [{ company_name: 'W', amount_billed: 50, status: 'pending' }] })
    expect(h).not.toContain('<div class="grand-total">')
    expect(h).toContain('Nothing approved is on this draw yet.')
    expect(h).toContain('Awaiting approval (not in Grand Total)')
  })
  test('residential "Add sub billings" list and commercial picker are approved-only', () => {
    const res = read('app/residentialjobdetail/page.js')
    expect(res).toContain("const undrawnBillings = billingSubmissions.filter(b => !b.draw_request_id && b.status === 'approved')")
    const com = read('app/jobdetail/page.js')
    const fn = com.slice(com.indexOf('async function assignBillingToDraw'), com.indexOf('async function assignBillingToDraw') + 600)
    expect(fn).toMatch(/b\.status !== 'approved'/)
    expect(com).toMatch(/disabled=\{!b\.draw_request_id && b\.status !== 'approved'\}/)
  })
})

describe('1/3) job pages send the first review and surface the waiver result', () => {
  const com = read('app/jobdetail/page.js')
  const fn = com.slice(com.indexOf('async function updateBillingEntry'), com.indexOf('function billingToEditForm'))
  test('commercial: status / reviewed_at / reason / email_sub only stripped when NOT a first review on an open draw', () => {
    expect(fn).toMatch(/isFirstReviewOnOpenDraw\(editBillingForm\.original_status, editBillingForm\.status, editDraw\)/)
    expect(fn).toMatch(/for \(const k of \['amount_billed', 'retainage_pct', 'retainage_held', 'nv_reimbursement', 'billing_period'\]\) delete patchData\[k\]/)
    expect(fn).toMatch(/if \(!firstReviewOnDraw\) for \(const k of \['status', 'reviewed_at', 'rejection_reason', 'email_sub'\]\) delete patchData\[k\]/)
    expect(fn).toMatch(/result\.waiverError/)
  })
  test('residential: approve shows waiver errors; Lien Waivers tab has Send / Resend (POST /api/lien-waiver, resend)', () => {
    const res = read('app/residentialjobdetail/page.js')
    expect(res).toMatch(/result\.waiverError/)
    expect(res).toMatch(/api\('\/api\/lien-waiver', jsonOpts\('POST', \{ submission_id: b\.id, resend: true \}\)\)/)
    expect(res).toMatch(/b\.lien_waiver_sent_at \? 'Resend' : 'Send waiver'/)
  })
  test('dashboard no longer fires a second client waiver POST', () => {
    expect(read('app/dashboard/page.js')).not.toMatch(/\/api\/lien-waiver/)
  })
  test('only lib/lien-waiver.js writes lien_waiver_sent_at', () => {
    const writers = []
    const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js') && /lien_waiver_sent_at:/.test(fs.readFileSync(p, 'utf8'))) writers.push(path.relative(path.join(__dirname, '..'), p)) } }
    walk(path.join(__dirname, '../app')); walk(path.join(__dirname, '../lib'))
    expect(writers).toEqual(['lib/lien-waiver.js'])
  })
})

// ── 4) migration 058 + CO form ───────────────────────────────────────────────
describe('1) migration 059 (written, not applied): first review only while the draw is open', () => {
  const sql = read('migrations/059_billing_open_draw_first_review.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('one function: holds the open draw FOR SHARE, then a guarded billing update; service_role only', () => {
    expect(sql).toMatch(/NOT applied/)
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.billing_first_review\(\s*p_billing_id uuid,\s*p_draw_id\s+uuid,\s*p_status\s+text,\s*p_patch\s+jsonb\s*\)/)
    expect(code).toMatch(/FROM public\.draw_requests\s+WHERE id = p_draw_id AND status = 'open'\s+FOR SHARE;/)
    expect(code.indexOf('FOR SHARE')).toBeLessThan(code.indexOf('UPDATE public.billing_submissions'))
    expect(code).toMatch(/WHERE b\.id = \$2 AND b\.status = ''pending'' AND b\.draw_request_id = \$3/)
    expect(code).toMatch(/p_status NOT IN \('approved', 'rejected'\)/)
    expect(code).toMatch(/'amount_billed', 'retainage_pct', 'retainage_held', 'nv_reimbursement', 'billing_period'/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.billing_first_review\(uuid, uuid, text, jsonb\)\s*FROM PUBLIC, anon, authenticated;/)
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.billing_first_review\(uuid, uuid, text, jsonb\)\s*TO service_role;/)
    expect(code).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/)
  })
  test('the route calls it for a first review on a draw; when missing it uses the checked JS fallback, never migration_required', () => {
    const route = read('app/api/billing-entry/route.js')
    expect(route).toMatch(/adminSupabase\.rpc\('billing_first_review'/)
    expect(route).toMatch(/if \(rpcMissing\(error\)\) return firstReviewFallback\(/)
    expect(route).not.toMatch(/migration_required/)
    expect(route).not.toMatch(/take it off the draw, review it/)
    const used = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
    expect(used.some(f => /^05[12]_/.test(f))).toBe(false)
  })
})

describe('4) migration 058 (written, not applied)', () => {
  const sql = read('migrations/058_res_co_nv_cost.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('adds nullable nv_cost and replaces prime_co_review with the 049 signature', () => {
    expect(code).toMatch(/ALTER TABLE public\.prime_change_orders ADD COLUMN IF NOT EXISTS nv_cost numeric;/)
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.prime_co_review\(\s*p_co_id uuid,\s*p_job_id uuid,\s*p_action text,\s*p_sov jsonb,\s*p_set_sov boolean,\s*p_budget_item_id uuid,\s*p_residential boolean,\s*p_allow_reverse boolean\s*\)/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.prime_co_review\(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean\)\s*FROM PUBLIC, anon, authenticated;/)
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.prime_co_review\(uuid, uuid, text, jsonb, boolean, uuid, boolean, boolean\)\s*TO service_role;/)
  })
  test('cost = coalesce(nv_cost, price) for residential only; Bank always moves by the price', () => {
    expect(code).toMatch(/v_cost_deltas := v_deltas;/)
    expect(code).toMatch(/IF v_residential AND co\.nv_cost IS NOT NULL AND v_deltas <> '\{\}'::jsonb THEN/)
    expect(code).toMatch(/budget_amount = coalesce\(b\.budget_amount, 0\) \+ v_sign \* coalesce\(\(v_cost_deltas ->> d\.key\)::numeric, d\.value::numeric\)/)
    expect(code).toMatch(/owner_amount {2}= coalesce\(b\.owner_amount, b\.budget_amount, 0\) \+ v_sign \* d\.value::numeric/)
    expect(code).toMatch(/RAISE EXCEPTION 'prime_co_cost_multi_line'/)
  })
  test('no revise change, no data backfill, no contract_value write', () => {
    expect(code).not.toMatch(/prime_co_revise/)
    expect(code).not.toMatch(/UPDATE public\.prime_change_orders SET nv_cost/i)
    expect(code).not.toMatch(/contract_value/)
    expect(code).not.toMatch(/UPDATE public\.jobs/i)
  })
  test('the new RPC error has a clear message', () => {
    const { primeCORpcError } = require('../lib/prime-co-review')
    expect(primeCORpcError({ message: 'prime_co_cost_multi_line' })).toMatchObject({ status: 400, error: expect.stringMatching(/one line only/) })
  })
  test('residential CO form: optional Nv cost; insert omits it when the column is missing', () => {
    const res = read('app/residentialjobdetail/page.js')
    expect(res).toMatch(/If left blank, Nv cost = the sale price\./)
    expect(res).toMatch(/\.\.\.\(nvCost !== null \? \{ nv_cost: nvCost \} : \{\}\)/)
    expect(res).toMatch(/if \(error && nvCost !== null && \/nv_cost\/\.test\(error\.message \|\| ''\)\)/)
    expect(res).toMatch(/budgetContractCheck\(\{ job, changeOrders, costTotal: budgetTotal, bankTotal \}\)/)
    expect(res).not.toMatch(/amountsDiffer\(bankTotal, baseContract\)/)
    expect(res).toMatch(/added their sale price to Cost/)
  })
})

// ── 5) /api/owner-res-draws ──────────────────────────────────────────────────
describe('5) /api/owner-res-draws', () => {
  const route = require('../app/api/owner-res-draws/route')
  const get = jobId => route.GET(req('GET', `/api/owner-res-draws?job_id=${jobId}`))
  beforeEach(() => {
    resetMockState({
      jobs: [
        { id: 'RJ', job_type: ' Residential ', owner_email: 'Home@Owner.test' },
        { id: 'CJ', job_type: 'commercial', owner_email: 'home@owner.test' },
        { id: 'OJ', job_type: 'residential', owner_email: 'other@owner.test' },
      ],
      pm_job_assignments: [{ id: 'a', job_id: 'RJ', user_id: 'u-super' }],
      res_owner_draws: [
        { id: 'd0', job_id: 'RJ', draw_number: 0, status: 'draft', amount_requested: 99999, notes: 'internal' },
        { id: 'd1', job_id: 'RJ', draw_number: 1, status: 'funded', amount_requested: 50000, amount_funded: null, funded_date: '2026-09-01', submitted_date: '2026-08-20', notes: 'internal', schedule_lines: [{ x: 1 }], attachments: [{ path: 'p' }], period_start: '2026-08-01', period_end: '2026-08-31', title: 'Draw #1' },
        { id: 'd2', job_id: 'RJ', draw_number: 2, status: 'funded', amount_requested: 40000, amount_funded: 38000, funded_date: '2026-10-01' },
        { id: 'd3', job_id: 'RJ', draw_number: 3, status: 'submitted', amount_requested: 30000 },
        { id: 'd4', job_id: 'RJ', draw_number: 4, status: 'void', amount_requested: 12345 },
        { id: 'c1', job_id: 'CJ', draw_number: 1, status: 'funded', amount_requested: 1, amount_funded: 1 },
      ],
    })
    as('owner', { email: 'home@owner.test' })
  })

  test('no session → 401; other owner → 403; sub / owner_rep → 403; unassigned super → 403', async () => {
    noSession(); expect((await get('RJ')).status).toBe(401)
    as('owner', { email: 'home@owner.test' }); expect((await get('OJ')).status).toBe(403)
    as('owner', { email: 'someone@else.test' }); expect((await get('RJ')).status).toBe(403)
    as('subcontractor'); expect((await get('RJ')).status).toBe(403)
    as('owner_rep'); expect((await get('RJ')).status).toBe(403)
    as('super', { userId: 'u-other-super' }); expect((await get('RJ')).status).toBe(403)
  })
  test('owner sees non-draft, non-void draws with explicit fields; unknown funded stays unknown', async () => {
    const r = await json(await get('RJ'))
    expect(r.status).toBe(200)
    expect(r.body.residential).toBe(true)
    expect(r.body.draws.map(d => d.draw_number)).toEqual([1, 2, 3])
    expect(r.body.draws[0]).toEqual({
      id: 'd1', draw_number: 1, title: 'Draw #1', period_start: '2026-08-01', period_end: '2026-08-31',
      amount_requested: 50000, status: 'funded', submitted_date: '2026-08-20', funded_date: '2026-09-01',
      amount_received: null, received_unknown: true,
    })
    expect(r.body.draws[1]).toMatchObject({ amount_received: 38000, received_unknown: false })
    expect(r.body.draws[2]).toMatchObject({ status: 'submitted', amount_received: null, received_unknown: false })
    expect(r.body.totals).toEqual({ requested: 120000, received_known: 38000, unknown_received_count: 1 })
    expect(JSON.stringify(r.body)).not.toMatch(/internal|schedule_lines|attachments|99999|12345/)
  })
  test('commercial job: no residential draws returned', async () => {
    const r = await json(await get('CJ'))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ residential: false, draws: [], totals: null })
  })
  test('assigned super / principal preview allowed', async () => {
    as('super'); expect((await get('RJ')).status).toBe(200)
    as('principal'); expect((await get('OJ')).status).toBe(200)
  })
  test('before migration 046 (no amount_funded): funded draws are unknown, not requested', async () => {
    mockState.missingSelectCols = { res_owner_draws: ['amount_funded'] }
    for (const d of mockState.db.res_owner_draws) delete d.amount_funded // the column does not exist yet
    const r = await json(await get('RJ'))
    expect(r.body.funded_tracked).toBe(false)
    expect(r.body.totals).toMatchObject({ requested: 120000, unknown_received_count: 2 })
  })
  test('ownerResBilling: requested vs received honestly; percent null when unknown', () => {
    const { ownerResBilling } = require('../lib/owner-res-draws')
    expect(ownerResBilling({ requested: 120000, received_known: 38000, unknown_received_count: 1 }, 400000))
      .toMatchObject({ requested: 120000, received: null, pct_requested: 30, pct_received: null })
    expect(ownerResBilling({ requested: 90000, received_known: 88000, unknown_received_count: 0 }, 400000))
      .toMatchObject({ received: 88000, pct_received: 22 })
  })
  test('owner page: residential uses /api/owner-res-draws; commercial stays on AIA pay apps', () => {
    const page = read('app/owner/page.js')
    expect(page).toMatch(/residential \? fetchJson\(`\/api\/owner-res-draws\?job_id=/)
    expect(page).toMatch(/: authFetch\(`\/api\/owner-pay-apps\?job_id=/)
    expect(page).toMatch(/const totalBilled = payAppsInfo\.billed_to_date/)
    // residential jobs never read Nv's internal draw_requests
    expect(page).toMatch(/residential \? fetchJson[\s\S]{0,120}: supabase\.from\('draw_requests'\)/)
    expect(page).toMatch(/Funded — amount not recorded/)
    expect(page).toMatch(/OWNER_JOB_FIELDS = '[^']*job_type'/)
  })
})

// ── 6) /api/res-inspections ──────────────────────────────────────────────────
describe('6) /api/res-inspections', () => {
  const route = require('../app/api/res-inspections/route')
  const call = (m, url, body) => route[m](req(m, url, body))
  beforeEach(() => {
    resetMockState({
      jobs: [
        { id: 'RJ', job_type: 'residential', pm_email: null },
        { id: 'RJ2', job_type: 'residential', pm_email: null },
        { id: 'CJ', job_type: 'commercial', pm_email: null },
      ],
      pm_job_assignments: [{ id: 'a1', job_id: 'RJ', user_id: 'u-super' }, { id: 'a2', job_id: 'RJ', user_id: 'u-pm' }, { id: 'a3', job_id: 'CJ', user_id: 'u-pm' }],
      res_inspections: [
        { id: 'i1', job_id: 'RJ', inspection_type: 'Framing', scheduled_date: '2026-11-10', result: 'pending', notes: null, inspector_name: null, actual_date: null, secret: 'x' },
        { id: 'i2', job_id: 'RJ2', inspection_type: 'Final', scheduled_date: '2026-11-12', result: 'pending' },
      ],
    })
  })

  test('no session → 401 on every method', async () => {
    noSession()
    expect((await call('GET', '/api/res-inspections?job_id=RJ')).status).toBe(401)
    expect((await call('POST', '/api/res-inspections', { job_id: 'RJ', inspection_type: 'Final' })).status).toBe(401)
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', result: 'passed' })).status).toBe(401)
    expect((await call('DELETE', '/api/res-inspections', { id: 'i1' })).status).toBe(401)
  })
  test.each(['subcontractor', 'owner', 'owner_rep', 'roofing_rep'])('%s is refused (nothing written)', async role => {
    as(role)
    expect((await call('GET', '/api/res-inspections?job_id=RJ')).status).toBe(403)
    expect((await call('POST', '/api/res-inspections', { job_id: 'RJ', inspection_type: 'Final' })).status).toBe(403)
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', result: 'passed' })).status).toBe(403)
    expect(mockState.calls.filter(c => c.table === 'res_inspections')).toHaveLength(0)
  })
  test('unassigned super: refused on another job (read and write), nothing written', async () => {
    as('super')
    expect((await call('GET', '/api/res-inspections?job_id=RJ2')).status).toBe(403)
    expect((await call('POST', '/api/res-inspections', { job_id: 'RJ2', inspection_type: 'Final' })).status).toBe(403)
    expect((await call('PATCH', '/api/res-inspections', { id: 'i2', result: 'passed' })).status).toBe(403)
    expect(mockState.db.res_inspections.find(i => i.id === 'i2').result).toBe('pending')
  })
  test('assigned super: list, schedule, result, reschedule, reinspect', async () => {
    as('super')
    const list = await json(await call('GET', '/api/res-inspections?job_id=RJ'))
    expect(list.status).toBe(200)
    expect(list.body.inspections.map(i => i.id)).toEqual(['i1'])
    expect(list.body.inspections[0].secret).toBeUndefined()
    const created = await json(await call('POST', '/api/res-inspections', { job_id: 'RJ', inspection_type: 'Insulation', scheduled_date: '2026-11-20', id: 'forged', created_at: 'x' }))
    expect(created.status).toBe(200)
    expect(created.body.inspection).toMatchObject({ job_id: 'RJ', inspection_type: 'Insulation', result: 'pending', actual_date: null })
    expect(created.body.inspection.id).not.toBe('forged')
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', result: 'failed', actual_date: '2026-11-10' })).status).toBe(200)
    expect(mockState.db.res_inspections.find(i => i.id === 'i1')).toMatchObject({ result: 'failed', actual_date: '2026-11-10' })
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', scheduled_date: '2026-11-15', result: 'pending', actual_date: null, notes: 'Rescheduled' })).status).toBe(200)
  })
  test('PATCH cannot move an inspection to another job; bad values are refused', async () => {
    as('principal')
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', job_id: 'RJ2', notes: 'n' })).status).toBe(200)
    expect(mockState.db.res_inspections.find(i => i.id === 'i1').job_id).toBe('RJ')
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', scheduled_date: 'tomorrow' })).status).toBe(400)
    expect((await call('PATCH', '/api/res-inspections', { id: 'i1', result: 'maybe' })).status).toBe(400)
    expect((await call('POST', '/api/res-inspections', { job_id: 'RJ', inspection_type: '  ' })).status).toBe(400)
  })
  test('office: principal / admin on any residential job; PM only on their job; commercial refused', async () => {
    as('admin'); expect((await call('GET', '/api/res-inspections?job_id=RJ2')).status).toBe(200)
    as('principal'); expect((await call('GET', '/api/res-inspections?job_id=RJ2')).status).toBe(200)
    as('pm'); expect((await call('GET', '/api/res-inspections?job_id=RJ')).status).toBe(200)
    expect((await call('GET', '/api/res-inspections?job_id=RJ2')).status).toBe(403)
    expect((await call('GET', '/api/res-inspections?job_id=CJ')).status).toBe(400)
    expect((await call('GET', '/api/res-inspections')).status).toBe(404)
  })
  test('delete: Owner / PM on the job only (supers and admin refused, as on the office page)', async () => {
    as('super'); expect((await call('DELETE', '/api/res-inspections', { id: 'i1' })).status).toBe(403)
    as('admin'); expect((await call('DELETE', '/api/res-inspections', { id: 'i1' })).status).toBe(403)
    as('pm'); expect((await call('DELETE', '/api/res-inspections', { id: 'i2' })).status).toBe(403)
    expect(mockState.db.res_inspections).toHaveLength(2)
    expect((await call('DELETE', '/api/res-inspections', { id: 'i1' })).status).toBe(200)
    expect(mockState.db.res_inspections.map(i => i.id)).toEqual(['i2'])
  })
  test('office page uses the API (no browser res_inspections writes) and skips Owner draws for supers', () => {
    const page = read('app/residentialjobdetail/page.js')
    expect(page).not.toMatch(/from\('res_inspections'\)/)
    expect(page).toMatch(/api\(`\/api\/res-inspections\?job_id=/)
    const loader = page.slice(page.indexOf('async function loadOwnerDraws'), page.indexOf('async function loadOwnerDraws') + 500)
    expect(loader.indexOf('if (!canUseOwnerDraws(role)) { setOwnerDraws([]); return }')).toBeGreaterThan(-1)
    expect(loader.indexOf('canUseOwnerDraws(role)')).toBeLessThan(loader.indexOf("noteLoad('Owner draws'"))
    expect(page).toMatch(/loadOwnerDraws\(effectiveRole\)/)
    expect(page).toMatch(/\.\.\.\(canUseOwnerDraws\(userRole\) \? \[\{ key: 'ownerdraw', label: 'Owner Draw' \}\] : \[\]\)/)
    expect(page).toMatch(/\{ key: 'inspections', label: 'Inspections'/)
    const { canUseOwnerDraws } = require('../lib/owner-draws')
    expect(canUseOwnerDraws('super')).toBe(false)
    expect(['principal', 'admin', 'pm', 'apm'].every(canUseOwnerDraws)).toBe(true)
  })
  test('supers: every owner-draw summary / action on the page is gated like the tab (Inspections stay)', () => {
    const page = read('app/residentialjobdetail/page.js')
    expect(page).toMatch(/const showOwnerDraws = canUseOwnerDraws\(userRole\)/)
    const overview = page.slice(page.indexOf("{visibleTab === 'overview' && ("), page.indexOf("{visibleTab === 'details' && ("))
    const kpis = page.slice(page.indexOf('{/* Header KPIs'), page.indexOf('{/* SIDEBAR + CONTENT */}'))
    expect(overview.length).toBeGreaterThan(1000)
    expect(kpis).toMatch(/\{showOwnerDraws && <>\s*<div style=\{s\.statCard\} title="Owner\/lender draws submitted/)
    expect(kpis.indexOf('{showOwnerDraws && <>')).toBeLessThan(kpis.indexOf('% Funded'))
    expect(overview).toMatch(/\.\.\.\(showOwnerDraws \? \[\s*\['Owner draws requested'[\s\S]*?\['Owner draws funded \(recorded\)'[\s\S]*?\] : \[\]\)/)
    expect(overview).toMatch(/\.\.\.\(showOwnerDraws \? \[\{ n: funding\.unknownFunded, label: 'funded draw\(s\) with no recorded amount', tab: 'ownerdraw' \}\] : \[\]\)/)
    expect(overview).toMatch(/pendingBillings\.length \+ unknownFundedShown \+/)
    expect(page).toMatch(/const unknownFundedShown = showOwnerDraws \? funding\.unknownFunded : 0/)
    // last-draw half (including the "No owner/lender draws yet." fallback) is inside the gate
    expect(overview).toMatch(/\{showOwnerDraws && \(lastDraw \? \([\s\S]*?No owner\/lender draws yet\.<\/div>\)\}/)
    expect(overview).toMatch(/\{showOwnerDraws \? 'Punch & Last Draw' : 'Punch List'\}/)
    expect(overview).toMatch(/\{showOwnerDraws && <button style=\{s\.btnSmGray\} onClick=\{\(\) => \{ setActiveTab\('ownerdraw'\); startDrawEdit\(null\) \}\}>\+ Owner draw<\/button>\}/)
    // the open-punch count, Inspections card and '+ Inspection' action are NOT gated
    expect(overview).toMatch(/<strong>\{openPunch\.length\}<\/strong> open punch item/)
    expect(overview).not.toMatch(/showOwnerDraws[^\n]*openPunch/)
    expect(overview).toMatch(/\n\s*<button style=\{s\.btnSmGray\} onClick=\{\(\) => \{ setActiveTab\('inspections'\); setShowAddInspection\(true\) \}\}>\+ Inspection<\/button>/)
    expect(overview).toMatch(/Upcoming Inspections/)
    // no ungated jump to the owner-draw tab is left anywhere outside the tab itself
    const outsideTab = page.slice(0, page.indexOf("{visibleTab === 'ownerdraw' && ("))
    const jumps = [...outsideTab.matchAll(/setActiveTab\('ownerdraw'\)|tab: 'ownerdraw'/g)].map(m => outsideTab.slice(Math.max(0, m.index - 120), m.index))
    expect(jumps.length).toBe(2)
    for (const before of jumps) expect(before).toMatch(/showOwnerDraws/)
    // and owner draws are still never loaded for supers
    expect(page).toMatch(/if \(!canUseOwnerDraws\(role\)\) \{ setOwnerDraws\(\[\]\); return \}/)
  })
  test('field app: Inspections section on residential jobs only, punch through /api/punch-list', () => {
    const field = read('app/field/page.js')
    expect(field).toMatch(/isResidentialJob\(selectedJob\) \? \[\{ key: 'inspections'/)
    expect(field).toMatch(/activeTab === 'inspections' && isResidentialJob\(selectedJob\)/)
    const comp = read('app/field/FieldInspections.js')
    expect(comp).toMatch(/call\('\/api\/punch-list', 'POST'/)
    expect(comp).toMatch(/\/api\/res-inspections/)
    expect(comp).not.toMatch(/from\('res_inspections'\)/)
  })
})

// ── 7) /api/res-owner-draws attach + submitted ───────────────────────────────
describe('7) /api/res-owner-draws history is not overwritten', () => {
  const draws = require('../app/api/res-owner-draws/route')
  const J = '11111111-1111-4111-8111-111111111111'
  const patch = body => draws.PATCH(req('PATCH', '/api/res-owner-draws', body))
  const draw = id => mockState.db.res_owner_draws.find(d => d.id === id)
  beforeEach(() => {
    resetMockState({
      jobs: [{ id: J, job_type: 'residential' }],
      res_owner_draws: [
        { id: 'od-sub', job_id: J, draw_number: 2, status: 'submitted', amount_requested: 500, submitted_date: '2026-11-01', attachments: null, amount_funded: null, schedule_lines: null },
        { id: 'od-draft', job_id: J, draw_number: 3, status: 'draft', amount_requested: 100, submitted_date: null, attachments: null, amount_funded: null, schedule_lines: null },
      ],
    })
    as('principal')
  })
  const file = n => `${J}/owner-draws/od-sub/${n}`

  test('a concurrent upload between read and write: both files land (CAS + retry)', async () => {
    let first = true
    mockState.beforeWrite = (t, op) => {
      if (t === 'res_owner_draws' && op === 'update' && first) {
        first = false
        // another tab's upload committed first (a new array, as the database returns)
        draw('od-sub').attachments = [{ path: file('other.pdf'), name: 'other.pdf' }]
      }
    }
    const r = await json(await patch({ id: 'od-sub', action: 'attach', path: file('mine.pdf'), name: 'mine.pdf' }))
    expect(r.status).toBe(200)
    expect(draw('od-sub').attachments.map(a => a.path)).toEqual([file('other.pdf'), file('mine.pdf')])
    expect(r.body.draw.attachments).toHaveLength(2)
  })
  test('two sequential uploads append; duplicate path is a no-op', async () => {
    await patch({ id: 'od-sub', action: 'attach', path: file('a.pdf') })
    await patch({ id: 'od-sub', action: 'attach', path: file('b.pdf') })
    await patch({ id: 'od-sub', action: 'attach', path: file('a.pdf') })
    expect(draw('od-sub').attachments.map(a => a.path)).toEqual([file('a.pdf'), file('b.pdf')])
    expect(draw('od-sub').attachments[0].uploaded_by).toBe('u-principal')
  })
  test('attachments that keep changing: bounded retries, then 409 (no overwrite)', async () => {
    let n = 0
    mockState.beforeWrite = (t, op) => { if (t === 'res_owner_draws' && op === 'update') draw('od-sub').attachments = [{ path: file(`x${++n}.pdf`) }] }
    const r = await patch({ id: 'od-sub', action: 'attach', path: file('mine.pdf') })
    expect(r.status).toBe(409)
    expect(n).toBe(5)
    expect(draw('od-sub').attachments.map(a => a.path)).not.toContain(file('mine.pdf'))
  })
  test('a repeated "submitted" is a no-op: submitted_date is not restamped, nothing written', async () => {
    const r = await json(await patch({ id: 'od-sub', action: 'status', status: 'submitted' }))
    expect(r.status).toBe(200)
    expect(r.body.unchanged).toBe(true)
    expect(draw('od-sub').submitted_date).toBe('2026-11-01')
    expect(mockState.calls.filter(c => c.table === 'res_owner_draws' && c.op === 'update')).toHaveLength(0)
  })
  test('draft → submitted stamps the date once; approved later keeps it', async () => {
    expect((await patch({ id: 'od-draft', action: 'status', status: 'submitted' })).status).toBe(200)
    const stamped = draw('od-draft').submitted_date
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    draw('od-draft').submitted_date = '2026-10-15' // as if sent earlier
    expect((await patch({ id: 'od-draft', action: 'status', status: 'approved' })).status).toBe(200)
    expect(draw('od-draft').submitted_date).toBe('2026-10-15')
    expect((await patch({ id: 'od-draft', action: 'status', status: 'approved' })).status).toBe(200)
    expect(draw('od-draft').submitted_date).toBe('2026-10-15')
  })
})
