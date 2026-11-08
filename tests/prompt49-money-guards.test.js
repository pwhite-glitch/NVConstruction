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
 *   Prompt 61: the first review (pending → approved / rejected) on an OPEN draw is allowed
 *   (reject also takes it off the draw); only approved billings can be tagged onto a draw;
 *   approving sends the approval email + lien waiver server side (once).
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written or sent.
 */
const { mockState, resetMockState, billingFirstReviewRpc } = require('./helpers/mock-db')

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
  // Migration 059 (unapplied in the real DB) stand-in: the guarded first-review write.
  // Tests that need "059 not applied yet" delete it.
  mockState.rpc.billing_first_review = billingFirstReviewRpc
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
  // Prompt 61 finding 1: the first review (pending → approved / rejected) of an invoice on an
  // OPEN draw is allowed; money fields stay locked. (Was: rejection locked too → 409.)
  test('open draw: first-review rejection allowed and takes it off the draw; amount change still locked', async () => {
    const rej = await patch({ id: 'b_open', status: 'rejected', rejection_reason: 'x' })
    expect(rej.status).toBe(200)
    expect((await rej.json()).untagged).toBe(true)
    expect(row('billing_submissions', 'b_open')).toMatchObject({ status: 'rejected', draw_request_id: null, rejection_reason: 'x', amount_billed: 500 })
    // the amount locks are unchanged for a billing still on the open draw
    mockState.db.billing_submissions.push({ id: 'b_open2', job_id: 'J1', status: 'pending', amount_billed: 500, retainage_pct: 10, retainage_held: 50, nv_reimbursement: false, billing_period: '2026-10-01', draw_request_id: 'D_open', company_name: 'Acme', sub_id: null })
    expect((await patch({ id: 'b_open2', amount_billed: 600 })).status).toBe(409)
    expect((await patch({ id: 'b_open2', draw_request_id: null, amount_billed: 600 })).status).toBe(409)
    expect(row('billing_submissions', 'b_open2')).toMatchObject({ amount_billed: 500, draw_request_id: 'D_open', status: 'pending' })
  })
  test('open draw: first-review approval allowed and stays tagged', async () => {
    const res = await patch({ id: 'b_open', status: 'approved', reviewed_at: '2026-11-08T12:00:00Z' })
    expect(res.status).toBe(200)
    expect(row('billing_submissions', 'b_open')).toMatchObject({ status: 'approved', draw_request_id: 'D_open' })
  })
  test('open draw: rejection still needs a reason (nothing written)', async () => {
    expect((await patch({ id: 'b_open', status: 'rejected' })).status).toBe(422)
    expect(row('billing_submissions', 'b_open')).toMatchObject({ status: 'pending', draw_request_id: 'D_open' })
  })
  test('open draw: status + amount in the same first review → 409', async () => {
    expect((await patch({ id: 'b_open', status: 'approved', amount_billed: 1 })).status).toBe(409)
    expect(row('billing_submissions', 'b_open')).toMatchObject({ status: 'pending', amount_billed: 500 })
  })
  test('approved → pending while tagged stays locked (open and closed draws)', async () => {
    mockState.db.billing_submissions.push({ id: 'b_open_appr', job_id: 'J1', status: 'approved', amount_billed: 700, retainage_pct: 0, retainage_held: 0, draw_request_id: 'D_open', company_name: 'Acme', sub_id: null })
    expect((await patch({ id: 'b_open_appr', status: 'pending' })).status).toBe(409)
    expect(row('billing_submissions', 'b_open_appr').status).toBe('approved')
    expect((await patch({ id: 'b_closed', status: 'pending' })).status).toBe(409)
  })
  test('closed draw: first review stays locked', async () => {
    mockState.db.billing_submissions.push({ id: 'b_closed_pend', job_id: 'J1', status: 'pending', amount_billed: 800, retainage_pct: 0, retainage_held: 0, draw_request_id: 'D_closed', company_name: 'Acme', sub_id: null })
    expect((await patch({ id: 'b_closed_pend', status: 'approved' })).status).toBe(409)
    expect((await patch({ id: 'b_closed_pend', status: 'rejected', rejection_reason: 'no' })).status).toBe(409)
    expect(row('billing_submissions', 'b_closed_pend')).toMatchObject({ status: 'pending', draw_request_id: 'D_closed' })
  })
  test('first review when the billing moved to another draw meanwhile → 409, nothing written', async () => {
    // The link guard matches the draw that was read (and checked as open).
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') row('billing_submissions', 'b_open').draw_request_id = 'D_closed' }
    expect((await patch({ id: 'b_open', status: 'rejected', rejection_reason: 'x' })).status).toBe(409)
    expect(row('billing_submissions', 'b_open').status).toBe('pending')
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

// ── Prompt 61 finding 2: only approved billings may be tagged onto a draw ─────
describe('billing-entry: tagging onto a draw is approved-only', () => {
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'p1', job_id: 'J1', status: 'pending', amount_billed: 100, draw_request_id: null, company_name: 'Acme', sub_id: null },
      { id: 'r1', job_id: 'J1', status: 'rejected', amount_billed: 200, draw_request_id: null, company_name: 'Acme', sub_id: null, rejection_reason: 'no' },
      { id: 'a1', job_id: 'J1', status: 'approved', amount_billed: 300, draw_request_id: null, company_name: 'Acme', sub_id: null },
      { id: 'a2', job_id: 'J1', status: 'approved', amount_billed: 400, draw_request_id: 'D_open', company_name: 'Acme', sub_id: null },
    ]
  })
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))

  test.each(['p1', 'r1'])('%s (not approved) → 422, still untagged', async id => {
    const res = await patch({ id, draw_request_id: 'D_open' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/approved/i)
    expect(row('billing_submissions', id).draw_request_id).toBeNull()
  })
  test('approved billing can be tagged onto an open draw', async () => {
    expect((await patch({ id: 'a1', draw_request_id: 'D_open' })).status).toBe(200)
    expect(row('billing_submissions', 'a1').draw_request_id).toBe('D_open')
  })
  test('untagging an approved billing from an open draw still works', async () => {
    expect((await patch({ id: 'a2', draw_request_id: null })).status).toBe(200)
    expect(row('billing_submissions', 'a2').draw_request_id).toBeNull()
  })
  test('closed / foreign draw targets still refused for approved billings', async () => {
    expect((await patch({ id: 'a1', draw_request_id: 'D_closed' })).status).toBe(409)
    expect((await patch({ id: 'a1', draw_request_id: 'D_other' })).status).toBe(422)
    expect(row('billing_submissions', 'a1').draw_request_id).toBeNull()
  })
  test('a pending billing tagged by the sub cannot be moved to another draw', async () => {
    mockState.db.draw_requests.push({ id: 'D_open2', job_id: 'J1', draw_number: 3, status: 'open' })
    mockState.db.billing_submissions.push({ id: 'p_tag', job_id: 'J1', status: 'pending', amount_billed: 50, draw_request_id: 'D_open', company_name: 'Acme', sub_id: null })
    expect((await patch({ id: 'p_tag', draw_request_id: 'D_open2' })).status).toBe(422)
    expect(row('billing_submissions', 'p_tag').draw_request_id).toBe('D_open')
  })
})

