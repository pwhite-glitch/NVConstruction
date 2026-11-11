/**
 * Prompt 78: business routes record direct uploads (path + signed receipt), never file bytes.
 *  - multipart refused (413) BEFORE request.formData(); inline / base64 / raw-path bypasses refused
 *  - verified attachments write the same old column shapes; no receipt / proof keys persisted
 *  - a missing Storage object → no business write
 *  - omission on update preserves the old file; submittal merge / remove / legacy string
 *  - super pending receipt rule; bulk imports unchanged; one receipt for one cost only
 *  - PO closed (also while the request runs), GC draw CAS, dc resubmit CAS, billing duplicate
 *    409 + confirm resend with the SAME upload
 *  - bot: legacy 413 JSON, signed flow 201 with one audit entry, no email
 *  - generated contract / AI parse limit / parse temp cleanup
 * In-memory DB, real receipts, mocked auth / email / AI. Nothing live.
 */
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
const mockBilling = { ctx: null }
jest.mock('../lib/sub-access', () => ({ ...jest.requireActual('../lib/sub-access'), billingContext: async () => mockBilling.ctx }))
jest.mock('resend', () => ({ Resend: function Resend() { this.emails = { send: async m => { require('./helpers/mock-db').mockState.calls.push({ table: 'email', op: 'send', payload: m }); return { data: { id: 'e' }, error: null } } } } }))
jest.mock('../lib/change-log', () => ({ logChange: jest.fn(async () => null) }))
const mockBot = { result: null }
jest.mock('../lib/bot-auth', () => ({ requireBotKey: async () => mockBot.result }))

const { mintUpload } = require('./helpers/upload-receipt')
const directCosts = require('../app/api/direct-costs/route')
const submittals = require('../app/api/submittals/route')
const po = require('../app/api/purchase-orders/route')
const gc = require('../app/api/general-conditions/route')
const dcReview = require('../app/api/dc-review/route')
const billing = require('../app/api/billing-entry/route')
const vehicleLogs = require('../app/api/vehicle-logs/route')
const botAttach = require('../app/api/bot/v1/attachments/route')
const contract = require('../app/api/subcontract-contract/route')
const parse = require('../app/api/parse-estimate/route')
const { saveGeneratedContract } = require('../lib/generated-contract')
const { logChange } = require('../lib/change-log')

const J1 = 'job-1', J2 = 'job-2'
const SC = '55555555-5555-4555-8555-555555555555'
const req = (url, method, body, headers = {}) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const out = async r => ({ status: r.status, body: await r.json() })
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null } }
const writes = table => mockState.calls.filter(c => c.table === table && ['insert', 'update', 'delete'].includes(c.op))
const byteUploads = () => mockState.calls.filter(c => c.op === 'upload')
const up = (target, ctx, extra = {}) => mintUpload({ target, subject: mockState.auth.userId, ctx, store: mockState, ...extra })

