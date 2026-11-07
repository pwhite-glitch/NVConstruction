/**
 * Prompt 49, items 2 / 3 / 5: billed direct costs, draw-tagged GC entries and draw-tagged
 * sub billings can't have their money / status rewritten.
 *
 * - dc-review approve / unapprove / reject / reopen / edit: job access on every action;
 *   refused while the cost is on ANY draw, a pay app, or a non-void reimbursement invoice;
 *   conditional writes refuse a stale request; lookup errors fail closed.
 * - PUT /api/direct-costs: allow-list (budget line, job move) — raw status / amount /
 *   draw / pay-app fields are refused.
 * - general-conditions: tagged entries lock amount / description / budget / date / delete;
 *   forged draw_request_id:null / drawn_at:null is refused; POST draw must be open, same job.
 * - billing-entry: the current draw is loaded on every PATCH; on a draw, status / amount /
 *   retainage / period are locked; payment recording still works; POST draw must be open.
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written or sent.
 */
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({
  Resend: function () {
    const { mockState } = require('./helpers/mock-db')
    this.emails = { send: async msg => { (mockState.emails = mockState.emails || []).push(msg); return mockState.resendFail ? { error: { message: 'fail' } } : { data: { id: 'e1' }, error: null } } }
  },
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const review = require('../app/api/dc-review/route')
const directCosts = require('../app/api/direct-costs/route')
const gc = require('../app/api/general-conditions/route')
const billing = require('../app/api/billing-entry/route')

const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = body => review.POST(req('/api/dc-review', 'POST', body))
const putDc = body => directCosts.PUT(req('/api/direct-costs', 'PUT', body))
const delDc = body => directCosts.DELETE(req('/api/direct-costs', 'DELETE', body))
const row = (t, id) => mockState.db[t].find(r => r.id === id)

function seed() {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', pm_email: null }, { id: 'J2', job_number: '202', project_name: 'Elm', pm_email: null }],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }],
    profiles: [{ id: 'super1', full_name: 'Sam Super', invite_email: 'sam@x.com' }],
    budget_items: [{ id: 'L1', job_id: 'J1' }, { id: 'L2', job_id: 'J1' }, { id: 'X1', job_id: 'J2' }],
    draw_requests: [
      { id: 'D_open', job_id: 'J1', draw_number: 1, status: 'open' },
      { id: 'D_closed', job_id: 'J1', draw_number: 2, status: 'closed' },
      { id: 'D_other', job_id: 'J2', draw_number: 1, status: 'open' },
    ],
    aia_applications: [{ id: 'APP1', job_id: 'J1', app_number: 3 }],
    direct_costs: [
      { id: 'pend', job_id: 'J1', status: 'pending', amount: 100, budget_item_id: 'L1', submitted_by: 'super1', description: 'Rebar', draw_request_id: null, drawn_application_id: null },
      { id: 'appr', job_id: 'J1', status: 'approved', amount: 200, budget_item_id: 'L1', description: 'Lumber', draw_request_id: null, drawn_application_id: null },
      { id: 'rej', job_id: 'J1', status: 'rejected', amount: 50, budget_item_id: 'L1', description: 'Nails', rejection_reason: 'blurry', draw_request_id: null, drawn_application_id: null },
      { id: 'onDraw', job_id: 'J1', status: 'approved', amount: 300, budget_item_id: 'L1', description: 'Ready mix', draw_request_id: 'D_open', drawn_application_id: null },
      { id: 'onClosed', job_id: 'J1', status: 'approved', amount: 310, budget_item_id: 'L1', description: 'Pump', draw_request_id: 'D_closed', drawn_application_id: null },
      { id: 'onAia', job_id: 'J1', status: 'approved', amount: 400, budget_item_id: 'L1', description: 'Steel', draw_request_id: null, drawn_application_id: 'APP1' },
      { id: 'onInv', job_id: 'J1', status: 'approved', amount: 500, budget_item_id: 'L1', description: 'Permit', draw_request_id: null, drawn_application_id: null },
      { id: 'onVoid', job_id: 'J1', status: 'approved', amount: 510, budget_item_id: 'L1', description: 'Fee', draw_request_id: null, drawn_application_id: null },
      { id: 'otherJob', job_id: 'J2', status: 'approved', amount: 600, budget_item_id: 'X1', description: 'Other', draw_request_id: null, drawn_application_id: null },
    ],
    owner_reimb_invoice_lines: [
      { id: 'il1', direct_cost_id: 'onInv', invoice_id: 'I1', owner_reimb_invoices: { invoice_number: 'R-1', status: 'sent', voided_at: null } },
      { id: 'il2', direct_cost_id: 'onVoid', invoice_id: 'I2', owner_reimb_invoices: { invoice_number: 'R-2', status: 'voided', voided_at: '2026-10-01' } },
    ],
    notifications: [],
  })
  mockState.auth = { userId: 'pm1', role: 'pm', email: 'pm1@x.com', error: null }
  mockState.emails = []
  mockState.resendFail = false
}
beforeEach(seed)

