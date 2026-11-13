/**
 * Prompt 79 leftover (review follow-ups):
 *  - lib/dc-amount.js: one credit test (is_credit || amount < 0, same as lib/aia-draw.js
 *    isCreditCost) for signedDcAmount / dcDuplicateKey / ownerReimbLineAmounts; a legacy
 *    stored row { amount: -250, is_credit: false } is a −250 return everywhere.
 *  - normalizeDcAmount / dc-review parse is_credit strings ('false' / '0' / '' / 'off' → false).
 *  - Return box auto-tick: unticked again only when it was auto-ticked.
 *  - POST /api/owner-reimb-invoices prices linked lines on the server from the stored cost and
 *    refuses an invoice whose total billed is <= 0.
 * In-memory DB, mocked auth. Nothing live.
 */
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})
jest.mock('resend', () => ({ Resend: function Resend() { this.emails = { send: async () => ({ data: { id: 'e' }, error: null }) } } }))

const ownerReimb = require('../app/api/owner-reimb-invoices/route')
const dcReview = require('../app/api/dc-review/route')
const directCostsRoute = require('../app/api/direct-costs/route')
const {
  normalizeDcAmount, parseDcCredit, isCreditCost, signedDcAmount, dcDuplicateKey, ownerReimbLineAmounts,
  dcAmountInputState, dcCreditInputState,
} = require('../lib/dc-amount')
const aiaDraw = require('../lib/aia-draw')

const J1 = 'job-1'
const J2 = 'job-2'
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const out = async r => ({ status: r.status, body: await r.json() })
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null } }
const dcRow = (id, extra) => ({ id, job_id: J1, status: 'approved', submitted_by: 'u-super', receipt_url: `${J1}/${id}.jpg`, bill_to_owner: true, billing_route: null, draw_request_id: null, drawn_application_id: null, ...extra })

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, job_number: '101', project_name: 'Main' }, { id: J2, job_number: '102', project_name: 'Other' }],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-super' }],
    direct_costs: [
      dcRow('dc-500', { amount: 500, is_credit: false }),
      dcRow('dc-ret', { amount: 100, is_credit: true }),
      dcRow('dc-legacy', { amount: -250, is_credit: false }),
      dcRow('dc-big-ret', { amount: 900, is_credit: true }),
      dcRow('dc-pending', { amount: 40, is_credit: false, status: 'pending' }),
    ],
    profiles: [],
    owner_reimb_invoices: [],
    owner_reimb_invoice_lines: [],
    owner_reimb_payments: [],
  })
})

// ── One credit test ─────────────────────────────────────────────────────────
describe('credit test matches lib/aia-draw isCreditCost', () => {
  const legacy = { amount: -250, is_credit: false }
  test('isCreditCost is the aia-draw one', () => {
    expect(isCreditCost).toBe(aiaDraw.isCreditCost)
  })
  test('legacy row { amount: -250, is_credit: false } is a −250 return', () => {
    expect(isCreditCost(legacy)).toBe(true)
    expect(signedDcAmount(legacy)).toBe(-250)
    expect(dcDuplicateKey(legacy)).toBe('credit|250.00')
    expect(dcDuplicateKey(legacy)).toBe(dcDuplicateKey({ amount: 250, is_credit: true }))
    expect(dcDuplicateKey(legacy)).not.toBe(dcDuplicateKey({ amount: 250, is_credit: false }))
    expect(ownerReimbLineAmounts(legacy, 10)).toEqual({ expense_amount: -250, markup_pct: 10, billed_amount: -275 })
    // Same sign + magnitude as the G703 draw math.
    expect(aiaDraw.signedDrawCents(legacy, 10)).toBe(-27500)
  })
  test('magnitude is always |amount|', () => {
    expect(signedDcAmount({ amount: -250, is_credit: true })).toBe(-250)
    expect(signedDcAmount({ amount: 250, is_credit: true })).toBe(-250)
    expect(signedDcAmount({ amount: 250, is_credit: false })).toBe(250)
    expect(signedDcAmount({ amount: '12.5' })).toBe(12.5)
    expect(signedDcAmount({})).toBe(0)
  })
})