// ── Prompt 61 finding 3: approving from any screen emails the sub + sends the waiver ──
describe('billing-entry: approval sends the approval email and the lien waiver server side', () => {
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'w1', job_id: 'J1', status: 'pending', amount_billed: 1200, draw_request_id: null, company_name: 'Acme Framing', contact_name: 'Ann Acme', sub_id: 'sub1', sub_email: 'ann@acme.test', lien_waiver_sent_at: null, lien_waiver_signed_at: null },
      { id: 'w_open', job_id: 'J1', status: 'pending', amount_billed: 900, draw_request_id: 'D_open', company_name: 'Acme Framing', sub_id: 'sub1', sub_email: 'ann@acme.test', lien_waiver_sent_at: null, lien_waiver_signed_at: null },
      { id: 'w_noemail', job_id: 'J1', status: 'pending', amount_billed: 50, draw_request_id: null, company_name: 'No Mail', sub_id: null, sub_email: null, lien_waiver_sent_at: null },
    ]
  })
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))
  const subjects = () => mockState.emails.map(e => `${e.to}|${e.subject}`)

  test('residential-style approve (no email_sub flag) sends both, stamps the waiver once', async () => {
    const res = await patch({ id: 'w1', status: 'approved' })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out).toMatchObject({ ok: true, emailError: null, waiverSent: true, waiverError: null })
    expect(subjects()).toEqual([
      expect.stringMatching(/^ann@acme\.test\|Billing approved/),
      expect.stringMatching(/^ann@acme\.test\|Lien Waiver Required — #101 Main/),
    ])
    expect(row('billing_submissions', 'w1').lien_waiver_sent_at).toEqual(expect.any(String))
    const stampWrites = mockState.calls.filter(c => c.table === 'billing_submissions' && c.op === 'update' && 'lien_waiver_sent_at' in (c.payload || {}))
    expect(stampWrites).toHaveLength(1)
  })
  test('dashboard-style approve (email_sub: true) does not email twice', async () => {
    expect((await patch({ id: 'w1', status: 'approved', email_sub: true })).status).toBe(200)
    expect(mockState.emails).toHaveLength(2)
  })
  test('first review on an open draw (the commercial / residential case) also sends', async () => {
    expect((await patch({ id: 'w_open', status: 'approved' })).status).toBe(200)
    expect(mockState.emails.map(e => e.subject)).toEqual([expect.stringMatching(/Billing approved/), expect.stringMatching(/Lien Waiver/)])
  })
  test('rejection without email_sub sends nothing (unchanged)', async () => {
    expect((await patch({ id: 'w1', status: 'rejected', rejection_reason: 'blurry' })).status).toBe(200)
    expect(mockState.emails).toHaveLength(0)
  })
  test('no email on file: approval still saves, waiverError reported, waiver stays NOT SENT', async () => {
    const res = await patch({ id: 'w_noemail', status: 'approved' })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.waiverError).toMatch(/No email on file/)
    expect(row('billing_submissions', 'w_noemail')).toMatchObject({ status: 'approved', lien_waiver_sent_at: null })
  })
  test('waiver email failure releases the claim so it shows NOT SENT', async () => {
    mockState.resendFail = true
    const out = await (await patch({ id: 'w1', status: 'approved' })).json()
    expect(out.waiverError).toBeTruthy()
    expect(row('billing_submissions', 'w1')).toMatchObject({ status: 'approved', lien_waiver_sent_at: null })
  })
  test('a waiver already sent is not re-sent on re-approval', async () => {
    row('billing_submissions', 'w1').lien_waiver_sent_at = '2026-11-01T00:00:00Z'
    const out = await (await patch({ id: 'w1', status: 'approved' })).json()
    expect(out.waiverSent).toBe(false)
    expect(mockState.emails.map(e => e.subject)).toEqual([expect.stringMatching(/Billing approved/)])
    expect(row('billing_submissions', 'w1').lien_waiver_sent_at).toBe('2026-11-01T00:00:00Z')
  })
})

