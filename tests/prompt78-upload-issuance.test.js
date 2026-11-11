/**
 * Prompt 78: POST /api/file-upload issuance guards (real route + real lib/roles over the
 * in-memory DB) and the bot JSON upload-url flow. A refused request never asks Storage for an
 * upload URL. Existing rows decide the job (a forged job_id loses). Sub billing uses the
 * billing context (mocked here; its own rules are covered by sub-access tests).
 * Nothing live: mock-db, mocked auth and bot auth.
 */
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requireAuth: async () => mockState.auth || { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    requirePM: async () => (!mockState.auth ? { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
const mockBilling = { ctx: null }
jest.mock('../lib/sub-access', () => ({ billingContext: async () => mockBilling.ctx }))
const mockBot = { result: null }
jest.mock('../lib/bot-auth', () => ({ requireBotKey: async () => mockBot.result }))
jest.mock('../lib/change-log', () => ({ logChange: jest.fn(async () => null) }))

const route = require('../app/api/file-upload/route')
const botRoute = require('../app/api/bot/v1/attachments/route')
const { verifyReceipt } = require('../lib/file-upload-server')

const J1 = 'job-1', J2 = 'job-2'
const issue = body => route.POST(new Request('http://x/api/file-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const out = async r => ({ status: r.status, body: await r.json(), headers: r.headers })
const signs = () => mockState.storageCalls.filter(c => c.op === 'createSignedUploadUrl')
const as = (role, userId = `u-${role}`, extra = {}) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null, ...extra } }
const meta = { file_name: 'Receipt.pdf', content_type: 'application/pdf', size: 1234 }

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, pm_email: 'pm-on@nv.test' }, { id: J2, pm_email: null }],
    pm_job_assignments: [
      { id: 'a1', job_id: J1, user_id: 'u-apm' },
      { id: 'a2', job_id: J1, user_id: 'u-super' },
      { id: 'a3', job_id: J2, user_id: 'u-other' },
    ],
    direct_costs: [
      { id: 'dc-rej', job_id: J1, status: 'rejected', submitted_by: 'u-super', draw_request_id: null, drawn_application_id: null },
      { id: 'dc-pend', job_id: J1, status: 'pending', submitted_by: 'u-super', draw_request_id: null, drawn_application_id: null },
      { id: 'dc-billed', job_id: J1, status: 'rejected', submitted_by: 'u-super', draw_request_id: 'dr1', drawn_application_id: null },
      { id: 'dc-j2', job_id: J2, status: 'rejected', submitted_by: 'u-super', draw_request_id: null, drawn_application_id: null },
    ],
    draw_requests: [{ id: 'dr1', job_id: J1, draw_number: 1, status: 'open' }],
    purchase_orders: [{ id: 'po-open', job_id: J1, status: 'issued' }, { id: 'po-closed', job_id: J1, status: 'closed' }, { id: 'po-j2', job_id: J2, status: 'draft' }],
    submittals: [{ id: 'sub-1', job_id: J1 }, { id: 'sub-2', job_id: J2 }],
    general_conditions: [{ id: 'gc-1', job_id: J1, draw_request_id: 'dr1' }, { id: 'gc-2', job_id: J2, draw_request_id: null }],
    billing_submissions: [
      { id: 'b-own', job_id: J1, sub_id: 'u-sub', status: 'pending' },
      { id: 'b-mate', job_id: J1, sub_id: 'u-mate', status: 'pending' },
      { id: 'b-appr', job_id: J1, sub_id: 'u-sub', status: 'approved' },
    ],
    vehicles: [{ id: 'veh-1' }],
    sales_orders: [
      { id: 'o-mb', division: 'metal_buildings', salesperson_id: 'u-rep1', ops_owner_id: null },
      { id: 'o-roof', division: 'commercial_roofing', salesperson_id: 'u-roof', ops_owner_id: null },
    ],
    sales_attribution: [{ order_id: 'o-mb', salesperson_id: 'u-rep2' }],
    subcontracts: [{ id: '55555555-5555-4555-8555-555555555555', job_id: J1, status: 'active' }, { id: '66666666-6666-4666-8666-666666666666', job_id: J1, status: 'signed', signed_at: '2026-01-01' }],
  })
  mockState.auth = null
  mockBilling.ctx = null
})