// ── Item 2: dc-review ─────────────────────────────────────────────────────────
describe('dc-review: unassigned PM refused on every office action', () => {
  const cases = [
    ['approve', 'otherPend', { budget_item_id: 'X1' }],
    ['unapprove', 'otherJob', {}],
    ['reject', 'otherJob', { rejection_reason: 'no' }],
    ['reopen', 'otherRej', {}],
    ['edit', 'otherJob', { amount: 1 }],
  ]
  test.each(cases)('%s', async (action, id, extra) => {
    mockState.db.direct_costs.push(
      { id: 'otherPend', job_id: 'J2', status: 'pending', amount: 1, budget_item_id: 'X1' },
      { id: 'otherRej', job_id: 'J2', status: 'rejected', amount: 1, budget_item_id: 'X1' },
    )
    const before = JSON.stringify(row('direct_costs', id))
    const res = await post({ action, id, ...extra })
    expect(res.status).toBe(403)
    expect(JSON.stringify(row('direct_costs', id))).toBe(before)
  })
})

describe('dc-review: billed costs are left unchanged', () => {
  const billed = ['onDraw', 'onClosed', 'onAia', 'onInv']
  for (const id of billed) {
    test.each([
      ['unapprove', {}],
      ['reject', { rejection_reason: 'wrong job' }],
      ['edit', { amount: 1, budget_item_id: 'L2' }],
    ])(`${id}: %s → 409, row untouched`, async (action, extra) => {
      const before = JSON.stringify(row('direct_costs', id))
      const res = await post({ action, id, ...extra })
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/draw|pay app|invoice/i)
      expect(JSON.stringify(row('direct_costs', id))).toBe(before)
    })
  }

  test('an OPEN draw still blocks edits (no silent untag through dc-review)', async () => {
    const res = await post({ action: 'edit', id: 'onDraw', amount: 999 })
    expect(res.status).toBe(409)
    expect(row('direct_costs', 'onDraw')).toMatchObject({ amount: 300, draw_request_id: 'D_open' })
  })

  test('a voided reimbursement invoice does not block', async () => {
    const res = await post({ action: 'edit', id: 'onVoid', notes: 'ok' })
    expect(res.status).toBe(200)
  })

  test('invoice lookup failure fails closed', async () => {
    mockState.failSelect.owner_reimb_invoice_lines = 'boom'
    const res = await post({ action: 'unapprove', id: 'appr' })
    expect(res.status).toBe(500)
    expect(row('direct_costs', 'appr').status).toBe('approved')
  })
})

describe('dc-review: normal unlinked review still works', () => {
  test('undo approve', async () => {
    expect((await post({ action: 'unapprove', id: 'appr' })).status).toBe(200)
    expect(row('direct_costs', 'appr').status).toBe('pending')
  })
  test('reject keeps the row with its reason and emails the submitter at invite_email', async () => {
    const res = await post({ action: 'reject', id: 'pend', rejection_reason: 'No receipt' })
    expect(res.status).toBe(200)
    expect(row('direct_costs', 'pend')).toMatchObject({ status: 'rejected', rejection_reason: 'No receipt', description: 'Rebar', amount: 100 })
    expect(mockState.emails.map(e => e.to)).toEqual(['sam@x.com'])
  })
  test('reopen', async () => {
    expect((await post({ action: 'reopen', id: 'rej' })).status).toBe(200)
    expect(row('direct_costs', 'rej').status).toBe('pending')
  })
  test('edit', async () => {
    expect((await post({ action: 'edit', id: 'appr', amount: '250.5', budget_item_id: 'L2' })).status).toBe(200)
    expect(row('direct_costs', 'appr')).toMatchObject({ amount: 250.5, budget_item_id: 'L2' })
  })
})

