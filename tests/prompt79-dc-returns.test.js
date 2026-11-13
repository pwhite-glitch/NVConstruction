/**
 * Prompt 79: direct-cost RETURNS can be entered as negative amounts.
 *  - Storage rule: amount stays >= 0 and is_credit carries the sign. A negative amount is
 *    never stored; -250 becomes { amount: 250, is_credit: true } (lib/dc-amount.js).
 *  - POST /api/direct-costs normalizes every row (bulk too); 0 / blank / junk → 400.
 *  - /api/dc-review edit + resubmit accept is_credit and negative amounts.
 *  - Sums that use (is_credit ? -1 : 1) * amount keep working (queue, residential money).
 *  - Duplicate flag keys on direction + amount; owner reimbursement credit lines are negative.
 * In-memory DB, mocked auth / email. Nothing live.
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

const { mintUpload } = require('./helpers/upload-receipt')
const directCosts = require('../app/api/direct-costs/route')
const dcReview = require('../app/api/dc-review/route')
const { normalizeDcAmount, csvDcAmount, dcDuplicateKey, ownerReimbLineAmounts, isNegativeDcInput, dcReturnHint, DC_AMOUNT_ERROR } = require('../lib/dc-amount')
const { queueTotal } = require('../lib/direct-cost-queue')
const { approvedDcTotal, packagedDrawTotal, signedDcAmount } = require('../lib/residential-money')

const J1 = 'job-1'
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const out = async r => ({ status: r.status, body: await r.json() })
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null } }
const dc = id => mockState.db.direct_costs.find(c => c.id === id)
const byDesc = d => mockState.db.direct_costs.filter(c => c.description === d)

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, job_number: '101', project_name: 'Main' }],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-super' }],
    direct_costs: [
      { id: 'dc-charge', job_id: J1, status: 'pending', submitted_by: 'u-super', receipt_url: `${J1}/1.jpg`, amount: 100, is_credit: false, draw_request_id: null, drawn_application_id: null },
      { id: 'dc-credit', job_id: J1, status: 'pending', submitted_by: 'u-super', receipt_url: `${J1}/2.jpg`, amount: 100, is_credit: true, draw_request_id: null, drawn_application_id: null },
      { id: 'dc-rej', job_id: J1, status: 'rejected', submitted_by: 'u-super', receipt_url: `${J1}/3.jpg`, amount: 5, is_credit: false, draw_request_id: null, drawn_application_id: null },
    ],
    profiles: [],
    owner_reimb_invoice_lines: [],
  })
})

// ── normalizeDcAmount ───────────────────────────────────────────────────────
describe('normalizeDcAmount', () => {
  test('a negative amount is a return; storage stays positive', () => {
    expect(normalizeDcAmount({ amount: -250 })).toEqual({ amount: 250, is_credit: true })
    expect(normalizeDcAmount({ amount: '-250', is_credit: false })).toEqual({ amount: 250, is_credit: true })
  })
  test('positive + ticked box is a return; negative + ticked is still one return', () => {
    expect(normalizeDcAmount({ amount: 250, is_credit: true })).toEqual({ amount: 250, is_credit: true })
    expect(normalizeDcAmount({ amount: -250, is_credit: true })).toEqual({ amount: 250, is_credit: true })
    expect(normalizeDcAmount({ amount: 250 })).toEqual({ amount: 250, is_credit: false })
  })
  test('0, blank, junk → error', () => {
    for (const amount of [0, '0', '', '   ', 'abc', null, undefined, NaN, '-0', '0.001', '12abc']) {
      expect(normalizeDcAmount({ amount })).toEqual({ error: DC_AMOUNT_ERROR })
    }
    expect(DC_AMOUNT_ERROR).toBe('Enter an amount (use a negative number for a return)')
  })
  test('rounds to cents; parses $ and commas; unicode minus', () => {
    expect(normalizeDcAmount({ amount: 12.345 })).toEqual({ amount: 12.35, is_credit: false })
    expect(normalizeDcAmount({ amount: '-12.345' })).toEqual({ amount: 12.35, is_credit: true })
    expect(normalizeDcAmount({ amount: '$1,200.50' })).toEqual({ amount: 1200.5, is_credit: false })
    expect(normalizeDcAmount({ amount: ' -$1,200.50 ' })).toEqual({ amount: 1200.5, is_credit: true })
    expect(normalizeDcAmount({ amount: '−75' })).toEqual({ amount: 75, is_credit: true })
  })
  test('form hint helpers', () => {
    expect(isNegativeDcInput('-250')).toBe(true)
    expect(isNegativeDcInput('250')).toBe(false)
    expect(isNegativeDcInput('-')).toBe(false)
    expect(dcReturnHint('-250')).toBe('−$250.00 return')
    expect(dcReturnHint('250')).toBe('')
  })
})

// ── POST /api/direct-costs ──────────────────────────────────────────────────
describe('POST /api/direct-costs', () => {
  test('-50 stores { amount: 50, is_credit: true }', async () => {
    as('principal')
    const res = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'Return', amount: -50, status: 'approved' })))
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(byDesc('Return')[0]).toMatchObject({ amount: 50, is_credit: true })
  })
  test('bulk row with -50 stores a credit; the other row stays a charge', async () => {
    as('principal')
    const res = await out(await directCosts.POST(req('/api/direct-costs', 'POST', [
      { job_id: J1, description: 'Bulk return', amount: -50, status: 'approved' },
      { job_id: J1, description: 'Bulk charge', amount: '$1,200.50', status: 'approved' },
    ])))
    expect(res.status).toBe(200)
    expect(byDesc('Bulk return')[0]).toMatchObject({ amount: 50, is_credit: true })
    expect(byDesc('Bulk charge')[0]).toMatchObject({ amount: 1200.5, is_credit: false })
    expect(mockState.db.direct_costs.every(c => c.amount >= 0)).toBe(true)
  })
  test('0 / blank / junk refused with 400 and the helper message; nothing written (bulk too)', async () => {
    as('principal')
    for (const amount of [0, '', 'abc']) {
      const res = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'Bad', amount, status: 'approved' })))
      expect(res).toEqual({ status: 400, body: { error: DC_AMOUNT_ERROR } })
    }
    const bulk = await out(await directCosts.POST(req('/api/direct-costs', 'POST', [
      { job_id: J1, description: 'Ok row', amount: 10 },
      { job_id: J1, description: 'Bad row', amount: 0 },
    ])))
    expect(bulk.status).toBe(400)
    expect(bulk.body.error).toBe(`Row 2: ${DC_AMOUNT_ERROR}`)
    expect(byDesc('Bad').length + byDesc('Ok row').length + byDesc('Bad row').length).toBe(0)
  })
  test('receipt rule still applies to a field (super) credit: no receipt → refused; a return slip counts', async () => {
    as('super')
    const blocked = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'Field return', amount: -40, status: 'pending' })))
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toMatch(/receipt photo or PDF is required/)
    expect(byDesc('Field return')).toEqual([])
    const u = await mintUpload({ target: 'direct-cost-receipt', subject: 'u-super', ctx: { job: J1 }, store: mockState })
    const ok = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'Field return', amount: -40, status: 'pending', attachment: u.attachment })))
    expect(ok.status).toBe(200)
    expect(byDesc('Field return')[0]).toMatchObject({ amount: 40, is_credit: true, receipt_url: u.path })
  })
})

// ── /api/dc-review edit + resubmit ──────────────────────────────────────────
describe('/api/dc-review', () => {
  const post = body => dcReview.POST(req('/api/dc-review', 'POST', body))

  test('edit to -50 stores { 50, true }', async () => {
    as('principal')
    expect((await post({ action: 'edit', id: 'dc-charge', amount: -50 })).status).toBe(200)
    expect(dc('dc-charge')).toMatchObject({ amount: 50, is_credit: true })
  })
  test('100 → -100 becomes a credit; is_credit:false with 100 goes back to a charge', async () => {
    as('principal')
    expect((await post({ action: 'edit', id: 'dc-charge', amount: '-100' })).status).toBe(200)
    expect(dc('dc-charge')).toMatchObject({ amount: 100, is_credit: true })
    expect((await post({ action: 'edit', id: 'dc-charge', amount: 100, is_credit: false })).status).toBe(200)
    expect(dc('dc-charge')).toMatchObject({ amount: 100, is_credit: false })
  })
  test('amount alone keeps the stored direction; is_credit alone flips it', async () => {
    as('principal')
    expect((await post({ action: 'edit', id: 'dc-credit', amount: 80 })).status).toBe(200)
    expect(dc('dc-credit')).toMatchObject({ amount: 80, is_credit: true })
    expect((await post({ action: 'edit', id: 'dc-credit', is_credit: false })).status).toBe(200)
    expect(dc('dc-credit')).toMatchObject({ amount: 80, is_credit: false })
  })
  test('edit to 0 / junk refused; nothing saved', async () => {
    as('principal')
    for (const amount of [0, 'abc', '']) {
      const res = await out(await post({ action: 'edit', id: 'dc-charge', amount }))
      expect(res).toEqual({ status: 400, body: { error: DC_AMOUNT_ERROR } })
    }
    expect(dc('dc-charge')).toMatchObject({ amount: 100, is_credit: false })
  })
  test('resubmit at -75 → pending credit of 75', async () => {
    as('super')
    expect((await post({ action: 'resubmit', id: 'dc-rej', amount: -75 })).status).toBe(200)
    expect(dc('dc-rej')).toMatchObject({ status: 'pending', amount: 75, is_credit: true })
  })
  test('resubmit at 0 refused; blank amount keeps the stored one', async () => {
    as('super')
    expect((await out(await post({ action: 'resubmit', id: 'dc-rej', amount: 0 })))).toEqual({ status: 400, body: { error: DC_AMOUNT_ERROR } })
    expect(dc('dc-rej').status).toBe('rejected')
    expect((await post({ action: 'resubmit', id: 'dc-rej', amount: '', description: 'fixed' })).status).toBe(200)
    expect(dc('dc-rej')).toMatchObject({ status: 'pending', amount: 5, is_credit: false, description: 'fixed' })
  })
})

// ── Sums keep working with positive storage + is_credit ─────────────────────
describe('signed sums', () => {
  const charge = { id: 'a', job_id: J1, amount: 1000, is_credit: false, status: 'approved', draw_request_id: 'D1' }
  const credit = { ...normalizeDcAmount({ amount: -250 }), id: 'b', job_id: J1, status: 'approved', draw_request_id: 'D1' }
  test('queue total: a 250 credit lowers it by 250', () => {
    expect(queueTotal([charge])).toBe(1000)
    expect(queueTotal([charge, credit])).toBe(750)
  })
  test('residential money: a 250 credit lowers totals by 250', () => {
    expect(signedDcAmount(credit)).toBe(-250)
    expect(approvedDcTotal([charge]) - approvedDcTotal([charge, credit])).toBe(250)
    expect(packagedDrawTotal('D1', [charge]) - packagedDrawTotal('D1', [charge, credit])).toBe(250)
  })
})

// ── Duplicate flag ──────────────────────────────────────────────────────────
describe('dcDuplicateKey', () => {
  const group = costs => {
    const by = {}
    for (const c of costs) (by[dcDuplicateKey(c)] ||= []).push(c.id)
    return Object.values(by).filter(ids => ids.length > 1)
  }
  test('a 250 purchase and a 250 return are not duplicates', () => {
    expect(group([{ id: 1, amount: 250, is_credit: false }, { id: 2, amount: 250, is_credit: true }])).toEqual([])
  })
  test('two 250 purchases (or two 250 returns) still are', () => {
    expect(group([{ id: 1, amount: 250 }, { id: 2, amount: '250.00', is_credit: false }])).toEqual([[1, 2]])
    expect(group([{ id: 1, amount: 250, is_credit: true }, { id: 2, amount: 250, is_credit: true }])).toEqual([[1, 2]])
  })
})

// ── Owner reimbursement invoice lines ───────────────────────────────────────
describe('ownerReimbLineAmounts', () => {
  test('a credit line is negative (markup too) and lowers the invoice total', () => {
    const lines = [
      ownerReimbLineAmounts({ amount: 1000, is_credit: false }, 10),
      ownerReimbLineAmounts({ amount: 250, is_credit: true }, 10),
    ]
    expect(lines[0]).toEqual({ expense_amount: 1000, markup_pct: 10, billed_amount: 1100 })
    expect(lines[1]).toEqual({ expense_amount: -250, markup_pct: 10, billed_amount: -275 })
    expect(lines.reduce((a, l) => a + l.billed_amount, 0)).toBe(825)
    expect(lines.reduce((a, l) => a + l.expense_amount, 0)).toBe(750)
  })
  test('no markup; cents rounding is symmetric', () => {
    expect(ownerReimbLineAmounts({ amount: 99.99, is_credit: true })).toEqual({ expense_amount: -99.99, markup_pct: 0, billed_amount: -99.99 })
    const pos = ownerReimbLineAmounts({ amount: 10.05 }, 5).billed_amount
    const neg = ownerReimbLineAmounts({ amount: 10.05, is_credit: true }, 5).billed_amount
    expect(neg).toBe(-pos)
  })
})

// ── CSV import ──────────────────────────────────────────────────────────────
describe('csvDcAmount', () => {
  test('-120.50 → { 120.5, is_credit: true }; positive stays a charge', () => {
    expect(csvDcAmount('-120.50')).toEqual({ amount: 120.5, is_credit: true })
    expect(csvDcAmount('$2,500.00')).toEqual({ amount: 2500, is_credit: false })
  })
  test('0 / blank / junk → bad amount', () => {
    for (const v of ['0', '', 'abc', null]) expect(csvDcAmount(v)).toEqual({ error: 'bad amount' })
  })
})