// A multipart request whose formData() must never be called.
function multipart(url, method = 'POST') {
  const fd = new FormData()
  fd.append('file', new File(['%PDF-1.4 big'], 'r.pdf', { type: 'application/pdf' }))
  fd.append('data', JSON.stringify({ job_id: J1 }))
  const r = new Request(`http://x${url}`, { method, body: fd })
  r.formData = jest.fn(() => { throw new Error('formData() must not be called') })
  return r
}

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, job_number: '101', project_name: 'Main' }, { id: J2, job_number: '202', project_name: 'Elm' }],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-super' }, { id: 'a2', job_id: J1, user_id: 'u-apm' }],
    direct_costs: [
      { id: 'dc-rej', job_id: J1, status: 'rejected', submitted_by: 'u-super', receipt_url: `${J1}/111.jpg`, amount: 5, draw_request_id: null, drawn_application_id: null },
      { id: 'dc-rej2', job_id: J1, status: 'rejected', submitted_by: 'u-super', receipt_url: null, amount: 7, draw_request_id: null, drawn_application_id: null },
    ],
    submittals: [
      { id: 'sub-1', job_id: J1, number: 1, title: 'A', file_url: `${J1}/legacy_old.pdf` },
      { id: 'sub-2', job_id: J2, number: 1, title: 'B', file_url: null },
    ],
    purchase_orders: [
      { id: 'po1', job_id: J1, po_number: 'PO-101-001', status: 'issued', vendor_name: 'Acme', attachment_url: `${J1}/old.pdf`, amount: 10 },
      { id: 'po-closed', job_id: J1, po_number: 'PO-101-002', status: 'closed', vendor_name: 'Acme', attachment_url: null, amount: 10 },
    ],
    purchase_order_items: [],
    general_conditions: [{ id: 'gc-1', job_id: J1, description: 'Dumpster', amount: 100, draw_request_id: null, doc_url: `${J1}/old.pdf` }],
    billing_submissions: [
      { id: 'b-old', job_id: J1, sub_id: null, company_name: 'Acme Electric', invoice_number: 'INV-1', status: 'pending', amount_billed: 100, doc_url: `${J1}/inv.pdf`, draw_request_id: null, submitted_at: '2026-11-01T12:00:00Z' },
    ],
    vehicles: [{ id: 'veh-1' }],
    vehicle_logs: [],
    subcontracts: [{ id: SC, job_id: J1, status: 'active' }],
    job_documents: [],
    profiles: [],
    change_log: [],
  })
  mockBilling.ctx = null
  logChange.mockClear()
})

// ── direct costs ────────────────────────────────────────────────────────────
describe('/api/direct-costs POST', () => {
  test('multipart is refused with JSON 413 before formData(); nothing written', async () => {
    as('principal')
    const r = multipart('/api/direct-costs')
    const res = await out(await directCosts.POST(r))
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('direct_upload_required')
    expect(r.formData).not.toHaveBeenCalled()
    expect(writes('direct_costs')).toEqual([])
  })

  test('verified receipt → receipt_url is the raw path; no bytes through the route; no proof stored', async () => {
    as('super')
    const u = await up('direct-cost-receipt', { job: J1 }, { size: 12 * 1024 * 1024, name: 'IMG_0001.HEIC', contentType: 'image/heic' })
    const res = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'Lumber', amount: 50, status: 'pending', attachment: u.attachment })))
    expect(res).toEqual({ status: 200, body: { ok: true } })
    const row = mockState.db.direct_costs.find(c => c.description === 'Lumber')
    expect(row.receipt_url).toBe(u.path)
    expect(u.path).toMatch(/_IMG_0001\.HEIC$/) // true extension kept, not forced to .jpg
    expect(row).not.toHaveProperty('attachment')
    expect(JSON.stringify(row)).not.toContain('uploadReceipt')
    expect(byteUploads()).toEqual([])
  })

  test('missing Storage object → 422 upload_missing, no insert', async () => {
    as('super')
    const u = await mintUpload({ target: 'direct-cost-receipt', subject: 'u-super', ctx: { job: J1 } })
    const res = await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, status: 'pending', attachment: u.attachment })))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('upload_missing')
    expect(writes('direct_costs')).toEqual([])
  })

  test('super pending without a VERIFIED receipt is refused (booleans / raw receipt_url do not count)', async () => {
    as('super')
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, status: 'pending', fileAttached: true }))).status).toBe(400)
    expect((await out(await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, status: 'pending', receipt_url: `${J1}/someone-else.pdf` })))).body.error).toMatch(/receipt_url cannot be set directly/)
    expect(writes('direct_costs')).toEqual([])
  })

  test('raw receipt_url on an imported row and base64 / data URLs are refused', async () => {
    as('principal')
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', [{ job_id: J1, description: 'A', amount: 1 }, { job_id: J1, description: 'B', amount: 2, receipt_url: `${J2}/x.pdf` }]))).status).toBe(400)
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'A', amount: 1, receipt: 'data:application/pdf;base64,JVBERi0=' }))).status).toBe(400)
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'A', amount: 1, file: 'JVBERi0x' }))).status).toBe(400)
    expect(writes('direct_costs')).toEqual([])
  })

  test('bulk without receipts unchanged; one receipt only for a single cost / one-row array', async () => {
    as('principal')
    expect((await out(await directCosts.POST(req('/api/direct-costs', 'POST', [{ job_id: J1, description: 'A', amount: 1 }, { job_id: J1, description: 'B', amount: 2 }])))).status).toBe(200)
    expect(mockState.db.direct_costs.filter(c => ['A', 'B'].includes(c.description)).every(c => c.receipt_url === undefined)).toBe(true)
    const u = await up('direct-cost-receipt', { job: J1 })
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', [{ job_id: J1, description: 'C', amount: 1, attachment: u.attachment }, { job_id: J1, description: 'D', amount: 1 }]))).status).toBe(400)
    expect((await out(await directCosts.POST(req('/api/direct-costs', 'POST', [{ job_id: J1, description: 'E', amount: 1, attachment: u.attachment }])))).status).toBe(200)
    expect(mockState.db.direct_costs.find(c => c.description === 'E').receipt_url).toBe(u.path)
  })

  test('a receipt for another job, another user or another target is refused', async () => {
    as('principal')
    const other = await up('direct-cost-receipt', { job: J2 })
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, attachment: other.attachment }))).status).toBe(422)
    const gcReceipt = await up('gc-doc', { job: J1 })
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, attachment: gcReceipt.attachment }))).status).toBe(422)
    const mine = await up('direct-cost-receipt', { job: J1 })
    as('admin')
    expect((await directCosts.POST(req('/api/direct-costs', 'POST', { job_id: J1, description: 'X', amount: 1, attachment: mine.attachment }))).status).toBe(422)
    expect(writes('direct_costs')).toEqual([])
  })
})