// ── is_credit parsing ───────────────────────────────────────────────────────
describe('is_credit parsing', () => {
  test('parseDcCredit', () => {
    for (const v of [true, 'true', 'TRUE', '1', 'on', ' on ']) expect(parseDcCredit(v)).toBe(true)
    for (const v of [false, 'false', '0', '', 'off', null, undefined, 'no', 0]) expect(parseDcCredit(v)).toBe(false)
  })
  test('normalizeDcAmount: string "false" / "0" / "" / "off" is a charge', () => {
    for (const is_credit of ['false', '0', '', 'off']) {
      expect(normalizeDcAmount({ amount: 50, is_credit })).toEqual({ amount: 50, is_credit: false })
    }
    for (const is_credit of [true, 'true', '1', 'on']) {
      expect(normalizeDcAmount({ amount: 50, is_credit })).toEqual({ amount: 50, is_credit: true })
    }
    expect(normalizeDcAmount({ amount: -50, is_credit: 'false' })).toEqual({ amount: 50, is_credit: true })
  })
  test('direct-costs POST: is_credit "false" stores a charge, "on" a credit', async () => {
    as('principal')
    const post = body => directCostsRoute.POST(req('/api/direct-costs', 'POST', body))
    const base = { job_id: J1, cost_date: '2026-11-01', category: 'Materials', status: 'approved', submitted_by: 'u-principal' }
    expect((await post({ ...base, description: 'S-false', amount: 30, is_credit: 'false' })).status).toBeLessThan(300)
    expect((await post({ ...base, description: 'S-on', amount: 30, is_credit: 'on' })).status).toBeLessThan(300)
    expect(mockState.db.direct_costs.find(c => c.description === 'S-false')).toMatchObject({ amount: 30, is_credit: false })
    expect(mockState.db.direct_costs.find(c => c.description === 'S-on')).toMatchObject({ amount: 30, is_credit: true })
  })
  test('dc-review edit: is_credit "0" / "off" is a charge, "1" / "on" a credit', async () => {
    as('principal')
    const edit = body => dcReview.POST(req('/api/dc-review', 'POST', { action: 'edit', id: 'dc-pending', ...body }))
    expect((await edit({ is_credit: '1' })).status).toBe(200)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-pending')).toMatchObject({ amount: 40, is_credit: true })
    expect((await edit({ is_credit: 'off' })).status).toBe(200)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-pending')).toMatchObject({ amount: 40, is_credit: false })
    expect((await edit({ is_credit: 'on' })).status).toBe(200)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-pending').is_credit).toBe(true)
    expect((await edit({ is_credit: '0' })).status).toBe(200)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-pending').is_credit).toBe(false)
  })
})

// ── Return box auto-tick ────────────────────────────────────────────────────
describe('return box auto-tick', () => {
  test('a minus auto-ticks; removing it unticks', () => {
    let f = { amount: '', is_credit: false }
    f = dcAmountInputState(f, '-')
    expect(f.is_credit).toBe(false)
    f = dcAmountInputState(f, '-25')
    expect(f).toMatchObject({ amount: '-25', is_credit: true, _autoCredit: true })
    f = dcAmountInputState(f, '-250')
    expect(f).toMatchObject({ is_credit: true, _autoCredit: true })
    f = dcAmountInputState(f, '250')
    expect(f).toMatchObject({ amount: '250', is_credit: false, _autoCredit: false })
  })
  test('a box the user ticked stays ticked', () => {
    let f = dcCreditInputState({ amount: '250', is_credit: false }, true)
    expect(f).toMatchObject({ is_credit: true, _autoCredit: false })
    f = dcAmountInputState(f, '-250')
    expect(f).toMatchObject({ is_credit: true, _autoCredit: false })
    f = dcAmountInputState(f, '250')
    expect(f).toMatchObject({ amount: '250', is_credit: true })
  })
  test('an edit form seeded as a credit stays a credit', () => {
    let f = { amount: '100', is_credit: true }
    f = dcAmountInputState(f, '-100')
    f = dcAmountInputState(f, '100')
    expect(f.is_credit).toBe(true)
  })
  test('unticking by hand after an auto-tick, then typing positive, stays unticked', () => {
    let f = dcAmountInputState({ amount: '', is_credit: false }, '-5')
    f = dcAmountInputState(f, '5')
    f = dcCreditInputState(f, false)
    f = dcAmountInputState(f, '50')
    expect(f).toMatchObject({ is_credit: false, _autoCredit: false })
  })
  test('other form fields are kept', () => {
    const f = dcAmountInputState({ amount: '', is_credit: false, vendor: 'HD', category: 'Materials' }, '-9')
    expect(f).toMatchObject({ vendor: 'HD', category: 'Materials', amount: '-9', is_credit: true })
  })
})