describe('authentication and roles', () => {
  test('unauthenticated → 401, no storage call', async () => {
    expect((await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta })).status).toBe(401)
    expect(signs()).toEqual([])
  })
  test.each(['subcontractor', 'owner', 'metal_rep', 'roofing_rep', null])('role %s cannot get a job-file upload URL', async role => {
    as(role)
    for (const target of ['direct-cost-receipt', 'gc-doc', 'submittal-doc', 'po-attachment', 'vehicle-photo', 'parse-estimate']) {
      const r = await issue({ target, job_id: J1, vehicle_id: 'veh-1', ...meta })
      expect([400, 403]).toContain(r.status)
    }
    expect(signs()).toEqual([])
  })
  test('principal / admin: any job; assigned APM / super: their job; unassigned PM / APM: refused', async () => {
    for (const role of ['principal', 'admin']) { as(role); expect((await issue({ target: 'direct-cost-receipt', job_id: J2, ...meta })).status).toBe(200) }
    as('apm'); expect((await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta })).status).toBe(200)
    expect((await issue({ target: 'direct-cost-receipt', job_id: J2, ...meta })).status).toBe(403)
    as('pm', 'u-pm-off'); expect((await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta })).status).toBe(403)
    as('pm', 'u-pm-on', { email: 'PM-ON@nv.test' }); expect((await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta })).status).toBe(200)
    expect(signs()).toHaveLength(4)
    expect(signs().every(c => c.opts?.upsert === false)).toBe(true)
  })
  test('response: bucket/path from the server, receipt bound to the caller, private no-store', async () => {
    as('apm')
    const r = await out(await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta }))
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(r.body).toMatchObject({ bucket: 'receipts', path: expect.stringMatching(/^job-1\/[0-9a-f-]{36}_Receipt\.pdf$/), signedUrl: expect.any(String), uploadReceipt: expect.stringMatching(/^v1\./) })
    const c = verifyReceipt(r.body.uploadReceipt).claims
    expect(c).toMatchObject({ sub: 'u-apm', t: 'direct-cost-receipt', b: 'receipts', p: r.body.path, sz: 1234 })
    expect(c.ctx).toMatchObject({ job: J1, rec: null })
  })
  test('client bucket / path / unknown fields / oversized ids / multipart are refused before any signing', async () => {
    as('principal')
    for (const extra of [{ bucket: 'documents' }, { path: `${J1}/x.pdf` }, { role: 'principal' }, { created_by: 'x' }, { surprise: 1 }, { job_id: 'x'.repeat(65) }, { job_id: { a: 1 } }]) {
      expect((await issue({ target: 'direct-cost-receipt', job_id: J1, ...meta, ...extra })).status).toBe(400)
    }
    const fd = new FormData(); fd.append('file', new File(['x'], 'a.pdf'))
    expect((await route.POST(new Request('http://x/api/file-upload', { method: 'POST', body: fd }))).status).toBe(413)
    expect(signs()).toEqual([])
  })
  test('unknown job → 404; DB failure fails closed', async () => {
    as('principal')
    expect((await issue({ target: 'po-attachment', job_id: 'nope', ...meta })).status).toBe(404)
    mockState.failSelect.purchase_orders = 'db down'
    expect((await issue({ target: 'po-attachment', job_id: J1, record_id: 'po-open', ...meta })).status).toBe(500)
    expect(signs()).toEqual([])
  })
})