// ── submittals ──────────────────────────────────────────────────────────────
describe('/api/submittals', () => {
  test('POST: attachments stored as [{path,name}] JSON; multipart refused early', async () => {
    as('apm')
    const a = await up('submittal-doc', { job: J1 }, { name: 'Shop Drawing A.pdf' })
    const b = await up('submittal-doc', { job: J1 }, { name: 'Spec B.pdf' })
    const res = await out(await submittals.POST(req('/api/submittals', 'POST', { job_id: J1, title: 'Doors', attachments: [a.attachment, b.attachment] })))
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body.submittal.file_url)).toEqual([{ path: a.path, name: 'Shop Drawing A.pdf' }, { path: b.path, name: 'Spec B.pdf' }])
    expect(res.body.submittal.file_url).not.toContain('uploadReceipt')
    const r = multipart('/api/submittals')
    expect((await submittals.POST(r)).status).toBe(413)
    expect(r.formData).not.toHaveBeenCalled()
  })

  test('PATCH: merges with a legacy string, removes, keeps files when none are sent', async () => {
    as('apm')
    const a = await up('submittal-doc', { job: J1, rec: 'sub-1' }, { name: 'Rev2.pdf' })
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', attachments: [a.attachment] }))).status).toBe(200)
    expect(JSON.parse(mockState.db.submittals[0].file_url)).toEqual([{ path: `${J1}/legacy_old.pdf`, name: 'legacy_old.pdf' }, { path: a.path, name: 'Rev2.pdf' }])
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', notes: 'n' }))).status).toBe(200)
    expect(JSON.parse(mockState.db.submittals[0].file_url)).toHaveLength(2)
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', remove_file_path: `${J1}/legacy_old.pdf` }))).status).toBe(200)
    expect(JSON.parse(mockState.db.submittals[0].file_url)).toEqual([{ path: a.path, name: 'Rev2.pdf' }])
  })

  test('PATCH: inconsistent job_id refused; a create receipt or another submittal’s receipt refused; empty object refused', async () => {
    as('principal')
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', job_id: J2, notes: 'x' }))).status).toBe(400)
    const createReceipt = await up('submittal-doc', { job: J1 })
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', attachments: [createReceipt.attachment] }))).status).toBe(422)
    const otherRec = await up('submittal-doc', { job: J2, rec: 'sub-2' })
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', attachments: [otherRec.attachment] }))).status).toBe(422)
    const empty = await mintUpload({ target: 'submittal-doc', subject: 'u-principal', ctx: { job: J1, rec: 'sub-1' } })
    mockState.fileMeta[`submittal-docs/${empty.path}`] = { size: 0, contentType: 'application/pdf' }
    expect((await submittals.PATCH(req('/api/submittals', 'PATCH', { id: 'sub-1', attachments: [empty.attachment] }))).status).toBe(422)
    expect(mockState.db.submittals[0].file_url).toBe(`${J1}/legacy_old.pdf`)
  })
})