describe('POST /api/lien-waiver: second send is harmless; resend is explicit', () => {
  const waiver = require('../app/api/lien-waiver/route')
  const send = body => waiver.POST(req('/api/lien-waiver', 'POST', body))
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'L1', job_id: 'J1', status: 'approved', amount_billed: 500, company_name: 'Acme', sub_id: null, sub_email: 'ann@acme.test', lien_waiver_sent_at: '2026-11-08T15:00:00Z', lien_waiver_signed_at: null },
      { id: 'L2', job_id: 'J1', status: 'approved', amount_billed: 600, company_name: 'Acme', sub_id: null, sub_email: 'ann@acme.test', lien_waiver_sent_at: null, lien_waiver_signed_at: null },
      { id: 'L3', job_id: 'J1', status: 'pending', amount_billed: 700, company_name: 'Acme', sub_id: null, sub_email: 'ann@acme.test', lien_waiver_sent_at: null },
      { id: 'L_other', job_id: 'J2', status: 'approved', amount_billed: 1, company_name: 'X', sub_id: null, sub_email: 'x@x.test', lien_waiver_sent_at: null },
    ]
  })
  test('already sent, no resend flag → ok, skipped, no email, stamp unchanged', async () => {
    const out = await (await send({ submission_id: 'L1' })).json()
    expect(out).toMatchObject({ ok: true, skipped: 'already_sent' })
    expect(mockState.emails).toHaveLength(0)
    expect(row('billing_submissions', 'L1').lien_waiver_sent_at).toBe('2026-11-08T15:00:00Z')
  })
  test('resend: true emails again and restamps', async () => {
    const out = await (await send({ submission_id: 'L1', resend: true })).json()
    expect(out.ok).toBe(true)
    expect(mockState.emails).toHaveLength(1)
    expect(row('billing_submissions', 'L1').lien_waiver_sent_at).not.toBe('2026-11-08T15:00:00Z')
  })
  test('not sent yet → sends and stamps', async () => {
    expect((await send({ submission_id: 'L2' })).status).toBe(200)
    expect(mockState.emails).toHaveLength(1)
    expect(row('billing_submissions', 'L2').lien_waiver_sent_at).toEqual(expect.any(String))
  })
  test('pending billing → 422; unassigned PM → 403; sub → 403; no email sent', async () => {
    expect((await send({ submission_id: 'L3' })).status).toBe(422)
    expect((await send({ submission_id: 'L_other' })).status).toBe(403)
    mockState.auth = { userId: 's1', role: 'subcontractor', error: null }
    expect((await send({ submission_id: 'L2' })).status).toBe(403)
    expect(mockState.emails).toHaveLength(0)
  })
  test('hostile billing text is escaped in the waiver email', async () => {
    row('billing_submissions', 'L2').company_name = '<img src=x onerror=alert(1)>'
    await send({ submission_id: 'L2' })
    expect(mockState.emails[0].html).not.toContain('<img src=x')
    expect(mockState.emails[0].html).toContain('&lt;img src=x')
  })
})