describe('existing rows: stored job is authoritative', () => {
  test('a forged job_id for an existing record is refused even when the caller sees both jobs', async () => {
    as('principal')
    for (const [target, rec] of [['submittal-doc', 'sub-1'], ['po-attachment', 'po-open'], ['gc-doc', 'gc-2'], ['billing-doc', 'b-own']]) {
      const wrongJob = rec === 'gc-2' ? J1 : J2
      expect((await issue({ target, job_id: wrongJob, record_id: rec, ...meta })).status).toBe(400)
    }
    expect(signs()).toEqual([])
  })
  test('cross-job record: APM on J1 cannot get a URL for a J2 submittal / PO / GC entry', async () => {
    as('apm')
    expect((await issue({ target: 'submittal-doc', record_id: 'sub-2', ...meta })).status).toBe(403)
    expect((await issue({ target: 'po-attachment', record_id: 'po-j2', ...meta })).status).toBe(403)
    expect((await issue({ target: 'gc-doc', record_id: 'gc-2', ...meta })).status).toBe(403)
    expect(signs()).toEqual([])
  })
  test('receipt context is the stored job + record (job_id omitted)', async () => {
    as('apm')
    const r = await out(await issue({ target: 'submittal-doc', record_id: 'sub-1', ...meta }))
    expect(r.status).toBe(200)
    expect(verifyReceipt(r.body.uploadReceipt).claims.ctx).toMatchObject({ job: J1, rec: 'sub-1' })
  })
  test('PO: denyUnlessOnJob (unassigned super refused), closed PO refused', async () => {
    as('super', 'u-super-off')
    expect((await issue({ target: 'po-attachment', job_id: J1, ...meta })).status).toBe(403)
    as('super')
    expect((await issue({ target: 'po-attachment', job_id: J1, ...meta })).status).toBe(200)
    const closed = await out(await issue({ target: 'po-attachment', record_id: 'po-closed', ...meta }))
    expect(closed.status).toBe(409)
    expect(closed.body.error).toBe('This purchase order is closed and cannot be edited.')
    expect(signs()).toHaveLength(1)
  })
  test('GC entry on a draw can still get its attachment replaced (doc_url is not draw-locked)', async () => {
    as('apm')
    expect((await issue({ target: 'gc-doc', record_id: 'gc-1', ...meta })).status).toBe(200)
  })
})

describe('direct-cost resubmit receipts', () => {
  test('own rejected, unbilled cost on a job they are on → ok', async () => {
    as('super')
    const r = await out(await issue({ target: 'dc-resubmit-receipt', record_id: 'dc-rej', ...meta }))
    expect(r.status).toBe(200)
    expect(verifyReceipt(r.body.uploadReceipt).claims.ctx).toMatchObject({ job: J1, rec: 'dc-rej' })
  })
  test('not the submitter / not rejected / billed / not on the job → refused, no URL', async () => {
    as('apm')
    expect((await issue({ target: 'dc-resubmit-receipt', record_id: 'dc-rej', ...meta })).status).toBe(403)
    as('super')
    expect((await issue({ target: 'dc-resubmit-receipt', record_id: 'dc-pend', ...meta })).status).toBe(422)
    expect((await issue({ target: 'dc-resubmit-receipt', record_id: 'dc-billed', ...meta })).status).toBe(409)
    expect((await issue({ target: 'dc-resubmit-receipt', record_id: 'dc-j2', ...meta })).status).toBe(403)
    expect((await issue({ target: 'dc-resubmit-receipt', record_id: 'nope', ...meta })).status).toBe(404)
    expect(signs()).toEqual([])
  })
})

describe('billing docs', () => {
  test('office: create on a job they can see, edit on the stored billing job', async () => {
    as('apm')
    expect((await issue({ target: 'billing-doc', job_id: J1, ...meta })).status).toBe(200)
    expect((await issue({ target: 'billing-doc', job_id: J2, ...meta })).status).toBe(403)
    expect((await issue({ target: 'billing-doc', record_id: 'b-own', ...meta })).status).toBe(200)
  })
  test('sub create needs billing context + can_bill + a billable contract', async () => {
    as('subcontractor', 'u-sub')
    mockBilling.ctx = { error: Response.json({ error: 'You do not have access to this project.' }, { status: 403 }) }
    expect((await issue({ target: 'billing-doc', job_id: J2, ...meta })).status).toBe(403)
    mockBilling.ctx = { job: { id: J1, can_bill: false }, contracts: [{ id: 'c1' }] }
    expect((await issue({ target: 'billing-doc', job_id: J1, ...meta })).status).toBe(403)
    mockBilling.ctx = { job: { id: J1, can_bill: true }, contracts: [] }
    expect((await issue({ target: 'billing-doc', job_id: J1, ...meta })).status).toBe(400)
    expect(signs()).toEqual([])
    mockBilling.ctx = { job: { id: J1, can_bill: true }, contracts: [{ id: 'c1' }] }
    expect((await issue({ target: 'billing-doc', job_id: J1, ...meta })).status).toBe(200)
  })
  test("sub edit: only their own PENDING billing (not a teammate's, not approved)", async () => {
    as('subcontractor', 'u-sub')
    mockBilling.ctx = { job: { id: J1, can_bill: true }, contracts: [{ id: 'c1' }] }
    expect((await issue({ target: 'billing-doc', record_id: 'b-mate', ...meta })).status).toBe(403)
    expect((await issue({ target: 'billing-doc', record_id: 'b-appr', ...meta })).status).toBe(422)
    expect(signs()).toEqual([])
    expect((await issue({ target: 'billing-doc', record_id: 'b-own', ...meta })).status).toBe(200)
  })
})