// ── purchase orders ─────────────────────────────────────────────────────────
describe('/api/purchase-orders', () => {
  test('POST with attachment: raw path saved, line items + payment_type warning kept', async () => {
    as('super')
    mockState.missingCols = { purchase_orders: ['payment_type'] }
    const u = await up('po-attachment', { job: J1 })
    const res = await out(await po.POST(req('/api/purchase-orders', 'POST', { job_id: J1, vendor_name: 'Lumber Co', payment_type: 'check', items: [{ description: '2x4', qty: 10, unit_price: 3 }], attachment: u.attachment })))
    expect(res.status).toBe(200)
    expect(res.body.warning).toBeTruthy()
    expect(res.body.purchase_order.attachment_url).toBe(u.path)
    expect(mockState.db.purchase_order_items.filter(i => i.po_id === res.body.purchase_order.id)).toHaveLength(1)
  })

  test('PUT without attachment keeps the saved file; with one replaces it', async () => {
    as('principal')
    expect((await po.PUT(req('/api/purchase-orders', 'PUT', { id: 'po1', notes: 'x' }))).status).toBe(200)
    expect(mockState.db.purchase_orders[0].attachment_url).toBe(`${J1}/old.pdf`)
    const u = await up('po-attachment', { job: J1, rec: 'po1' })
    expect((await po.PUT(req('/api/purchase-orders', 'PUT', { id: 'po1', attachment: u.attachment }))).status).toBe(200)
    expect(mockState.db.purchase_orders[0].attachment_url).toBe(u.path)
  })

  test('PO closed after the upload was issued (or while the request runs) stays locked', async () => {
    as('principal')
    const u = await up('po-attachment', { job: J1, rec: 'po1' })
    mockState.db.purchase_orders[0].status = 'closed'
    expect((await out(await po.PUT(req('/api/purchase-orders', 'PUT', { id: 'po1', attachment: u.attachment })))).status).toBe(409)
    mockState.db.purchase_orders[0].status = 'issued'
    mockState.beforeWrite = (table, op) => { if (table === 'purchase_orders' && op === 'update') mockState.db.purchase_orders[0].status = 'closed' }
    const res = await out(await po.PUT(req('/api/purchase-orders', 'PUT', { id: 'po1', attachment: u.attachment })))
    expect(res.status).toBe(409)
    expect(mockState.db.purchase_orders[0].attachment_url).toBe(`${J1}/old.pdf`)
  })
})

