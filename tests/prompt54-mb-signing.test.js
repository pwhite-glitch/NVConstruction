/**
 * Prompt 54: native /sign for metal-building client order forms, signed evidence,
 * and the automatic, idempotent deposit-request email. Subcontract signing must be
 * unchanged. DB/storage/auth/Resend are mocked; no live email or token.
 */
const { mockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => (mockState.auth ? mockState.auth : unauth()),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: (...a) => require('./helpers/mock-db').mockState.send(...a) } } } }))
jest.mock('../lib/sub-access', () => ({ canAccessSubcontract: async () => true, getSubContracts: async () => [] }))

const { PDFDocument } = require('pdf-lib')
const { ID, INSTRUCTIONS, seed, as, addForms, jsonReq, getReq, out, sha } = require('./helpers/mb-fixture')
const sales = require('../app/api/sales-orders/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')
const docRoute = require('../app/api/signing-requests/[token]/document/route')
const signingRoute = require('../app/api/signing-requests/route')
const { sendDepositEmail, depositRequestEmail, classifySendError } = require('../lib/mb-server')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const order = () => mockState.db.sales_orders.find(o => o.id === ID.O1)
const wf = () => mockState.db.mb_order_workflow.find(w => w.order_id === ID.O1)
const reqRow = () => mockState.db.signing_requests.find(r => r.sales_order_id === ID.O1 && r.status !== 'voided')
const signPost = (token, signature_text = 'Jane Doe') => tokenRoute.POST(jsonReq(`http://x/api/signing-requests/${token}`, 'POST', { signature_text }), { params: { token } }).then(out)

async function sendForSig() {
  await addForms()
  as('REP1')
  const r = await post({ action: 'mb_send_for_signature', id: ID.O1 })
  expect(r.status).toBe(200)
  mockState.auth = null // the customer is not signed in
  return reqRow()
}

beforeEach(() => { seed(); delete process.env.NEXT_PUBLIC_SITE_URL })

describe('token GET + document route', () => {
  test('MB token shows the pinned PDF, nothing internal', async () => {
    const row = await sendForSig()
    const g = await out(await tokenRoute.GET(getReq(`http://x/api/signing-requests/${row.token}?html=1`), { params: { token: row.token } }))
    expect(g.body.data).toMatchObject({ document_kind: 'pdf', document_file_name: 'client-form.pdf', status: 'pending', signer_name: 'Jane Doe' })
    expect(g.body.data.document_url).toBe(`/api/signing-requests/${row.token}/document`)
    const s = JSON.stringify(g.body)
    expect(s).not.toMatch(/document_html|sales_order_id|deposit_amount|mb_supplier|storage_path|Acme/)
  })
  test('document route serves exactly the pinned bytes; changed/missing/voided/unknown refused', async () => {
    const row = await sendForSig()
    const res = await docRoute.GET(getReq('http://x'), { params: { token: row.token } })
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(sha(bytes)).toBe(row.document_sha256)
    mockState.files[`sales-docs/${row.document_storage_path}`] = Buffer.from('%PDF-1.4 swapped')
    expect((await docRoute.GET(getReq('http://x'), { params: { token: row.token } })).status).toBe(409)
    row.status = 'voided'
    expect((await docRoute.GET(getReq('http://x'), { params: { token: row.token } })).status).toBe(410)
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'nope' } })).status).toBe(404)
    mockState.db.signing_requests.push({ id: 'sub-req', token: 'subtok', job_id: 'j', subcontract_id: 's', status: 'pending' })
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'subtok' } })).status).toBe(404)
  })
})