describe('sales docs', () => {
  const sales = (extra) => issue({ target: 'sales-doc', order_id: 'o-mb', category: 'supplier_order_form', ...meta, ...extra })
  test('assigned / attributed metal rep and office ok; other rep, roofing rep, super refused', async () => {
    for (const [role, id] of [['metal_rep', 'u-rep1'], ['metal_rep', 'u-rep2'], ['pm', 'u-pm']]) { as(role, id); expect((await sales()).status).toBe(200) }
    for (const [role, id] of [['metal_rep', 'u-rep3'], ['roofing_rep', 'u-roof'], ['super', 'u-super']]) { as(role, id); expect([403]).toContain((await sales()).status) }
    expect(signs()).toHaveLength(3)
  })
  test('form categories: MB only, client form must be a PDF name, unknown category refused', async () => {
    as('pm')
    expect((await issue({ target: 'sales-doc', order_id: 'o-roof', category: 'client_order_form', ...meta })).status).toBe(400)
    expect((await sales({ category: 'client_order_form', file_name: 'form.docx' })).status).toBe(400)
    expect((await sales({ category: 'bogus' })).status).toBe(400)
    expect((await sales({ order_id: 'nope' })).status).toBe(404)
    expect(signs()).toEqual([])
    const ok = await out(await sales({ category: 'client_order_form' }))
    expect(verifyReceipt(ok.body.uploadReceipt).claims.ctx).toMatchObject({ order: 'o-mb', cat: 'client_order_form' })
  })
})