// ── general conditions ──────────────────────────────────────────────────────
describe('/api/general-conditions', () => {
  test('PUT: put on a draw while saving → 409, attachment not saved (CAS kept)', async () => {
    as('principal')
    const u = await up('gc-doc', { job: J1, rec: 'gc-1' })
    mockState.beforeWrite = (table, op) => { if (table === 'general_conditions' && op === 'update') mockState.db.general_conditions[0].draw_request_id = 'dr-new' }
    const res = await out(await gc.PUT(req('/api/general-conditions', 'PUT', { id: 'gc-1', attachment: u.attachment })))
    expect(res.status).toBe(409)
    expect(mockState.db.general_conditions[0].doc_url).toBe(`${J1}/old.pdf`)
  })
  test('POST: doc_url from the verified receipt; omitted attachment → null', async () => {
    as('principal')
    const u = await up('gc-doc', { job: J1 })
    const a = await out(await gc.POST(req('/api/general-conditions', 'POST', { job_id: J1, description: 'Trailer', amount: 50, attachment: u.attachment })))
    expect(a.body.entry.doc_url).toBe(u.path)
    const b = await out(await gc.POST(req('/api/general-conditions', 'POST', { job_id: J1, description: 'Fuel', amount: 5 })))
    expect(b.body.entry.doc_url).toBeNull()
  })
})

// ── dc-review resubmit ──────────────────────────────────────────────────────
describe('/api/dc-review resubmit', () => {
  test('new receipt for THIS cost replaces receipt_url; none keeps it', async () => {
    as('super')
    const u = await up('dc-resubmit-receipt', { job: J1, rec: 'dc-rej' })
    expect((await dcReview.POST(req('/api/dc-review', 'POST', { action: 'resubmit', id: 'dc-rej', amount: 6, attachment: u.attachment }))).status).toBe(200)
    expect(mockState.db.direct_costs[0]).toMatchObject({ status: 'pending', receipt_url: u.path })
    expect((await dcReview.POST(req('/api/dc-review', 'POST', { action: 'resubmit', id: 'dc-rej2', amount: 8 }))).status).toBe(200)
    expect(mockState.db.direct_costs[1].receipt_url).toBeNull()
  })
  test('receipt for another cost, attachment on other actions, multipart → refused', async () => {
    as('super')
    const other = await up('dc-resubmit-receipt', { job: J1, rec: 'dc-rej2' })
    expect((await dcReview.POST(req('/api/dc-review', 'POST', { action: 'resubmit', id: 'dc-rej', attachment: other.attachment }))).status).toBe(422)
    as('principal')
    expect((await dcReview.POST(req('/api/dc-review', 'POST', { action: 'edit', id: 'dc-rej', attachment: other.attachment }))).status).toBe(400)
    const r = multipart('/api/dc-review')
    expect((await dcReview.POST(r)).status).toBe(413)
    expect(r.formData).not.toHaveBeenCalled()
    expect(mockState.db.direct_costs[0].status).toBe('rejected')
  })
  test('stale (status changed under us) → 409, nothing saved', async () => {
    as('super')
    const u = await up('dc-resubmit-receipt', { job: J1, rec: 'dc-rej' })
    mockState.beforeWrite = (table, op) => { if (table === 'direct_costs' && op === 'update') mockState.db.direct_costs[0].status = 'approved' }
    expect((await dcReview.POST(req('/api/dc-review', 'POST', { action: 'resubmit', id: 'dc-rej', attachment: u.attachment }))).status).toBe(409)
    expect(mockState.db.direct_costs[0].receipt_url).toBe(`${J1}/111.jpg`)
  })
})