// ── Prompt 61 leftovers: races and the saved amount ─────────────────────────────
// Pause one request right before its write, run another to completion, then resume.
function pauseOnce(match) {
  let release, reached, done = false
  const gate = new Promise(r => { release = r })
  const hit = new Promise(r => { reached = r })
  mockState.pauseWrite = async (t, op, p) => { if (!done && match(t, op, p)) { done = true; reached(); await gate } }
  return { hit, release }
}

describe('billing-entry: first review vs a concurrent Close (H1, migration 059 guarded write)', () => {
  const draws = require('../app/api/draw-requests/route')
  const close = () => draws.PATCH(req('/api/draw-requests', 'PATCH', { id: 'D_open', status: 'closed' }))
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'fr', job_id: 'J1', status: 'pending', amount_billed: 900, draw_request_id: 'D_open', company_name: 'Acme', sub_id: 'sub1', sub_email: 'ann@acme.test', rejection_reason: null, lien_waiver_sent_at: null, lien_waiver_signed_at: null },
    ]
  })
  const plainBillingUpdates = () => mockState.calls.filter(c => c.table === 'billing_submissions' && c.op === 'update' && !c.via)

  test.each([
    ['pending → approved', { status: 'approved' }],
    ['pending → rejected (would untag)', { status: 'rejected', rejection_reason: 'blurry' }],
  ])('Close wins over %s: 409, still pending and tagged, no email or waiver', async (_l, body) => {
    const p = pauseOnce(t => t === 'rpc:billing_first_review')
    const review = patch({ id: 'fr', ...body })
    await p.hit
    const c = await close()
    expect(c.status).toBe(200)
    expect(row('draw_requests', 'D_open').status).toBe('closed')
    p.release()
    const res = await review
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/closed/i)
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'pending', draw_request_id: 'D_open', lien_waiver_sent_at: null })
    expect(mockState.emails).toHaveLength(0)
    expect((mockState.db.notifications || []).length).toBe(0)
    expect(plainBillingUpdates()).toHaveLength(0)
  })
  test('first review on an open draw goes through the guarded RPC (never the plain update)', async () => {
    expect((await patch({ id: 'fr', status: 'approved' })).status).toBe(200)
    expect(mockState.calls.some(c => c.table === 'rpc:billing_first_review' && c.payload.p_draw_id === 'D_open' && c.payload.p_status === 'approved')).toBe(true)
    expect(plainBillingUpdates().filter(c => 'status' in (c.payload || {}))).toHaveLength(0)
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'approved', draw_request_id: 'D_open' })
  })
  test('reject through the RPC clears the draw link in the same write', async () => {
    expect((await patch({ id: 'fr', status: 'rejected', rejection_reason: 'x' })).status).toBe(200)
    const call = mockState.calls.find(c => c.table === 'rpc:billing_first_review')
    expect(call.payload.p_patch).toMatchObject({ status: 'rejected', draw_request_id: null })
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'rejected', draw_request_id: null })
  })
  // ── 059 not applied yet (RPC missing): JS fallback — draw check, CAS write, draw re-check + revert.
  const unchanged = () => expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'pending', draw_request_id: 'D_open', rejection_reason: null, lien_waiver_sent_at: null })
  const nothingSent = () => {
    expect(mockState.emails).toHaveLength(0)
    expect((mockState.db.notifications || []).length).toBe(0)
  }
  test('059 not applied: approve on an OPEN draw → 200, approved, still tagged, mail + waiver + notify from the saved row', async () => {
    delete mockState.rpc.billing_first_review
    const res = await patch({ id: 'fr', status: 'approved' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.migration_required).toBeUndefined()
    expect(body.error).toBeUndefined()
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'approved', draw_request_id: 'D_open' })
    expect(mockState.calls.some(c => c.table === 'rpc:billing_first_review')).toBe(false)
    const approval = mockState.emails.find(m => /Billing approved/.test(m.subject))
    expect(approval).toBeTruthy()
    expect(approval.html).toContain('$900.00')
    expect(body.waiverSent).toBe(true)
    expect(row('billing_submissions', 'fr').lien_waiver_sent_at).toBeTruthy()
    expect(mockState.db.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'billing_approved', title: expect.stringContaining('$900.00') })]))
  })
  test('059 not applied: reject on an OPEN draw → 200, rejected and unlinked in the same write', async () => {
    delete mockState.rpc.billing_first_review
    const res = await patch({ id: 'fr', status: 'rejected', rejection_reason: 'wrong period' })
    expect(res.status).toBe(200)
    expect((await res.json()).untagged).toBe(true)
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'rejected', draw_request_id: null, rejection_reason: 'wrong period' })
    const writes = plainBillingUpdates().filter(c => 'status' in (c.payload || {}))
    expect(writes).toHaveLength(1)
    expect(writes[0].payload).toMatchObject({ status: 'rejected', draw_request_id: null })
  })
  test.each([
    ['approve', { status: 'approved' }],
    ['reject', { status: 'rejected', rejection_reason: 'x' }],
  ])('059 not applied: draw already closed → %s 409, unchanged, nothing written or sent', async (_l, body) => {
    delete mockState.rpc.billing_first_review
    row('draw_requests', 'D_open').status = 'closed'
    expect((await patch({ id: 'fr', ...body })).status).toBe(409)
    unchanged()
    nothingSent()
    expect(plainBillingUpdates()).toHaveLength(0)
  })
  test.each([
    ['approve', { status: 'approved' }],
    ['reject', { status: 'rejected', rejection_reason: 'x' }],
  ])('059 not applied: Close completes between the draw check and the write → %s reverted, 409, nothing sent', async (_l, body) => {
    delete mockState.rpc.billing_first_review
    const p = pauseOnce((t, op, pl) => t === 'billing_submissions' && op === 'update' && pl?.status === body.status)
    const review = patch({ id: 'fr', ...body })
    await p.hit
    expect((await close()).status).toBe(200)
    p.release()
    const res = await review
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/closed/i)
    unchanged()
    nothingSent()
    // The write did land, then was undone (back on the draw, reason dropped).
    const writes = plainBillingUpdates()
    expect(writes).toHaveLength(2)
    expect(writes[1].payload).toMatchObject({ status: 'pending', draw_request_id: 'D_open' })
  })
  test.each([
    ['approve', { status: 'approved' }],
    ['reject', { status: 'rejected', rejection_reason: 'x' }],
  ])('059 not applied: Close detected right after the write → %s reverted, 409, nothing sent', async (_l, body) => {
    delete mockState.rpc.billing_first_review
    // Close lands as the billing write commits (seen only by the post-write draw re-read).
    mockState.triggers.billing_submissions = ({ op, payload }) => {
      if (op === 'update' && payload?.status === body.status) row('draw_requests', 'D_open').status = 'closed'
      return null
    }
    const res = await patch({ id: 'fr', ...body })
    expect(res.status).toBe(409)
    unchanged()
    nothingSent()
    expect(row('draw_requests', 'D_open').status).toBe('closed')
  })
  test('059 not applied: billing changed by someone else between check and write → 409, no mail', async () => {
    delete mockState.rpc.billing_first_review
    const p = pauseOnce((t, op, pl) => t === 'billing_submissions' && op === 'update' && pl?.status === 'approved')
    const review = patch({ id: 'fr', status: 'approved' })
    await p.hit
    row('billing_submissions', 'fr').draw_request_id = null // e.g. taken off the draw meanwhile
    p.release()
    expect((await review).status).toBe(409)
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'pending', draw_request_id: null })
    nothingSent()
  })
  test('a first review may not move the invoice to another draw in the same request', async () => {
    mockState.db.draw_requests.push({ id: 'D_open2', job_id: 'J1', draw_number: 3, status: 'open' })
    expect((await patch({ id: 'fr', status: 'approved', draw_request_id: 'D_open2' })).status).toBe(422)
    expect(row('billing_submissions', 'fr')).toMatchObject({ status: 'pending', draw_request_id: 'D_open' })
  })
  test('untagged first review still uses the normal guarded update (no RPC)', async () => {
    mockState.db.billing_submissions.push({ id: 'free', job_id: 'J1', status: 'pending', amount_billed: 10, draw_request_id: null, company_name: 'Acme', sub_id: null })
    delete mockState.rpc.billing_first_review
    expect((await patch({ id: 'free', status: 'approved' })).status).toBe(200)
    expect(row('billing_submissions', 'free').status).toBe('approved')
  })
})