describe('vehicle, parse, generated contract, signing html', () => {
  test('vehicle photo needs a real vehicle', async () => {
    as('super')
    expect((await issue({ target: 'vehicle-photo', vehicle_id: 'nope', ...meta })).status).toBe(404)
    expect((await issue({ target: 'vehicle-photo', ...meta })).status).toBe(400)
    const r = await out(await issue({ target: 'vehicle-photo', vehicle_id: 'veh-1', ...meta }))
    expect(r.body.path).toMatch(/^veh-1\//)
  })
  test('parse-estimate: owner prefix, AI types, 20 MB processing limit reported as such', async () => {
    as('pm', 'u-pm')
    const r = await out(await issue({ target: 'parse-estimate', ...meta }))
    expect(r.body).toMatchObject({ bucket: 'estimate-docs', path: expect.stringMatching(/^parse\/u-pm\//) })
    expect((await issue({ target: 'parse-estimate', ...meta, content_type: 'text/plain' })).status).toBe(400)
    const big = await out(await issue({ target: 'parse-estimate', ...meta, size: 21 * 1024 * 1024 }))
    expect(big.status).toBe(413)
    expect(big.body).toMatchObject({ code: 'ai_parse_limit', error: expect.stringMatching(/AI estimate parsing supports files up to 20 MB/) })
    expect(big.body.error).not.toMatch(/upload limit/i)
  })
  test('generated contract: real subcontract on a job the caller can see', async () => {
    as('apm')
    expect((await issue({ target: 'generated-contract', record_id: '55555555-5555-4555-8555-555555555555', file_name: 'c.html', content_type: 'text/html', size: 10 })).status).toBe(200)
    expect((await issue({ target: 'generated-contract', record_id: 'not-a-uuid', file_name: 'c.html', content_type: 'text/html', size: 10 })).status).toBe(400)
    expect((await issue({ target: 'generated-contract', record_id: '55555555-5555-4555-8555-555555555555', file_name: 'c.pdf', content_type: 'application/pdf', size: 10 })).status).toBe(400)
  })
  test('signing html: job access, subcontract same job and unsigned', async () => {
    as('apm')
    const ok = await out(await issue({ target: 'signing-html', job_id: J1, record_id: '55555555-5555-4555-8555-555555555555', file_name: 's.html', content_type: 'text/html', size: 10 }))
    expect(ok.body.path).toMatch(/^signing-drafts\/job-1\/u-apm\/[0-9a-f-]{36}\.html$/)
    expect((await issue({ target: 'signing-html', job_id: J2, file_name: 's.html', content_type: 'text/html', size: 10 })).status).toBe(403)
    as('principal')
    expect((await issue({ target: 'signing-html', job_id: J2, record_id: '55555555-5555-4555-8555-555555555555', file_name: 's.html', content_type: 'text/html', size: 10 })).status).toBe(400)
    expect((await issue({ target: 'signing-html', job_id: J1, record_id: '66666666-6666-4666-8666-666666666666', file_name: 's.html', content_type: 'text/html', size: 10 })).status).toBe(409)
  })
})

describe('bot upload-url', () => {
  // The bot's RLS client: sees only J1, and its own Storage signing is recorded separately.
  function botClient() {
    const base = require('./helpers/mock-db').supabaseModule.createClient()
    const calls = []
    return {
      calls,
      from: table => {
        const q = base.from(table)
        if (table !== 'jobs') return q
        const origEq = q.eq
        q.eq = (c, v) => origEq(c, v === J1 ? v : '__not_visible__')
        return q
      },
      storage: { from: bucket => ({
        createSignedUploadUrl: async (p, o) => { calls.push({ bucket, p, o }); return { data: { signedUrl: `https://bot-signed/${p}` }, error: null } },
        info: async () => ({ data: null, error: { message: 'not allowed' } }),
      }) },
    }
  }
  const botReq = body => botRoute.POST(new Request('http://x/api/bot/v1/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nvb_x' }, body: JSON.stringify(body) }))

  test('signs with the bot RLS client (not the service role); receipt binds bot + key + job + category', async () => {
    const supabase = botClient()
    mockBot.result = { bot: { id: 'bot-1', keyId: 'key-1' }, supabase, error: null }
    const r = await out(await botReq({ action: 'upload-url', job_id: J1, category: 'plans', file_name: 'Plans Rev 3.pdf', content_type: 'application/pdf', size: 48 * 1024 * 1024 }))
    expect(r.status).toBe(200)
    expect(supabase.calls).toEqual([{ bucket: 'job-documents', p: r.body.path, o: { upsert: false } }])
    expect(signs()).toEqual([]) // the service client never signed
    expect(r.body.path).toMatch(/^job-1\/plans\/\d+-[0-9a-f-]{36}-Plans_Rev_3\.pdf$/)
    const c = verifyReceipt(r.body.uploadReceipt).claims
    expect(c).toMatchObject({ sub: 'bot-1', kid: 'key-1', t: 'bot-attachment', b: 'job-documents' })
    expect(c.ctx).toMatchObject({ job: J1, cat: 'plans' })
  })
  test('job the bot cannot see → 404, bad category / body / base64 → 400; nothing signed', async () => {
    const supabase = botClient()
    mockBot.result = { bot: { id: 'bot-1', keyId: 'key-1' }, supabase, error: null }
    expect((await botReq({ action: 'upload-url', job_id: J2, category: 'plans', file_name: 'a.pdf', content_type: 'application/pdf', size: 5 })).status).toBe(404)
    expect((await botReq({ action: 'upload-url', job_id: J1, category: 'bogus', file_name: 'a.pdf', content_type: 'application/pdf', size: 5 })).status).toBe(400)
    expect((await botReq({ action: 'upload-url', job_id: J1, category: 'plans', file_name: 'a.pdf', content_type: 'application/pdf', size: 5, path: 'x' })).status).toBe(400)
    expect((await botReq({ action: 'upload-url', job_id: J1, category: 'plans', file_name: 'a.pdf', content_type: 'application/pdf', size: 5, file: 'JVBERi0xLjQK' })).status).toBe(400)
    expect((await botReq({ action: 'nope' })).status).toBe(400)
    expect(supabase.calls).toEqual([])
  })
  test('job lookup error fails closed', async () => {
    const supabase = botClient()
    supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'rls boom' } }) }) }) })
    mockBot.result = { bot: { id: 'bot-1', keyId: 'key-1' }, supabase, error: null }
    expect((await botReq({ action: 'upload-url', job_id: J1, category: 'plans', file_name: 'a.pdf', content_type: 'application/pdf', size: 5 })).status).toBe(500)
    expect(supabase.calls).toEqual([])
  })
})