// ── Owner reimbursement invoice: server-priced lines ────────────────────────
describe('POST /api/owner-reimb-invoices', () => {
  const post = body => ownerReimb.POST(req('/api/owner-reimb-invoices', 'POST', body))
  const base = { job_id: J1, invoice_number: 'R-1', bill_to_name: 'Owner', issue_date: '2026-11-01', markup_pct: 10 }
  const linesOf = () => mockState.db.owner_reimb_invoice_lines

  test('linked lines are priced from the stored cost; client numbers ignored', async () => {
    as('principal')
    const res = await out(await post({ ...base, lines: [
      { direct_cost_id: 'dc-500', description: 'Lumber', expense_amount: 1, markup_pct: 10, billed_amount: 99999 },
      // A stale client sends the return as a positive line; the server makes it negative.
      { direct_cost_id: 'dc-ret', description: 'Return', expense_amount: 100, markup_pct: 10, billed_amount: 110 },
    ] }))
    expect(res.status).toBe(201)
    const byDc = Object.fromEntries(linesOf().map(l => [l.direct_cost_id, l]))
    expect(byDc['dc-500']).toMatchObject({ expense_amount: 500, markup_pct: 10, billed_amount: 550 })
    expect(byDc['dc-ret']).toMatchObject({ expense_amount: -100, markup_pct: 10, billed_amount: -110 })
    expect(linesOf().reduce((a, l) => a + l.billed_amount, 0)).toBe(440)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-ret').billing_route).toBe('reimbursement')
  })
  test('a legacy negative row bills as a return', async () => {
    as('principal')
    const res = await post({ ...base, lines: [
      { direct_cost_id: 'dc-500', description: 'Lumber', expense_amount: 500, markup_pct: 0, billed_amount: 500 },
      { direct_cost_id: 'dc-legacy', description: 'Old return', expense_amount: 250, markup_pct: 0, billed_amount: 250 },
    ] })
    expect(res.status).toBe(201)
    expect(linesOf().find(l => l.direct_cost_id === 'dc-legacy')).toMatchObject({ expense_amount: -250, billed_amount: -250 })
  })
  test('unlinked lines keep the client amounts', async () => {
    as('principal')
    const res = await post({ ...base, lines: [
      { description: 'Permit fee', expense_amount: '175.50', markup_pct: '0', billed_amount: '175.50' },
      { direct_cost_id: 'dc-ret', description: 'Return', expense_amount: -100, markup_pct: 0, billed_amount: -100 },
    ] })
    expect(res.status).toBe(201)
    expect(linesOf().find(l => !l.direct_cost_id)).toMatchObject({ expense_amount: 175.5, markup_pct: 0, billed_amount: 175.5 })
  })
  test('total billed <= 0 → 422; nothing written', async () => {
    as('principal')
    const msg = 'Invoice total must be greater than $0 (returns can only reduce an invoice that has charges)'
    for (const lines of [
      [{ direct_cost_id: 'dc-ret', description: 'Return', expense_amount: 100, markup_pct: 0, billed_amount: 100 }],
      [{ direct_cost_id: 'dc-500', description: 'Lumber', markup_pct: 0 }, { direct_cost_id: 'dc-big-ret', description: 'Big return', markup_pct: 0 }],
      [{ description: 'Zero', expense_amount: 0, billed_amount: 0 }],
    ]) {
      expect(await out(await post({ ...base, lines }))).toEqual({ status: 422, body: { error: msg } })
    }
    expect(mockState.db.owner_reimb_invoices).toHaveLength(0)
    expect(linesOf()).toHaveLength(0)
    expect(mockState.db.direct_costs.find(c => c.id === 'dc-ret').billing_route).toBeNull()
  })
  test('existing checks still apply (wrong job → 422)', async () => {
    as('principal')
    mockState.db.direct_costs.push(dcRow('dc-j2', { job_id: J2, amount: 10, is_credit: false }))
    const res = await out(await post({ ...base, lines: [{ direct_cost_id: 'dc-j2', description: 'x' }] }))
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/does not belong to this job/)
  })
})