describe('signing completion (server-side, no browser follow-up)', () => {
  test('signs, stores signed copy against the sales order, sets deposit_pending, emails only the deposit request', async () => {
    const row = await sendForSig()
    const r = await signPost(row.token)
    expect(r).toMatchObject({ status: 200, body: { ok: true } })
    expect(row).toMatchObject({ status: 'signed', signature_text: 'Jane Doe' })
    // signed copy
    const signedDoc = mockState.db.sales_order_docs.find(d => d.id === row.signed_doc_id)
    expect(signedDoc).toMatchObject({ order_id: ID.O1, category: 'contract', storage_path: `${ID.O1}/signed/${row.id}.pdf`, visible_to_customer: false })
    const signedBytes = mockState.files[`sales-docs/${signedDoc.storage_path}`]
    const signedPdf = await PDFDocument.load(signedBytes)
    expect(signedPdf.getPageCount()).toBe(2) // original page + signature record
    // order + email
    expect(order()).toMatchObject({ payment_status: 'deposit_pending', deposit_received: false })
    expect(mockState.db.sales_order_payments).toHaveLength(0)
    expect(mockState.sent).toHaveLength(1)
    const { msg, opts } = mockState.sent[0]
    expect(msg.to).toBe('jane@example.com')
    expect(opts.idempotencyKey).toBe(`mb-deposit-${row.id}:0`)
    expect(msg.html).toContain('$10,000.00')
    expect(msg.html).toContain('TEST PAYEE &lt;Inc&gt;<br>Suite &amp; 5, Test Town')
    expect(msg.html).toContain('src="https://portal.nv.construction/logo.png"')
    expect(msg.html).not.toMatch(/nvim\.co|doym|\/\/logo/)
    expect(msg.text).toContain(INSTRUCTIONS)
    expect(wf()).toMatchObject({ deposit_email_status: 'sent', deposit_email_provider_id: 'em_1', deposit_email_to: 'jane@example.com' })
    // no fictitious job/subcontract mutation, no 'documents' bucket write
    expect(mockState.calls.filter(c => c.table === 'subcontracts' || c.table === 'storage:documents' || c.table === 'jobs')).toHaveLength(0)
  })
  test('replay, double tap and concurrent completion: one signature, one email', async () => {
    const row = await sendForSig()
    const [a, b] = await Promise.all([signPost(row.token), signPost(row.token)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const again = await signPost(row.token)
    expect(again.status).toBe(400)
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.db.sales_order_docs.filter(d => d.category === 'contract')).toHaveLength(1)
  })
  test('wrong name, voided link, changed pinned file: nothing is claimed', async () => {
    const row = await sendForSig()
    expect((await signPost(row.token, 'Someone Else')).status).toBe(400)
    mockState.files[`sales-docs/${row.document_storage_path}`] = Buffer.from('%PDF-1.4 changed')
    const c = await signPost(row.token)
    expect(c.status).toBe(409)
    expect(row.status).toBe('pending')
    row.status = 'voided'
    expect((await signPost(row.token)).status).toBe(410)
    expect(mockState.sent).toHaveLength(0)
  })
  test('escaped customer name; custom site URL normalized with no double slash', async () => {
    order().customer_name = '<b>Jane</b> Doe'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://portal.example.test///'
    const row = await sendForSig()
    expect((await signPost(row.token, '<b>Jane</b> Doe')).status).toBe(200)
    const html = mockState.sent[0].msg.html
    expect(html).toContain('Hi &lt;b&gt;Jane&lt;/b&gt;,')
    expect(html).toContain('src="https://portal.example.test/logo.png"')
  })
  test('deposit already received or paid: no regression, no deposit demand', async () => {
    Object.assign(order(), { deposit_received: true, payment_status: 'deposit_received' })
    let row = await sendForSig()
    expect((await signPost(row.token)).status).toBe(200)
    expect(order().payment_status).toBe('deposit_received')
    expect(wf().deposit_email_status).toBe('not_needed')
    seed()
    Object.assign(order(), { payment_status: 'paid' })
    row = await sendForSig()
    expect((await signPost(row.token)).status).toBe(200)
    expect(order().payment_status).toBe('paid')
    expect(mockState.sent).toHaveLength(0)
  })
})

describe('deposit email durability and retries', () => {
  const retry = async (who = 'PM', extra = {}) => { as(who); return post({ action: 'mb_retry_completion', id: ID.O1, ...extra }) }

  test('provider rejection: failed + visible; retry uses a NEW key and sends once', async () => {
    mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); return { data: null, error: { statusCode: 422, message: 'Invalid `to` field' } } })
    const row = await sendForSig()
    expect((await signPost(row.token)).status).toBe(200) // signature stands
    expect(wf()).toMatchObject({ deposit_email_status: 'failed', deposit_email_failure_kind: 'rejected', deposit_email_key_gen: 1, deposit_email_payload: null })
    as('PM')
    const detail = (await out(await sales.GET(getReq(`http://x?id=${ID.O1}`)))).body.data.mb
    expect(detail.workflow.deposit_email_last_error).toMatch(/Invalid/)
    expect(detail.recovery_needed).toBe(true)
    mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); return { data: { id: 'em_ok' }, error: null } })
    const r = await retry()
    expect(r.status).toBe(200)
    expect(mockState.sent.map(s => s.opts.idempotencyKey)).toEqual([`mb-deposit-${row.id}:0`, `mb-deposit-${row.id}:1`])
    expect(wf().deposit_email_status).toBe('sent')
    expect((await retry()).body.email.status).toBe('sent')
    expect(mockState.sent).toHaveLength(2)
  })
  test('uncertain (thrown) send: retry reuses the SAME key and payload', async () => {
    mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); throw new Error('socket hang up') })
    const row = await sendForSig()
    await signPost(row.token)
    expect(wf()).toMatchObject({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_key_gen: 0 })
    mockState.db.company_payment_settings[0].payment_instructions = 'CHANGED AFTERWARDS'
    mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); return { data: { id: 'em_ok' }, error: null } })
    await retry()
    const [first, second] = mockState.sent
    expect(second.opts.idempotencyKey).toBe(first.opts.idempotencyKey)
    expect(second.msg).toEqual(first.msg) // same payload, so the provider can dedupe
  })
  test('sent but marker write failed: stays "sending", retry cannot double-deliver', async () => {
    const delivered = new Set()
    mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); delivered.add(opts.idempotencyKey); return { data: { id: 'em_x' }, error: null } })
    mockState.failWrite.mb_order_workflow = (op, p) => (op === 'update' && p.deposit_email_status === 'sent' ? 'marker write failed' : null)
    const row = await sendForSig()
    await signPost(row.token)
    expect(wf().deposit_email_status).toBe('sending')
    // An immediate retry does not resend (may still be in flight)
    expect((await retry()).body.email.status).toBe('sending')
    expect(mockState.sent).toHaveLength(1)
    // After it is stale, the retry re-sends under the same key and records it
    mockState.failWrite = {}
    wf().deposit_email_claimed_at = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    expect((await retry()).body.email.status).toBe('sent')
    expect(mockState.sent).toHaveLength(2)
    expect(delivered.size).toBe(1) // provider idempotency: one real delivery
  })
  test('uncertain claim older than the provider window needs the Owner to force it', async () => {
    mockState.failWrite.mb_order_workflow = (op, p) => (op === 'update' && p.deposit_email_status === 'sent' ? 'x' : null)
    const row = await sendForSig()
    await signPost(row.token)
    mockState.failWrite = {}
    expect(wf().deposit_email_first_attempt_at).toBeTruthy()
    wf().deposit_email_claimed_at = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    wf().deposit_email_first_attempt_at = wf().deposit_email_claimed_at
    const pm = await retry('PM')
    expect(pm.status).toBe(502)
    expect(pm.body.email.error).toMatch(/23 hours/)
    expect((await retry('PM', { force_uncertain: true })).status).toBe(403)
    expect((await retry('OWNER', { force_uncertain: true })).body.email.status).toBe('sent')
  })
  test('marker missing after the signature (failure after claim): office recovers, one email', async () => {
    mockState.failWrite.mb_order_workflow = { insert: 'workflow insert failed' }
    const row = await sendForSig()
    expect((await signPost(row.token)).status).toBe(200)
    expect(row.status).toBe('signed')
    expect(mockState.sent).toHaveLength(0)
    expect(row.signed_doc_id).toBeTruthy() // evidence stored even though the marker failed
    as('PM')
    expect((await out(await sales.GET(getReq(`http://x?id=${ID.O1}`)))).body.data.mb.recovery_needed).toBe(true)
    mockState.failWrite = {}
    as('REP1'); expect((await post({ action: 'mb_retry_completion', id: ID.O1 })).status).toBe(403)
    expect((await retry()).body.email.status).toBe('sent')
    expect(mockState.sent).toHaveLength(1)
  })
  test('payment instructions removed before signing completes: clear failure, retry after Owner fixes it', async () => {
    const row = await sendForSig()
    mockState.db.company_payment_settings = []
    await signPost(row.token)
    expect(wf()).toMatchObject({ deposit_email_status: 'failed', deposit_email_failure_kind: 'config' })
    expect(wf().deposit_email_last_error).toMatch(/Payment instructions are not set up/)
    expect(mockState.sent).toHaveLength(0)
    as('OWNER'); await post({ action: 'mb_save_settings', payment_instructions: 'Check payable to TEST' })
    expect((await retry()).body.email.status).toBe('sent')
    expect(mockState.sent[0].msg.html).toContain('Check payable to TEST')
  })
  test('deposit received after a failed send: retry does not email', async () => {
    mockState.send = jest.fn(async () => ({ data: null, error: { statusCode: 500, message: 'boom' } }))
    const row = await sendForSig()
    await signPost(row.token)
    as('PM'); await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    mockState.send = jest.fn(async () => ({ data: { id: 'x' }, error: null }))
    const r = await retry()
    expect(r.body.email.status).toBe('not_needed')
    expect(mockState.send).not.toHaveBeenCalled()
    expect(order().payment_status).toBe('deposit_received')
  })
  test('missing workflow table: clear error, no false sent flag', async () => {
    mockState.failSelect.mb_order_workflow = 'relation "mb_order_workflow" does not exist'
    const r = await sendDepositEmail(require('./helpers/mock-db').supabaseModule.createClient(), { emails: { send: mockState.send } }, { orderId: ID.O1 })
    expect(r.error).toMatch(/migration 050/)
    expect(mockState.send).not.toHaveBeenCalled()
  })
  test('error classification', () => {
    expect(classifySendError({ statusCode: 422 })).toBe('rejected')
    expect(classifySendError({ statusCode: 403 })).toBe('rejected')
    for (const c of [409, 429, 500, 503, undefined]) expect(classifySendError({ statusCode: c })).toBe('uncertain')
  })
  test('email builder escapes everything and keeps line breaks', () => {
    const m = depositRequestEmail({ order: { customer_name: 'A"B', order_number: '<x>' }, amountCents: 123456, instructions: 'a<script>\nb' })
    expect(m.html).toContain('$1,234.56')
    expect(m.html).toContain('a&lt;script&gt;<br>b')
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;x&gt;')
  })
})

