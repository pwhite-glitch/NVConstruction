/**
 * Prompt 53 — finding 5: record payment.
 *  - payment_amount is CUMULATIVE paid-to-date; paid_at is the settlement marker, stamped
 *    only when paid-to-date reaches net (billed − retainage), computed from the stored row.
 *  - Short checks stay unpaid (paid_at NULL) and keep their remaining balance in the cash
 *    outlook without double subtraction.
 *  - 0 / negative / non-finite / malformed / over-net amounts refused server-side.
 *  - Legacy settled rows with NULL payment_amount count as net everywhere.
 * All DB access is the in-memory mock; nothing real is touched.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } } }))
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

const billing = require('../app/api/billing-entry/route')
const {
  billingPaymentSummary, billingPaidAmount, planBillingPayment, parsePaymentAmount,
  paymentMismatchWarning, buildPaymentRequest, netBelowPaidError, paymentStatusText,
} = require('../lib/billing-payment')
const { billingItems } = require('../lib/cash-outlook')

const req = body => new Request('http://x/api/billing-entry', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = body => billing.PATCH(req(body))
const row = id => mockState.db.billing_submissions.find(r => r.id === id)

beforeEach(() => {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', payment_type: 'nv_pays' }],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }],
    draw_requests: [{ id: 'D_closed', job_id: 'J1', draw_number: 2, status: 'closed' }],
    billing_submissions: [
      // net = 1000 − 100 = 900
      { id: 'b1', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_held: 100, retainage_pct: 10, paid_at: null, payment_amount: null, draw_request_id: null, company_name: 'Acme', sub_id: null },
      { id: 'bDraw', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_held: 100, retainage_pct: 10, paid_at: null, payment_amount: null, draw_request_id: 'D_closed', company_name: 'Acme', sub_id: null },
      { id: 'bPend', job_id: 'J1', status: 'pending', amount_billed: 500, retainage_held: 0, paid_at: null, payment_amount: null, draw_request_id: null, company_name: 'Acme', sub_id: null },
      { id: 'bLegacy', job_id: 'J1', status: 'approved', amount_billed: 800, retainage_held: 80, paid_at: '2026-09-01T12:00:00Z', payment_amount: null, draw_request_id: null, company_name: 'Acme', sub_id: null },
    ],
    notifications: [],
  })
  mockState.auth = { userId: 'pm1', role: 'pm', email: 'pm1@x.com', error: null }
})

describe('shared money model', () => {
  test('net / paid / remaining with cents and legacy fallback', () => {
    expect(billingPaymentSummary({ amount_billed: 1000, retainage_held: 100 })).toMatchObject({ net: 900, paid: 0, remaining: 900, settled: false, partial: false })
    expect(billingPaymentSummary({ amount_billed: 1000, retainage_held: 100, payment_amount: 400 })).toMatchObject({ paid: 400, remaining: 500, partial: true })
    // legacy fully-paid row with NULL amount = net
    expect(billingPaymentSummary({ amount_billed: 800, retainage_held: 80, paid_at: '2026-09-01' })).toMatchObject({ paid: 720, remaining: 0, settled: true, legacyFull: true })
    // explicit 0 is not "unknown"
    expect(billingPaymentSummary({ amount_billed: 100, retainage_held: 0, payment_amount: 0 })).toMatchObject({ paid: 0, partial: false })
    // floating point: 0.1 + 0.2 style values compared in cents
    expect(billingPaymentSummary({ amount_billed: '0.30', retainage_held: '0.10', payment_amount: '0.20' }).remaining).toBe(0)
  })
  test('legacy null amount uses net identically for rows and totals', () => {
    const rows = [{ amount_billed: 800, retainage_held: 80, paid_at: 'x' }, { amount_billed: 1000, retainage_held: 100, paid_at: 'x', payment_amount: 900 }]
    expect(rows.reduce((s, b) => s + billingPaidAmount(b), 0)).toBe(1620)
  })
  test('settled with a recorded amount ≠ net is flagged for review', () => {
    expect(billingPaymentSummary({ amount_billed: 1000, retainage_held: 100, paid_at: 'x', payment_amount: 500 }).mismatch).toBe(true)
  })
  test('parsePaymentAmount rejects blank / 0 / negative / NaN / Infinity / malformed / sub-cent', () => {
    for (const v of ['', null, undefined, 0, '0', -5, '-5', NaN, Infinity, 'abc', '1e3', '12.345', {}, []]) {
      expect(parsePaymentAmount(v).error).toBeTruthy()
    }
    expect(parsePaymentAmount('12.34')).toEqual({ cents: 1234 })
  })
  test('status text never says paid for a short check', () => {
    expect(paymentStatusText({ amount_billed: 1000, retainage_held: 100, payment_amount: 400 })).toMatch(/^Partially paid \$400\.00 of \$900\.00 · \$500\.00 remaining$/)
    expect(paymentStatusText({ amount_billed: 1000, retainage_held: 100 })).toBeNull()
  })
})

describe('server PATCH /api/billing-entry payments', () => {
  test('partial net payment keeps paid_at NULL even when caller sends paid_at', async () => {
    const res = await patch({ id: 'b1', record_payment_amount: 400, paid_at: '2026-11-01T12:00:00Z' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment).toMatchObject({ paid: 400, remaining: 500, settled: false })
    expect(row('b1')).toMatchObject({ paid_at: null, payment_amount: 400 })
  })
  test('legacy-style caller sending a short payment_amount total + paid_at stays unpaid', async () => {
    expect((await patch({ id: 'b1', payment_amount: 300, paid_at: '2026-11-01T12:00:00Z' })).status).toBe(200)
    expect(row('b1')).toMatchObject({ paid_at: null, payment_amount: 300 })
  })
  test('second payment accumulates once and settles at exact net', async () => {
    await patch({ id: 'b1', record_payment_amount: 400 })
    const res = await patch({ id: 'b1', record_payment_amount: 500, paid_at: '2026-11-05T12:00:00Z' })
    expect(res.status).toBe(200)
    expect(row('b1')).toMatchObject({ payment_amount: 900, paid_at: '2026-11-05T12:00:00Z' })
  })
  test('exact net in one check settles', async () => {
    expect((await patch({ id: 'b1', record_payment_amount: '900.00' })).status).toBe(200)
    expect(row('b1').payment_amount).toBe(900)
    expect(row('b1').paid_at).toBeTruthy()
  })
  test.each([[0], [-10], ['abc'], [''], [null], ['Infinity'], [900.01], [1000]])('refuses %p', async amt => {
    const res = await patch({ id: 'b1', record_payment_amount: amt })
    expect(res.status).toBe(422)
    expect(row('b1')).toMatchObject({ paid_at: null, payment_amount: null })
  })
  test('over remaining after a partial is refused (no overpayment)', async () => {
    await patch({ id: 'b1', record_payment_amount: 400 })
    expect((await patch({ id: 'b1', record_payment_amount: 600 })).status).toBe(422)
    expect(row('b1').payment_amount).toBe(400)
  })
  test('paid_at alone on an unpaid billing cannot mark it paid', async () => {
    expect((await patch({ id: 'b1', paid_at: '2026-11-01T12:00:00Z' })).status).toBe(422)
    expect(row('b1').paid_at).toBeNull()
  })
  test('net is computed from the stored row, not a body net / amount', async () => {
    expect((await patch({ id: 'b1', record_payment_amount: 1000, net: 1000, amount_billed: 1000, retainage_held: 0 })).status).toBe(422)
    expect(row('b1')).toMatchObject({ retainage_held: 100, payment_amount: null })
  })
  test('cannot lower paid-to-date via a total edit; cannot combine add + total', async () => {
    await patch({ id: 'b1', record_payment_amount: 400 })
    expect((await patch({ id: 'b1', payment_amount: 300 })).status).toBe(422)
    expect((await patch({ id: 'b1', payment_amount: 500, record_payment_amount: 100 })).status).toBe(422)
    expect(row('b1').payment_amount).toBe(400)
  })
  test('already settled billing refuses another payment', async () => {
    expect((await patch({ id: 'bLegacy', record_payment_amount: 1 })).status).toBe(409)
  })
  test('pending billing cannot record a payment', async () => {
    expect((await patch({ id: 'bPend', record_payment_amount: 100 })).status).toBe(422)
  })
  test('double submit / second tab: payment lands only on the paid-to-date read', async () => {
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') { row('b1').payment_amount = 400; mockState.beforeWrite = null } }
    const res = await patch({ id: 'b1', record_payment_amount: 400 })
    expect(res.status).toBe(409)
    expect(row('b1').payment_amount).toBe(400) // the other tab's write, not 800
  })
  // 53b: the payment UPDATE also matches the billed / retainage / status values net was
  // computed from — a concurrent edit between read and write → 409, nothing settles.
  test.each([
    ['retainage_held', r => { r.retainage_held = 200 }],
    ['retainage_pct', r => { r.retainage_pct = 20 }],
    ['amount_billed', r => { r.amount_billed = 1200 }],
    ['status', r => { r.status = 'pending' }],
  ])('payment against a row whose %s changed since read → 409, no paid_at', async (_col, change) => {
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') { change(row('b1')); mockState.beforeWrite = null } }
    const res = await patch({ id: 'b1', record_payment_amount: 900 })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/changed by someone else/)
    expect(row('b1')).toMatchObject({ paid_at: null, payment_amount: null })
  })
  test('happy path settlement still matches the snapshot and settles', async () => {
    const res = await patch({ id: 'b1', record_payment_amount: 900, paid_at: '2026-11-06T12:00:00Z' })
    expect(res.status).toBe(200)
    expect(row('b1')).toMatchObject({ payment_amount: 900, paid_at: '2026-11-06T12:00:00Z', retainage_held: 100, amount_billed: 1000 })
  })
  test('retainage / billed edit only lands on the paid-to-date it was checked against', async () => {
    await patch({ id: 'b1', record_payment_amount: 400 })
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') { row('b1').payment_amount = 850; mockState.beforeWrite = null } }
    const res = await patch({ id: 'b1', retainage_held: 300, retainage_pct: 30 })
    expect(res.status).toBe(409)
    expect(row('b1')).toMatchObject({ retainage_held: 100, payment_amount: 850 })
    // ...and a concurrent settlement can't be overwritten either
    mockState.beforeWrite = (t, op) => { if (t === 'billing_submissions' && op === 'update') { row('b1').paid_at = '2026-11-06T12:00:00Z'; mockState.beforeWrite = null } }
    expect((await patch({ id: 'b1', retainage_held: 120, retainage_pct: 12 })).status).toBe(409)
    expect(row('b1').retainage_held).toBe(100)
    // no concurrent change → the edit saves
    row('b1').paid_at = null
    expect((await patch({ id: 'b1', retainage_held: 150, retainage_pct: 15 })).status).toBe(200)
    expect(row('b1').retainage_held).toBe(150)
  })
  test('payment on a closed draw billing still allowed; draw financial lock unchanged', async () => {
    expect((await patch({ id: 'bDraw', record_payment_amount: 900 })).status).toBe(200)
    expect(row('bDraw')).toMatchObject({ payment_amount: 900, amount_billed: 1000, draw_request_id: 'D_closed' })
    expect((await patch({ id: 'bDraw', retainage_held: 50, retainage_pct: 5 })).status).toBe(409)
  })
  test('payment cannot ride along with a status change or billed edit', async () => {
    expect((await patch({ id: 'b1', record_payment_amount: 100, status: 'pending' })).status).toBe(422)
  })
  test('billed/retainage edit cannot drop net below what is already paid', async () => {
    const cur = { amount_billed: 1000, retainage_held: 100, payment_amount: 800 }
    expect(netBelowPaidError(cur, { retainage_held: 300 })).toMatch(/already has \$800\.00 paid/)
    expect(netBelowPaidError(cur, { retainage_held: 150 })).toBeNull()
  })
  test('subs cannot record payments', async () => {
    mockState.auth = { userId: 's1', role: 'subcontractor', error: null }
    row('bPend').sub_id = 's1'
    await patch({ id: 'bPend', payment_amount: 500, paid_at: 'x' })
    expect(row('bPend')).toMatchObject({ payment_amount: null, paid_at: null })
  })
})

describe('admin form → request', () => {
  const r = { id: 'b1', amount_billed: 1000, retainage_held: 100, paid_at: null, payment_amount: null }
  test('blank amount is refused before any request; never sends null amount', () => {
    expect(buildPaymentRequest(r, { payment_amount: '' }).error).toMatch(/Enter the amount/)
    expect(buildPaymentRequest(r, { payment_amount: '0' }).error).toBeTruthy()
  })
  test('short check: no paid_at, ledger line appended, warning shown', () => {
    const out = buildPaymentRequest(r, { payment_amount: '400', paid_at: '2026-11-01', payment_method: 'Check', check_number: '77' })
    expect(out.body).toMatchObject({ id: 'b1', record_payment_amount: 400, check_number: '77' })
    expect(out.body).not.toHaveProperty('paid_at')
    expect(out.body).not.toHaveProperty('payment_amount')
    expect(out.body.payment_notes).toBe('2026-11-01: partial payment $400.00 by Check #77')
    expect(out.warning).toMatch(/PARTIAL payment.*\$500\.00 left/)
    expect(out.settles).toBe(false)
  })
  test('remaining amount settles with the form date, no warning', () => {
    const out = buildPaymentRequest(r, { payment_amount: '900', paid_at: '2026-11-01' })
    expect(out.settles).toBe(true)
    expect(out.warning).toBeNull()
    expect(out.body.paid_at).toBe(new Date('2026-11-01T12:00:00').toISOString())
  })
  test('second check after a partial: added to paid-to-date, prior notes preserved', () => {
    const partial = { ...r, payment_amount: 400, payment_notes: '2026-11-01: partial payment $400.00' }
    const out = buildPaymentRequest(partial, { payment_amount: '500', paid_at: '2026-11-08' })
    expect(out.settles).toBe(true)
    expect(out.summary).toMatchObject({ prior: 400, paid: 900, remaining: 0 })
    expect(out.body.payment_notes.split('\n')).toHaveLength(2)
  })
  test('over remaining refused client-side; warning text says it will be refused', () => {
    expect(buildPaymentRequest(r, { payment_amount: '950' }).error).toMatch(/more than the \$900\.00 remaining/)
    expect(paymentMismatchWarning(r, 950)).toMatch(/refused/)
  })
  test('settled row cannot take another payment', () => {
    expect(buildPaymentRequest({ ...r, paid_at: 'x' }, { payment_amount: '1' }).error).toMatch(/already/)
  })
  test('client request and server plan agree end-to-end', async () => {
    const out = buildPaymentRequest(row('b1'), { payment_amount: '250.50', paid_at: '2026-11-01' })
    expect((await patch(out.body)).status).toBe(200)
    expect(row('b1')).toMatchObject({ payment_amount: 250.5, paid_at: null })
  })
})

describe('cash outlook keeps the remaining balance once', () => {
  test('partial payment subtracts once; settled rows drop out', () => {
    const jobsById = { J1: { id: 'J1', payment_type: 'nv_pays' } }
    const billings = [
      { id: 'p', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_held: 100, payment_amount: 400, paid_at: null },
      { id: 's', job_id: 'J1', status: 'approved', amount_billed: 1000, retainage_held: 100, payment_amount: 900, paid_at: '2026-11-01' },
    ]
    const { items } = billingItems({ jobsById, billings, datesMigrated: true })
    expect(items).toHaveLength(1)
    expect(Math.abs(items[0].amount)).toBe(billingPaymentSummary(billings[0]).remaining)
  })
  test('plan output matches cash-outlook remaining after a partial', () => {
    const cur = { status: 'approved', amount_billed: 1000, retainage_held: 100, paid_at: null, payment_amount: null }
    const plan = planBillingPayment(cur, { record_payment_amount: 250 })
    const after = { ...cur, ...plan.patch, id: 'x', job_id: 'J1' }
    const { items } = billingItems({ jobsById: { J1: { id: 'J1', payment_type: 'nv_pays' } }, billings: [after], datesMigrated: true })
    expect(Math.abs(items[0].amount)).toBe(plan.summary.remaining)
  })
})

describe('UI wiring (source checks back the behavioral tests above)', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../app/admin/page.js'), 'utf8')
  const submit = fs.readFileSync(path.join(__dirname, '../app/submit/page.js'), 'utf8')
  test('admin markPaid uses the shared request builder and confirms mismatches', () => {
    const fn = admin.slice(admin.indexOf('async function markPaid'), admin.indexOf('async function saveBillEdit'))
    expect(fn).toMatch(/buildPaymentRequest\(row, payForm\)/)
    expect(fn).toMatch(/window\.confirm\(req\.warning/)
    expect(fn).not.toMatch(/paid_at:\s*payForm/)
    expect(fn).not.toMatch(/: null,\s*\n\s*payment_method/)
  })
  test('admin totals use the shared paid fallback, no truthy gross fallback', () => {
    expect(admin).not.toMatch(/payment_amount \|\| b\.amount_billed/)
    expect(admin).not.toMatch(/payment_amount \|\| grossAmt/)
    expect(admin).toMatch(/Partial payments — billing still unpaid/)
  })
  test('sub portal shows partial, and settled amount via shared fallback', () => {
    expect(submit).toMatch(/Partial payment received/)
    expect(submit).toMatch(/billingPaidAmount\(s2\)/)
  })
})