// ── billing entry ───────────────────────────────────────────────────────────
describe('/api/billing-entry', () => {
  test('duplicate 409 keeps needs_confirm + duplicate; confirm resend with the SAME upload saves it', async () => {
    as('principal')
    const u = await up('billing-doc', { job: J1 })
    const body = { job_id: J1, company_name: 'Acme Electric', invoice_number: 'inv-1', amount_billed: 50, attachment: u.attachment }
    const first = await out(await billing.POST(req('/api/billing-entry', 'POST', body)))
    expect(first.status).toBe(409)
    expect(first.body).toMatchObject({ needs_confirm: true, duplicate: { id: 'b-old', invoice_number: 'INV-1' } })
    expect(writes('billing_submissions')).toEqual([])
    const again = await out(await billing.POST(req('/api/billing-entry', 'POST', { ...body, confirm_duplicate: true })))
    expect(again.status).toBe(200)
    const row = mockState.db.billing_submissions.find(b => b.id !== 'b-old')
    expect(row.doc_url).toBe(u.path)
    expect(row).not.toHaveProperty('attachment')
    expect(row).not.toHaveProperty('confirm_duplicate')
  })
  test('raw doc_url refused (POST); PATCH may resend the saved one; omission keeps the file', async () => {
    as('principal')
    expect((await billing.POST(req('/api/billing-entry', 'POST', { job_id: J1, company_name: 'X', amount_billed: 1, doc_url: `${J2}/steal.pdf` }))).status).toBe(400)
    expect((await billing.PATCH(req('/api/billing-entry', 'PATCH', { id: 'b-old', doc_url: `${J2}/steal.pdf` }))).status).toBe(400)
    expect((await billing.PATCH(req('/api/billing-entry', 'PATCH', { id: 'b-old', doc_url: `${J1}/inv.pdf`, notes: 'n' }))).status).toBe(200)
    expect(mockState.db.billing_submissions[0].doc_url).toBe(`${J1}/inv.pdf`)
    const u = await up('billing-doc', { job: J1, rec: 'b-old' })
    expect((await billing.PATCH(req('/api/billing-entry', 'PATCH', { id: 'b-old', attachment: u.attachment }))).status).toBe(200)
    expect(mockState.db.billing_submissions[0].doc_url).toBe(u.path)
  })
  test('sub POST with a file: billing context required at record time too', async () => {
    as('subcontractor', 'u-sub')
    const u = await up('billing-doc', { job: J1 })
    mockBilling.ctx = { job: { id: J1, can_bill: false }, contracts: [{ id: 'c' }] }
    expect((await billing.POST(req('/api/billing-entry', 'POST', { job_id: J1, amount_billed: 10, attachment: u.attachment }))).status).toBe(403)
    mockBilling.ctx = { job: { id: J1, can_bill: true }, contracts: [{ id: 'c' }] }
    expect((await billing.POST(req('/api/billing-entry', 'POST', { job_id: J1, amount_billed: 10, attachment: u.attachment }))).status).toBe(200)
    expect(mockState.db.billing_submissions.find(b => b.sub_id === 'u-sub')).toMatchObject({ status: 'pending', doc_url: u.path })
  })
  test('multipart refused before formData()', async () => {
    as('principal')
    const r = multipart('/api/billing-entry', 'PATCH')
    expect((await billing.PATCH(r)).status).toBe(413)
    expect(r.formData).not.toHaveBeenCalled()
  })
})

// ── vehicle logs ────────────────────────────────────────────────────────────
describe('/api/vehicle-logs', () => {
  test('photo via receipt bound to the vehicle; only log columns written; raw photo_url refused', async () => {
    as('super')
    const u = await up('vehicle-photo', { vehicle: 'veh-1' }, { name: 'odo.jpg', contentType: 'image/jpeg' })
    const res = await out(await vehicleLogs.POST(req('/api/vehicle-logs', 'POST', { vehicle_id: 'veh-1', log_type: 'Weekly Miles', mileage: 10, attachment: u.attachment, created_by: 'spoof', bogus: 1 })))
    expect(res.status).toBe(200)
    const row = mockState.db.vehicle_logs[0]
    expect(row.photo_url).toBe(u.path)
    expect(row).not.toHaveProperty('bogus')
    expect(row).not.toHaveProperty('created_by')
    expect(row).not.toHaveProperty('attachment')
    expect((await vehicleLogs.POST(req('/api/vehicle-logs', 'POST', { vehicle_id: 'veh-1', photo_url: 'veh-1/other.jpg' }))).status).toBe(400)
    // no-photo JSON (dashboard) still works
    expect((await vehicleLogs.POST(req('/api/vehicle-logs', 'POST', { vehicle_id: 'veh-1', log_type: 'Weekly Miles', mileage: 11 }))).status).toBe(200)
  })
  test('photo for another vehicle / unknown vehicle refused', async () => {
    as('super')
    const u = await up('vehicle-photo', { vehicle: 'veh-1' })
    expect((await vehicleLogs.POST(req('/api/vehicle-logs', 'POST', { vehicle_id: 'veh-9', attachment: u.attachment }))).status).toBe(404)
    mockState.db.vehicles.push({ id: 'veh-2' })
    expect((await vehicleLogs.POST(req('/api/vehicle-logs', 'POST', { vehicle_id: 'veh-2', attachment: u.attachment }))).status).toBe(422)
    expect(mockState.db.vehicle_logs).toEqual([])
  })
})