describe('dc-review: stale requests', () => {
  test('cost put on a draw between load and update → 409, nothing written', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'direct_costs' && op === 'update') row('direct_costs', 'appr').draw_request_id = 'D_open' }
    const res = await post({ action: 'unapprove', id: 'appr' })
    expect(res.status).toBe(409)
    expect(row('direct_costs', 'appr').status).toBe('approved')
  })
  test('status changed meanwhile → 409', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'direct_costs' && op === 'update') row('direct_costs', 'rej').status = 'pending' }
    expect((await post({ action: 'reopen', id: 'rej' })).status).toBe(409)
  })
})

describe('PUT /api/direct-costs allow-list', () => {
  test.each([
    [{ status: 'approved' }],
    [{ amount: 1 }],
    [{ draw_request_id: null }],
    [{ drawn_application_id: null, drawn_at: null }],
    [{ budget_item_id: 'L2', amount: 5 }],
  ])('refuses raw field %j', async fields => {
    const before = JSON.stringify(row('direct_costs', 'onAia'))
    const res = await putDc({ id: 'onAia', ...fields })
    expect(res.status).toBe(400)
    expect(JSON.stringify(row('direct_costs', 'onAia'))).toBe(before)
  })
  test('budget line change on a billed cost → 409', async () => {
    const res = await putDc({ id: 'onDraw', budget_item_id: 'L2' })
    expect(res.status).toBe(409)
    expect(row('direct_costs', 'onDraw').budget_item_id).toBe('L1')
  })
  test('budget line change on an unbilled cost works', async () => {
    expect((await putDc({ id: 'pend', budget_item_id: 'L2' })).status).toBe(200)
    expect(row('direct_costs', 'pend').budget_item_id).toBe('L2')
  })
  test('Move keeps its behaviour: an open draw is unlinked by the move', async () => {
    mockState.auth = { userId: 'p0', role: 'principal', error: null }
    mockState.db.budget_items.push({ id: 'Y1', job_id: 'J2' })
    const res = await putDc({ id: 'onDraw', job_id: 'J2', budget_item_id: null })
    expect(res.status).toBe(200)
    expect(row('direct_costs', 'onDraw')).toMatchObject({ job_id: 'J2', draw_request_id: null, amount: 300 })
  })
  test('Move refuses a closed draw', async () => {
    mockState.auth = { userId: 'p0', role: 'principal', error: null }
    expect((await putDc({ id: 'onClosed', job_id: 'J2', budget_item_id: null })).status).toBe(409)
  })
  test('DELETE refuses a billed cost and keeps it', async () => {
    for (const id of ['onDraw', 'onAia', 'onInv']) {
      expect((await delDc({ id })).status).toBe(409)
      expect(row('direct_costs', id)).toBeTruthy()
    }
    expect((await delDc({ id: 'pend' })).status).toBe(200)
  })
})