describe('subcontract signing is unchanged', () => {
  const subSeed = () => {
    mockState.db.subcontracts = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', job_id: 'job1', status: 'active', signed_at: null, signed_contract_url: null }]
    mockState.db.signing_requests.push({ id: 'sr-sub', token: 'subtok', job_id: 'job1', subcontract_id: 'aaaaaaaa-0000-4000-8000-000000000001', signer_email: 'sub@x.test', signer_name: 'Sub Guy', document_title: 'Subcontract', document_html: '<html><body>Contract</body></html>', status: 'pending' })
  }
  test('GET returns document_html; POST saves contract and sends the same receipt + staff emails', async () => {
    subSeed()
    const g = await out(await tokenRoute.GET(getReq('http://x?html=1'), { params: { token: 'subtok' } }))
    expect(g.body.data.document_html).toContain('Contract')
    expect(g.body.data.document_kind).toBeUndefined()
    const r = await signPost('subtok', 'Sub Guy')
    expect(r.status).toBe(200)
    expect(mockState.db.subcontracts[0]).toMatchObject({ status: 'signed' })
    expect(mockState.db.subcontracts[0].signed_contract_url).toMatch(/^contracts\//)
    expect(mockState.sent.map(s => s.msg.subject)).toEqual(['Signed: Subcontract', 'Sub Guy signed: Subcontract'])
    expect(mockState.db.mb_order_workflow).toHaveLength(0)
  })
  test('works the same when migration 050 is not applied', async () => {
    subSeed()
    mockState.missingSelectCols.signing_requests = ['sales_order_id']
    expect((await signPost('subtok', 'Sub Guy')).status).toBe(200)
    expect(mockState.sent).toHaveLength(2)
  })
  test('subcontract void endpoint refuses MB requests', async () => {
    const row = await sendForSig()
    as('PM')
    const r = await out(await signingRoute.PATCH(jsonReq('http://x', 'PATCH', { id: row.id, action: 'void' })))
    expect(r.status).toBe(409)
    expect(row.status).toBe('pending')
  })
})