// ── bot attachments ─────────────────────────────────────────────────────────
describe('/api/bot/v1/attachments', () => {
  const botClient = () => require('./helpers/mock-db').supabaseModule.createClient()
  const botPost = (body, headers = {}) => botAttach.POST(new Request('http://x/api/bot/v1/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nvb_x', ...headers }, body: JSON.stringify(body) }))
  beforeEach(() => { mockBot.result = { bot: { id: 'bot-1', keyId: 'key-1' }, supabase: botClient(), error: null } })

  test('legacy multipart over 4 MB → JSON 413 pointing at the signed flow; nothing uploaded', async () => {
    const r = new Request('http://x/api/bot/v1/attachments', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(5 * 1024 * 1024) }, body: 'x' })
    const res = await out(await botAttach.POST(r))
    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/upload-url/)
    expect(byteUploads()).toEqual([])
  })
  test('signed flow: record-upload → 201, row inserted by the bot client, one audit entry, no email', async () => {
    const u = await mintUpload({ target: 'bot-attachment', subject: 'bot-1', keyId: 'key-1', ctx: { job: J1, cat: 'plans' }, name: 'Plans Rev 3.pdf', size: 48 * 1024 * 1024, store: mockState })
    const res = await out(await botPost({ action: 'record-upload', job_id: J1, category: 'plans', attachment: u.attachment }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ ok: true, storage_path: u.path })
    expect(mockState.db.job_documents).toEqual([expect.objectContaining({ job_id: J1, storage_path: u.path, category: 'plans', uploaded_by: 'bot-1', file_name: 'Plans Rev 3.pdf' })])
    expect(logChange).toHaveBeenCalledTimes(1)
    expect(mockState.calls.filter(c => c.table === 'email')).toEqual([])
  })
  test('another key, another category, or a missing object → refused, no row, no audit', async () => {
    const u = await mintUpload({ target: 'bot-attachment', subject: 'bot-1', keyId: 'key-OLD', ctx: { job: J1, cat: 'plans' }, store: mockState })
    expect((await botPost({ action: 'record-upload', job_id: J1, category: 'plans', attachment: u.attachment })).status).toBe(422)
    const u2 = await mintUpload({ target: 'bot-attachment', subject: 'bot-1', keyId: 'key-1', ctx: { job: J1, cat: 'plans' }, store: mockState })
    expect((await botPost({ action: 'record-upload', job_id: J1, category: 'specs', attachment: u2.attachment })).status).toBe(422)
    const u3 = await mintUpload({ target: 'bot-attachment', subject: 'bot-1', keyId: 'key-1', ctx: { job: J1, cat: 'plans' } })
    expect((await botPost({ action: 'record-upload', job_id: J1, category: 'plans', attachment: u3.attachment })).status).toBe(422)
    expect(mockState.db.job_documents).toEqual([])
    expect(logChange).not.toHaveBeenCalled()
  })
})