describe('billing-entry: tagging lands only while still approved (H2)', () => {
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'a1', job_id: 'J1', status: 'approved', amount_billed: 300, draw_request_id: null, company_name: 'Acme', sub_id: null },
      { id: 'p1', job_id: 'J1', status: 'pending', amount_billed: 100, draw_request_id: null, company_name: 'Acme', sub_id: null },
    ]
  })
  const isTag = (t, op, p) => t === 'billing_submissions' && op === 'update' && p?.draw_request_id === 'D_open'

  test('concurrent reopen (approved → pending) beats the tag: 409, stays untagged', async () => {
    const p = pauseOnce(isTag)
    const tag = patch({ id: 'a1', draw_request_id: 'D_open' })
    await p.hit
    expect((await patch({ id: 'a1', status: 'pending' })).status).toBe(200)
    p.release()
    expect((await tag).status).toBe(409)
    expect(row('billing_submissions', 'a1')).toMatchObject({ status: 'pending', draw_request_id: null })
  })
  test('concurrent reopen + reject beats the tag: 409, stays untagged', async () => {
    const p = pauseOnce(isTag)
    const tag = patch({ id: 'a1', draw_request_id: 'D_open' })
    await p.hit
    expect((await patch({ id: 'a1', status: 'pending' })).status).toBe(200)
    expect((await patch({ id: 'a1', status: 'rejected', rejection_reason: 'wrong' })).status).toBe(200)
    p.release()
    expect((await tag).status).toBe(409)
    expect(row('billing_submissions', 'a1')).toMatchObject({ status: 'rejected', draw_request_id: null })
  })
  test('the tag write compares status = approved', async () => {
    expect((await patch({ id: 'a1', draw_request_id: 'D_open' })).status).toBe(200)
    expect(row('billing_submissions', 'a1')).toMatchObject({ status: 'approved', draw_request_id: 'D_open' })
    // if the stored status changed underneath, nothing lands
    row('billing_submissions', 'a1').draw_request_id = null
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') row('billing_submissions', 'a1').status = 'pending' }
    expect((await patch({ id: 'a1', draw_request_id: 'D_open' })).status).toBe(409)
    expect(row('billing_submissions', 'a1').draw_request_id).toBeNull()
  })
  test('approve + tag in one PATCH is allowed (status CAS on pending)', async () => {
    expect((await patch({ id: 'p1', status: 'approved', draw_request_id: 'D_open' })).status).toBe(200)
    expect(row('billing_submissions', 'p1')).toMatchObject({ status: 'approved', draw_request_id: 'D_open' })
  })
  test('approve + tag loses to a concurrent reject: 409, untagged', async () => {
    const p = pauseOnce(isTag)
    const both = patch({ id: 'p1', status: 'approved', draw_request_id: 'D_open' })
    await p.hit
    expect((await patch({ id: 'p1', status: 'rejected', rejection_reason: 'no' })).status).toBe(200)
    p.release()
    expect((await both).status).toBe(409)
    expect(row('billing_submissions', 'p1')).toMatchObject({ status: 'rejected', draw_request_id: null })
    expect(mockState.emails).toHaveLength(0)
  })
  test('read-time 422 for a pending tag is unchanged', async () => {
    expect((await patch({ id: 'p1', draw_request_id: 'D_open' })).status).toBe(422)
  })
})

