/**
 * Prompt 69: job Cash Flow tab counts purchase orders; direct cost ↔ PO link.
 * - lib/po-cash.js: one rule for the job Cash Flow tab and the Owner cash outlook — each PO
 *   by its OWN payment_type (reimbursement = NV pays, counted; anything else = owner check,
 *   disclosed); only issued/received; approved linked direct costs reduce the remaining
 *   amount (credits add back), floored at $0.
 * - lib/cash-outlook poItems: reimbursement PO estimate is reduced by linked approved costs.
 * - POST /api/direct-costs and dc-review edit: purchase_order_id must be a PO on the same job;
 *   before migration 067 the write is retried without it.
 * - Page / migration source checks (no React mount).
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({
  Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } },
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})

const {
  isOwnerCheckPO, isOpenPO, linkedDcSignedAmount, poRemainingAmount, poCashOutByMonth,
  summarizeOwnerCheckPOs, normalizePoId, poLinkError, isMissingPoLinkColumn,
} = require('../lib/po-cash')
const { poItems } = require('../lib/cash-outlook')
const directCosts = require('../app/api/direct-costs/route')
const review = require('../app/api/dc-review/route')

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const postDc = body => directCosts.POST(req('/api/direct-costs', 'POST', body))
const putDc = body => directCosts.PUT(req('/api/direct-costs', 'PUT', body))
const edit = body => review.POST(req('/api/dc-review', 'POST', { action: 'edit', ...body }))
const dcInserts = () => mockState.calls.filter(c => c.table === 'direct_costs' && c.op === 'insert')
const dc = id => mockState.db.direct_costs.find(r => r.id === id)

// ── lib/po-cash.js ───────────────────────────────────────────────────────────
describe('lib/po-cash.js', () => {
  test('owner check vs reimbursement: each PO by its own payment_type', () => {
    expect(isOwnerCheckPO({ payment_type: 'check' })).toBe(true)
    expect(isOwnerCheckPO({ payment_type: null })).toBe(true)
    expect(isOwnerCheckPO({})).toBe(true)
    expect(isOwnerCheckPO({ payment_type: 'other' })).toBe(true)
    expect(isOwnerCheckPO({ payment_type: 'reimbursement' })).toBe(false)
  })

  test('only issued / received are open', () => {
    expect(['draft', 'issued', 'received', 'closed', undefined].map(status => isOpenPO({ status }))).toEqual([false, true, true, false, false])
  })

  test('linked DC signed amount: approved only, credits subtract', () => {
    expect(linkedDcSignedAmount({ status: 'approved', amount: 100 })).toBe(100)
    expect(linkedDcSignedAmount({ status: 'approved', amount: 40, is_credit: true })).toBe(-40)
    expect(linkedDcSignedAmount({ status: 'pending', amount: 100 })).toBe(0)
    expect(linkedDcSignedAmount({ status: 'rejected', amount: 100 })).toBe(0)
  })

  test('remaining: multiple linked DCs, credits add back, non-approved ignored, floors at 0', () => {
    const po = { id: 'P', amount: 1000 }
    expect(poRemainingAmount(po)).toBe(1000)
    expect(poRemainingAmount(po, [{ status: 'approved', amount: 300 }, { status: 'approved', amount: 200.555 }])).toBe(499.45)
    expect(poRemainingAmount(po, [{ status: 'approved', amount: 600 }, { status: 'approved', amount: 100, is_credit: true }])).toBe(500)
    expect(poRemainingAmount(po, [{ status: 'pending', amount: 600 }, { status: 'rejected', amount: 400 }])).toBe(1000)
    expect(poRemainingAmount(po, [{ status: 'approved', amount: 1500 }])).toBe(0)
    expect(poRemainingAmount({ amount: 'junk' })).toBe(0)
  })

  test('poCashOutByMonth: open reimbursement POs by issued month, less linked approved DCs', () => {
    const pos = [
      { id: 'a', status: 'issued', payment_type: 'reimbursement', amount: 1000, issued_date: '2026-10-05' },
      { id: 'b', status: 'received', payment_type: 'reimbursement', amount: 250, issued_date: '2026-10-20' },
      { id: 'c', status: 'issued', payment_type: 'reimbursement', amount: 400, issued_date: '2026-11-01' },
      { id: 'd', status: 'draft', payment_type: 'reimbursement', amount: 999, issued_date: '2026-11-01' },
      { id: 'e', status: 'closed', payment_type: 'reimbursement', amount: 999, issued_date: '2026-11-01' },
      { id: 'f', status: 'issued', payment_type: 'check', amount: 777, issued_date: '2026-11-01' },
      { id: 'g', status: 'issued', payment_type: 'reimbursement', amount: 50, issued_date: null },
      { id: 'h', status: 'issued', payment_type: 'reimbursement', amount: 300, issued_date: '2026-12-01' },
    ]
    const dcs = [
      { id: 'x1', purchase_order_id: 'a', status: 'approved', amount: 400 },
      { id: 'x2', purchase_order_id: 'a', status: 'pending', amount: 600 },
      { id: 'x3', purchase_order_id: 'h', status: 'approved', amount: 300 },
      { id: 'x4', status: 'approved', amount: 5000 },
    ]
    expect(poCashOutByMonth(pos, dcs)).toEqual({ '2026-10': 850, '2026-11': 400, unknown: 50 })
    expect(poCashOutByMonth([], dcs)).toEqual({})
    // all live POs are 'check' today → $0 counted
    expect(poCashOutByMonth([{ id: 'k', status: 'issued', payment_type: 'check', amount: 5, issued_date: '2026-11-01' }], [])).toEqual({})
  })

  test('summarizeOwnerCheckPOs: open owner-check POs at full amount (not reduced)', () => {
    expect(summarizeOwnerCheckPOs([
      { status: 'issued', payment_type: 'check', amount: 100.1 },
      { status: 'received', payment_type: null, amount: 50.2 },
      { status: 'closed', payment_type: 'check', amount: 999 },
      { status: 'issued', payment_type: 'reimbursement', amount: 999 },
    ])).toEqual({ count: 2, total: 150.3 })
    expect(summarizeOwnerCheckPOs([])).toEqual({ count: 0, total: 0 })
  })

  test('link shape checks', () => {
    expect(normalizePoId('')).toBeNull()
    expect(normalizePoId('  ')).toBeNull()
    expect(normalizePoId(undefined)).toBeNull()
    expect(normalizePoId(' P1 ')).toBe('P1')
    expect(poLinkError(null, 'J1')).toMatchObject({ status: 400 })
    expect(poLinkError({ id: 'P', job_id: 'J2' }, 'J1')).toMatchObject({ status: 400 })
    expect(poLinkError({ id: 'P', job_id: 'J1' }, 'J1')).toBeNull()
    expect(isMissingPoLinkColumn({ code: 'PGRST204', message: "Could not find the 'purchase_order_id' column of 'direct_costs' in the schema cache" })).toBe(true)
    expect(isMissingPoLinkColumn({ code: '42703', message: 'column direct_costs.purchase_order_id does not exist' })).toBe(true)
    expect(isMissingPoLinkColumn({ code: 'PGRST204', message: "Could not find the 'vendor' column" })).toBe(false)
    expect(isMissingPoLinkColumn(null)).toBe(false)
  })
})

// ── lib/cash-outlook poItems ─────────────────────────────────────────────────
describe('cash-outlook poItems with linked direct costs', () => {
  const jobs = { J: { id: 'J', job_number: '1', project_name: 'A' } }
  const po = (over = {}) => ({ id: 'R', job_id: 'J', status: 'issued', amount: 1000, issued_date: '2026-11-01', payment_type: 'reimbursement', ...over })

  test('reimbursement PO $1000 with linked approved DC $400 → $600 item', () => {
    const r = poItems({ jobsById: jobs, pos: [po()], directCosts: [{ id: 'd', purchase_order_id: 'R', status: 'approved', amount: 400 }] })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ amount: 600, date: '2026-12-01', category: 'po' })
  })

  test('fully paid down by linked DCs → omitted', () => {
    const r = poItems({ jobsById: jobs, pos: [po()], directCosts: [{ id: 'd', purchase_order_id: 'R', status: 'approved', amount: 1000 }] })
    expect(r.items).toHaveLength(0)
  })

  test('pending linked DC does not reduce; no directCosts arg keeps full amount', () => {
    expect(poItems({ jobsById: jobs, pos: [po()], directCosts: [{ purchase_order_id: 'R', status: 'pending', amount: 400 }] }).items[0].amount).toBe(1000)
    expect(poItems({ jobsById: jobs, pos: [po()] }).items[0].amount).toBe(1000)
  })

  test('check PO stays in ownerCheck at full amount; draft / closed ignored', () => {
    const r = poItems({ jobsById: jobs, pos: [
      po({ id: 'K', payment_type: 'check', amount: 500 }),
      po({ id: 'D', status: 'draft' }),
      po({ id: 'C', status: 'closed' }),
    ], directCosts: [{ purchase_order_id: 'K', status: 'approved', amount: 200 }] })
    expect(r.items).toHaveLength(0)
    expect(r.ownerCheck).toEqual({ total: 500, count: 1 })
  })
})

// ── POST /api/direct-costs ───────────────────────────────────────────────────
function seed() {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', pm_email: null }, { id: 'J2', job_number: '202', project_name: 'Elm', pm_email: null }],
    pm_job_assignments: [],
    profiles: [],
    budget_items: [{ id: 'L1', job_id: 'J1' }, { id: 'X1', job_id: 'J2' }],
    purchase_orders: [
      { id: 'PO1', job_id: 'J1', po_number: 'PO-101-001', status: 'issued', payment_type: 'reimbursement', amount: 1000 },
      { id: 'PO1c', job_id: 'J1', po_number: 'PO-101-002', status: 'closed', payment_type: 'check', amount: 50 },
      { id: 'PO2', job_id: 'J2', po_number: 'PO-202-001', status: 'issued', payment_type: 'reimbursement', amount: 500 },
    ],
    owner_reimb_invoice_lines: [],
    direct_costs: [
      { id: 'appr', job_id: 'J1', status: 'approved', amount: 200, budget_item_id: 'L1', description: 'Lumber', draw_request_id: null, drawn_application_id: null, purchase_order_id: null },
      { id: 'linked', job_id: 'J1', status: 'approved', amount: 300, budget_item_id: null, description: 'Survey', draw_request_id: null, drawn_application_id: null, purchase_order_id: 'PO1' },
    ],
  })
  mockState.auth = { userId: 'own1', role: 'principal', error: null }
}

const newCost = (over = {}) => ({ job_id: 'J1', submitted_by: 'own1', cost_date: '2026-11-09', description: '360 Survey', category: 'Materials', amount: 1500, status: 'approved', ...over })

describe('POST /api/direct-costs purchase_order_id', () => {
  beforeEach(seed)

  test('PO on another job → 400, nothing inserted', async () => {
    const res = await postDc(newCost({ purchase_order_id: 'PO2' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/different job/)
    expect(dcInserts()).toHaveLength(0)
  })

  test('unknown PO → 400, nothing inserted', async () => {
    const res = await postDc(newCost({ purchase_order_id: 'nope' }))
    expect(res.status).toBe(400)
    expect(dcInserts()).toHaveLength(0)
  })

  test('same-job PO → inserted with the link (closed / check PO may be linked too)', async () => {
    expect((await postDc(newCost({ purchase_order_id: 'PO1' }))).status).toBe(200)
    expect((await postDc(newCost({ purchase_order_id: 'PO1c' }))).status).toBe(200)
    expect(dcInserts().map(c => c.payload.purchase_order_id)).toEqual(['PO1', 'PO1c'])
  })

  test("'' → null link", async () => {
    expect((await postDc(newCost({ purchase_order_id: '' }))).status).toBe(200)
    expect(dcInserts()[0].payload.purchase_order_id).toBeNull()
  })

  test('bulk insert: a wrong-job PO in any row → 400, nothing inserted', async () => {
    const res = await postDc([newCost(), newCost({ purchase_order_id: 'PO2' })])
    expect(res.status).toBe(400)
    expect(dcInserts()).toHaveLength(0)
  })

  test('before migration 067: insert succeeds without the key (other fields kept)', async () => {
    mockState.missingCols = { direct_costs: ['purchase_order_id'] }
    const res = await postDc(newCost({ purchase_order_id: 'PO1', is_credit: false }))
    expect(res.status).toBe(200)
    expect(dcInserts()).toHaveLength(1)
    expect(dcInserts()[0].payload).not.toHaveProperty('purchase_order_id')
    expect(dcInserts()[0].payload).toMatchObject({ description: '360 Survey', amount: 1500, is_credit: false })
  })

  test('no purchase_order_id: unchanged insert, no PO lookup', async () => {
    expect((await postDc(newCost())).status).toBe(200)
    expect(dcInserts()[0].payload).not.toHaveProperty('purchase_order_id')
  })
})

describe('PUT /api/direct-costs job move clears the PO link', () => {
  beforeEach(seed)

  test('moving a linked cost to another job drops the old-job PO link', async () => {
    const res = await putDc({ id: 'linked', job_id: 'J2' })
    expect(res.status).toBe(200)
    expect(dc('linked')).toMatchObject({ job_id: 'J2', purchase_order_id: null })
  })

  test('before 067 the move still succeeds', async () => {
    mockState.missingCols = { direct_costs: ['purchase_order_id'] }
    const res = await putDc({ id: 'appr', job_id: 'J2', budget_item_id: null })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(dc('appr').job_id).toBe('J2')
  })
})

// ── dc-review edit ───────────────────────────────────────────────────────────
describe('dc-review edit purchase_order_id', () => {
  beforeEach(seed)

  test('set a same-job PO', async () => {
    const res = await edit({ id: 'appr', purchase_order_id: 'PO1' })
    expect(res.status).toBe(200)
    expect(dc('appr').purchase_order_id).toBe('PO1')
  })

  test("clear with '' or null", async () => {
    expect((await edit({ id: 'linked', purchase_order_id: '' })).status).toBe(200)
    expect(dc('linked').purchase_order_id).toBeNull()
    dc('linked').purchase_order_id = 'PO1'
    expect((await edit({ id: 'linked', purchase_order_id: null })).status).toBe(200)
    expect(dc('linked').purchase_order_id).toBeNull()
  })

  test('wrong-job PO → 400, nothing written', async () => {
    const res = await edit({ id: 'appr', purchase_order_id: 'PO2', description: 'changed' })
    expect(res.status).toBe(400)
    expect(dc('appr')).toMatchObject({ purchase_order_id: null, description: 'Lumber' })
    expect(mockState.calls.filter(c => c.table === 'direct_costs' && c.op === 'update')).toHaveLength(0)
  })

  test('edit without purchase_order_id leaves the link alone', async () => {
    expect((await edit({ id: 'linked', description: 'Survey (final)' })).status).toBe(200)
    expect(dc('linked')).toMatchObject({ purchase_order_id: 'PO1', description: 'Survey (final)' })
  })

  test('before 067: other fields still save, response says the link was not saved', async () => {
    mockState.missingCols = { direct_costs: ['purchase_order_id'] }
    const res = await edit({ id: 'appr', purchase_order_id: 'PO1', description: 'Lumber 2x4' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, po_link_saved: false })
    expect(dc('appr').description).toBe('Lumber 2x4')
  })
})

// ── Page / migration source checks ──────────────────────────────────────────
describe('page wiring and migration 067', () => {
  const page = read('app/jobdetail/page.js')

  test('cashflow tab loads purchase orders', () => {
    expect(page).toMatch(/if \(activeTab === 'cashflow'\) \{[^}]*loadPurchaseOrders\(\)[^}]*\}/)
  })

  test('cashflow IIFE uses the shared PO rule and shows "POs out"', () => {
    const start = page.indexOf("{activeTab === 'cashflow' && (() => {")
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 12000)
    expect(block).toMatch(/poCashOutByMonth\(purchaseOrders, directCosts\)/)
    expect(block).toMatch(/summarizeOwnerCheckPOs\(purchaseOrders\)/)
    expect(block).toMatch(/totalOut = totalSubPay \+ totalDC \+ totalPOs/)
    expect(block).toMatch(/'Direct costs', 'POs out', 'Total out'/)
    expect(block).toMatch(/owner-check PO/)
    expect(block).not.toMatch(/PO_PAY_DAYS/)
  })

  test('DC create form and review form carry purchase_order_id', () => {
    expect(page).toMatch(/purchase_order_id: dcForm\.purchase_order_id/)
    expect(page).toMatch(/Purchase order \(optional\)/)
    expect(page).toMatch(/setReviewForm\(f => \(\{ \.\.\.f, purchase_order_id: e\.target\.value \}\)\)/)
  })

  test('cash-outlook route passes linked direct costs to poItems', () => {
    const route = read('app/api/cash-outlook/route.js')
    expect(route).toMatch(/hasColumn\('direct_costs', 'purchase_order_id'\)/)
    expect(route).toMatch(/poItems\(\{ jobsById, pos: posRes\.data, directCosts: linkedDcs \}\)/)
  })

  test('migration 067 is idempotent, FK ON DELETE SET NULL, has rollback', () => {
    const sql = read('migrations/067_direct_cost_po_link.sql')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS purchase_order_id uuid/)
    expect(sql).toMatch(/REFERENCES public\.purchase_orders\(id\) ON DELETE SET NULL/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS direct_costs_purchase_order_id_idx/)
    expect(sql).toMatch(/-- ROLLBACK/)
    expect(sql).toMatch(/-- ALTER TABLE public\.direct_costs DROP COLUMN IF EXISTS purchase_order_id/)
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im)
  })
})