// ── generated contract ──────────────────────────────────────────────────────
describe('/api/subcontract-contract', () => {
  test('inline html → 413; verified upload recorded; recorded:false fallback kept', async () => {
    as('apm')
    expect((await contract.POST(req('/api/subcontract-contract', 'POST', { subcontract_id: SC, html: '<html>' + 'x'.repeat(1000) + '</html>' }))).status).toBe(413)
    const u = await up('generated-contract', { job: J1, rec: SC }, { name: 'contract.html', contentType: 'text/html' })
    const ok = await out(await contract.POST(req('/api/subcontract-contract', 'POST', { subcontract_id: SC, attachment: u.attachment })))
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ path: u.path, recorded: true })
    expect(mockState.db.subcontracts[0]).toMatchObject({ generated_contract_path: u.path, generated_by: 'u-apm' })
    mockState.missingCols = { subcontracts: ['generated_contract_path'] }
    const u2 = await up('generated-contract', { job: J1, rec: SC }, { name: 'contract.html', contentType: 'text/html' })
    const fb = await out(await contract.POST(req('/api/subcontract-contract', 'POST', { subcontract_id: SC, attachment: u2.attachment })))
    expect(fb.body.data).toMatchObject({ path: u2.path, recorded: false })
  })
  test('saveGeneratedContract (server-side generation) still uploads + records', async () => {
    const uploads = []
    const admin = { storage: { from: b => ({ upload: async (p, body) => { uploads.push([b, p]); return { error: null } } }) }, from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }
    const saved = await saveGeneratedContract(admin, { subcontractId: SC, html: '<p>x</p>', userId: 'u1', at: new Date('2026-11-11T00:00:00Z') })
    expect(saved).toMatchObject({ recorded: true, path: `subcontracts/${SC}/generated-2026-11-11T00-00-00-000Z.html` })
    expect(uploads).toEqual([['documents', saved.path]])
  })
})

// ── parse estimate ──────────────────────────────────────────────────────────
describe('/api/parse-estimate', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY })

  test('over the AI processing limit → 413 code ai_parse_limit (distinct from an upload failure); temp object removed', async () => {
    as('pm')
    const u = await up('parse-estimate', { user: 'u-pm' }, { size: 21 * 1024 * 1024 })
    const res = await out(await parse.POST(req('/api/parse-estimate', 'POST', { attachment: u.attachment })))
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'ai_parse_limit', error: 'This file uploaded, but AI estimate parsing supports up to 20 MB; use a smaller estimate or enter items manually.' })
    expect(mockState.calls.filter(c => c.op === 'remove').map(c => c.payload)).toEqual([[u.path]])
    const missing = await mintUpload({ target: 'parse-estimate', subject: 'u-pm', ctx: { user: 'u-pm' } })
    const m = await out(await parse.POST(req('/api/parse-estimate', 'POST', { attachment: missing.attachment })))
    expect(m).toMatchObject({ status: 422, body: { code: 'upload_missing' } })
  })
  test('another user’s staged estimate is refused (never read, never removed)', async () => {
    as('pm', 'u-pm2')
    const theirs = await mintUpload({ target: 'parse-estimate', subject: 'u-pm', ctx: { user: 'u-pm' }, store: mockState })
    expect((await parse.POST(req('/api/parse-estimate', 'POST', { attachment: theirs.attachment }))).status).toBe(422)
    expect(mockState.calls.filter(c => c.op === 'remove')).toEqual([])
  })
  test('success: bytes read server → Storage, AI called (mocked), items returned, temp removed', async () => {
    as('pm')
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const u = await mintUpload({ target: 'parse-estimate', subject: 'u-pm', ctx: { user: 'u-pm' }, size: 9 })
    mockState.files[`estimate-docs/${u.path}`] = Buffer.from('%PDF-1.4x')
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ content: [{ text: '[{"description":"Plans","amount":2000,"section":"Pre"}]' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const res = await out(await parse.POST(req('/api/parse-estimate', 'POST', { attachment: u.attachment })))
    expect(res).toEqual({ status: 200, body: { items: [{ description: 'Plans', amount: 2000, section: 'Pre' }] } })
    expect(mockState.files[`estimate-docs/${u.path}`]).toBeUndefined()
  })
  test('multipart refused before formData()', async () => {
    as('pm')
    const r = multipart('/api/parse-estimate')
    expect((await parse.POST(r)).status).toBe(413)
    expect(r.formData).not.toHaveBeenCalled()
  })
})