describe('billing-entry: approval email uses the saved amount (M1)', () => {
  const patch = body => billing.PATCH(req('/api/billing-entry', 'PATCH', body))
  beforeEach(() => {
    mockState.db.billing_submissions = [
      { id: 'B', job_id: 'J1', status: 'pending', amount_billed: 250, draw_request_id: null, company_name: 'Acme', sub_id: 'sub1', sub_email: 'ann@acme.test', lien_waiver_sent_at: null, lien_waiver_signed_at: null },
    ]
  })
  test('amount + pending → approved in one PATCH: email, waiver and notification all say $400', async () => {
    const res = await patch({ id: 'B', amount_billed: 400, status: 'approved' })
    expect(res.status).toBe(200)
    expect(row('billing_submissions', 'B')).toMatchObject({ status: 'approved', amount_billed: 400 })
    const approval = mockState.emails.find(e => /Billing approved/.test(e.subject))
    expect(approval.html).toContain('$400.00')
    expect(approval.html).not.toContain('$250.00')
    const waiver = mockState.emails.find(e => /Lien Waiver/.test(e.subject))
    expect(waiver.html).toContain('400.00')
    await new Promise(r => setTimeout(r, 0))
    const n = (mockState.db.notifications || []).find(x => x.type === 'billing_approved')
    expect(n.title).toContain('$400.00')
  })
  test('a 409 (lost race) sends no approval email or waiver', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') row('billing_submissions', 'B').status = 'rejected' }
    expect((await patch({ id: 'B', amount_billed: 400, status: 'approved' })).status).toBe(409)
    expect(mockState.emails).toHaveLength(0)
  })
})