// ── Item 3: general conditions ────────────────────────────────────────────────
describe('general conditions respect draw tagging', () => {
  beforeEach(() => {
    mockState.db.general_conditions = [
      { id: 'g1', job_id: 'J1', description: 'PM salary', amount: 1000, budget_item_id: 'L1', entry_date: '2026-10-01', draw_request_id: 'D_closed', category: 'salary', notes: null },
      { id: 'g2', job_id: 'J1', description: 'Dumpster', amount: 200, budget_item_id: 'L1', entry_date: '2026-10-02', draw_request_id: null, category: 'general', notes: null },
      { id: 'g3', job_id: 'J1', description: 'Trailer', amount: 300, budget_item_id: 'L1', entry_date: '2026-10-03', draw_request_id: 'D_open', category: 'general', notes: null },
    ]
  })
  const putGc = body => gc.PUT(req('/api/general-conditions', 'PUT', body))
  const delGc = body => gc.DELETE(req('/api/general-conditions', 'DELETE', body))
  const postGc = body => gc.POST(req('/api/general-conditions', 'POST', body))

  test('tagged amount edit → 409 (closed and open draws)', async () => {
    expect((await putGc({ id: 'g1', amount: '1' })).status).toBe(409)
    expect((await putGc({ id: 'g3', amount: '1' })).status).toBe(409)
    expect(row('general_conditions', 'g1').amount).toBe(1000)
  })
  test('forged unlink + amount edit → 409, still tagged, amount unchanged', async () => {
    const res = await putGc({ id: 'g3', draw_request_id: null, drawn_at: null, amount: '5' })
    expect(res.status).toBe(409)
    expect(row('general_conditions', 'g3')).toMatchObject({ draw_request_id: 'D_open', amount: 300 })
  })
  test('forged drawn_at:null alone → 409', async () => {
    expect((await putGc({ id: 'g3', drawn_at: null })).status).toBe(409)
  })
  test('description / budget / date also locked; unchanged values re-sent are fine', async () => {
    expect((await putGc({ id: 'g1', description: 'Other' })).status).toBe(409)
    expect((await putGc({ id: 'g1', budget_item_id: 'L2' })).status).toBe(409)
    expect((await putGc({ id: 'g1', entry_date: '2026-11-01' })).status).toBe(409)
    expect((await putGc({ id: 'g1', amount: '1000.00', description: 'PM salary', notes: 'ok', draw_request_id: 'D_closed' })).status).toBe(200)
    expect(row('general_conditions', 'g1').notes).toBe('ok')
  })
  test('tagged delete → 409', async () => {
    expect((await delGc({ id: 'g1' })).status).toBe(409)
    expect(row('general_conditions', 'g1')).toBeTruthy()
  })
  test('untagged legitimate edit and delete succeed', async () => {
    expect((await putGc({ id: 'g2', amount: '250' })).status).toBe(200)
    expect(row('general_conditions', 'g2').amount).toBe(250)
    expect((await delGc({ id: 'g2' })).status).toBe(200)
  })
  test('entry tagged between load and update → nothing written', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'general_conditions' && op === 'update') row('general_conditions', 'g2').draw_request_id = 'D_open' }
    expect((await putGc({ id: 'g2', amount: '9' })).status).toBe(409)
    expect(row('general_conditions', 'g2').amount).toBe(200)
  })
  test('POST: foreign / closed / missing draw refused; open same-job draw accepted', async () => {
    const base = { job_id: 'J1', description: 'x', amount: '10' }
    expect((await postGc({ ...base, draw_request_id: 'D_other' })).status).toBe(422)
    expect((await postGc({ ...base, draw_request_id: 'D_closed' })).status).toBe(409)
    expect((await postGc({ ...base, draw_request_id: 'nope' })).status).toBe(404)
    const ok = await postGc({ ...base, draw_request_id: 'D_open', created_by: 'forged' })
    expect(ok.status).toBe(200)
    const created = (await ok.json()).entry
    expect(created).toMatchObject({ draw_request_id: 'D_open', created_by: 'pm1' })
  })
  test('POST: budget item from another job refused', async () => {
    expect((await postGc({ job_id: 'J1', description: 'x', amount: '10', budget_item_id: 'X1' })).status).toBe(422)
  })
})

// ── Item 5: billing entry ─────────────────────────────────────────────────────
describe('billing-entry: draw-tagged billings', () => {
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'b_closed', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_pct: 10, retainage_held: 100, nv_reimbursement: false, billing_period: '2026-10-01', draw_request_id: 'D_closed', company_name: 'Acme', sub_id: null, ready_to_pay: false },
      { id: 'b_open', job_id: 'J1', status: 'pending', amount_billed: 500, retainage_pct: 10, retainage_held: 50, nv_reimbursement: false, billing_period: '2026-10-01', draw_request_id: 'D_open', company_name: 'Acme', sub_id: null },
      { id: 'b_free', job_id: 'J1', status: 'pending', amount_billed: 300, retainage_pct: 0, retainage_held: 0, draw_request_id: null, company_name: 'Acme', sub_id: null },
    ]
  })
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))
  const create = body => billing.POST(req('/api/billing-entry', 'POST', body))

  test('unchanged draw id + reopen to pending → 409', async () => {
    const res = await patch({ id: 'b_closed', draw_request_id: 'D_closed', status: 'pending' })
    expect(res.status).toBe(409)
    expect(row('billing_submissions', 'b_closed').status).toBe('approved')
  })
  test('draw id omitted + retainage edit → 409', async () => {
    expect((await patch({ id: 'b_closed', retainage_pct: 5, retainage_held: 50 })).status).toBe(409)
    expect(row('billing_submissions', 'b_closed').retainage_pct).toBe(10)
  })
  test('unlink plus financial rewrite on a closed draw → 409, still tagged', async () => {
    expect((await patch({ id: 'b_closed', draw_request_id: null, status: 'pending', amount_billed: 1 })).status).toBe(409)
    expect(row('billing_submissions', 'b_closed')).toMatchObject({ draw_request_id: 'D_closed', amount_billed: 1000, status: 'approved' })
  })
  test('open draw: rejection / amount change locked too until taken off', async () => {
    expect((await patch({ id: 'b_open', status: 'rejected', rejection_reason: 'x' })).status).toBe(409)
    expect((await patch({ id: 'b_open', amount_billed: 600 })).status).toBe(409)
    expect((await patch({ id: 'b_open', draw_request_id: null, amount_billed: 600 })).status).toBe(409)
  })
  test('the whole edit form re-sent unchanged is accepted (only non-financial edits)', async () => {
    const res = await patch({ id: 'b_closed', status: 'approved', amount_billed: '1000.00', retainage_pct: 10, retainage_held: 100, billing_period: '2026-10-01', nv_reimbursement: false, invoice_number: 'INV-9' })
    expect(res.status).toBe(200)
    expect(row('billing_submissions', 'b_closed').invoice_number).toBe('INV-9')
  })
  test('recording a payment on an approved closed-draw billing works and leaves billed totals alone', async () => {
    const res = await patch({ id: 'b_closed', paid_at: '2026-11-01T12:00:00Z', payment_amount: 900, payment_method: 'check', check_number: '1234' })
    expect(res.status).toBe(200)
    expect(row('billing_submissions', 'b_closed')).toMatchObject({ paid_at: '2026-11-01T12:00:00Z', payment_amount: 900, amount_billed: 1000, retainage_held: 100, status: 'approved' })
  })
  test('unlinking a closed draw is still refused (existing guard)', async () => {
    expect((await patch({ id: 'b_closed', draw_request_id: null })).status).toBe(409)
  })
  test('untagged billing: rejection reason still required', async () => {
    expect((await patch({ id: 'b_free', status: 'rejected' })).status).toBe(422)
    expect((await patch({ id: 'b_free', status: 'rejected', rejection_reason: 'Missing lien waiver' })).status).toBe(200)
    expect(row('billing_submissions', 'b_free')).toMatchObject({ status: 'rejected', rejection_reason: 'Missing lien waiver' })
  })
  test('billing put on a draw between load and update → 409', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') row('billing_submissions', 'b_free').draw_request_id = 'D_open' }
    expect((await patch({ id: 'b_free', amount_billed: 1 })).status).toBe(409)
    expect(row('billing_submissions', 'b_free').amount_billed).toBe(300)
  })
  test('POST: closed / foreign / missing draw refused; open draw accepted', async () => {
    const base = { job_id: 'J1', company_name: 'Acme', amount_billed: 10 }
    expect((await create({ ...base, draw_request_id: 'D_closed' })).status).toBe(409)
    expect((await create({ ...base, draw_request_id: 'D_other' })).status).toBe(422)
    expect((await create({ ...base, draw_request_id: 'missing' })).status).toBe(404)
    expect((await create({ ...base, draw_request_id: 'D_open' })).status).toBe(200)
  })
  test('existing DELETE guard still refuses a billing on a draw', async () => {
    const res = await billing.DELETE(req('/api/billing-entry', 'DELETE', { id: 'b_open' }))
    expect(res.status).toBe(409)
  })
})
