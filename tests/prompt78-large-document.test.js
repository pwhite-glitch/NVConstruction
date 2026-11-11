/**
 * Prompt 78: large documents without buffered function bodies.
 *  - signing PDF (/api/signing-requests/[token]/document): same token / status / pinned SHA-256
 *    checks; a >5 MB checked PDF is STREAMED (no Content-Length) and byte-for-byte unchanged;
 *    signed copy preferred, pinned original fallback.
 *  - token GET ?html=1: same JSON shape, streamed; MB branch unchanged.
 *  - generated contract GET: a short-lived signed link to the exact stored path (no HTML body).
 *  - send for signature: HTML staged by direct upload (>5 MB), only the exact verified object is
 *    read, small POST response, email failure still voids; inline HTML bounded.
 *  - lien waiver: small drawn-signature data URLs only (413 when large), guards unchanged.
 * Nothing live: mock-db, mocked auth / email.
 */
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
const crypto = require('crypto')
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
const mockMail = { fail: false }
jest.mock('resend', () => ({ Resend: function Resend() { this.emails = { send: async m => { const { mockState } = require('./helpers/mock-db'); mockState.calls.push({ table: 'email', op: 'send', payload: m }); return mockMail.fail ? { data: null, error: { message: 'smtp down' } } : { data: { id: 'e' }, error: null } } } } }))
jest.mock('../lib/sub-access', () => ({ ...jest.requireActual('../lib/sub-access'), getSubAccess: async () => ({ members: [], jobs: [] }), getSubContracts: async () => [] }))

const { mintUpload } = require('./helpers/upload-receipt')
const docRoute = require('../app/api/signing-requests/[token]/document/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')
const signing = require('../app/api/signing-requests/route')
const contract = require('../app/api/subcontract-contract/route')
const waiver = require('../app/api/lien-waiver-sign/route')

const J1 = 'job-1'
const SC = '55555555-5555-4555-8555-555555555555'
const ORDER = '50000000-0000-4000-8000-000000000001'
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const bigPdf = () => { const b = Buffer.alloc(5 * 1024 * 1024 + 4321); b.write('%PDF-1.4\n'); for (let i = 9; i < b.length; i++) b[i] = (i * 7) & 0xff; return b }
const getReq = url => new Request(url)
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${userId}@nv.test`, role, error: null } }

async function readStream(res) {
  const reader = res.body.getReader()
  const parts = []
  let chunks = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks++; parts.push(Buffer.from(value)) }
  return { bytes: Buffer.concat(parts), chunks }
}

let PDF
beforeEach(() => {
  PDF = bigPdf()
  resetMockState({
    jobs: [{ id: J1, job_number: '101', project_name: 'Main' }],
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-apm' }],
    subcontracts: [{ id: SC, job_id: J1, status: 'active', vendor_name: 'Acme', generated_contract_path: `subcontracts/${SC}/generated-2026-11-11T00-00-00-000Z.html`, signed_contract_url: null }],
    signing_requests: [
      { id: 'r-mb', token: 'tok-mb', status: 'pending', sales_order_id: ORDER, document_storage_path: `${ORDER}/form.pdf`, document_sha256: null, document_file_name: 'client-form.pdf', signer_name: 'Jane', signed_document_path: null },
      { id: 'r-sub', token: 'tok-sub', status: 'pending', job_id: J1, subcontract_id: SC, signer_name: 'Sam', signer_email: 's@x.test', document_title: 'Sub', document_html: '<p>' + 'contract '.repeat(700_000) + '</p>', created_at: '2026-11-01' },
    ],
    billing_submissions: [{ id: 'b1', sub_id: 'u-sub', job_id: J1, status: 'approved', amount_billed: 100, billing_period: '2026-10-01', lien_waiver_signed_at: null }],
  })
  mockState.files[`sales-docs/${ORDER}/form.pdf`] = PDF
  mockState.db.signing_requests[0].document_sha256 = sha(PDF)
  let n = 0
  mockState.defaults.signing_requests = () => ({ status: 'pending', token: `tok-new-${++n}` }) // DB defaults
  mockMail.fail = false
  mockState.auth = null
})

describe('signing PDF document route', () => {
  test('>5 MB checked PDF is streamed (no Content-Length), headers kept, bytes unchanged', async () => {
    const res = await docRoute.GET(getReq('http://x'), { params: { token: 'tok-mb' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="client-form.pdf"')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const { bytes, chunks } = await readStream(res)
    expect(chunks).toBeGreaterThan(1)
    expect(bytes.equals(PDF)).toBe(true)
  })
  test('invalid token, voided, stale digest are still refused', async () => {
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'nope' } })).status).toBe(404)
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'tok-sub' } })).status).toBe(404)
    mockState.files[`sales-docs/${ORDER}/form.pdf`] = Buffer.from('%PDF-1.4 swapped')
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'tok-mb' } })).status).toBe(409)
    mockState.db.signing_requests[0].status = 'voided'
    expect((await docRoute.GET(getReq('http://x'), { params: { token: 'tok-mb' } })).status).toBe(410)
  })
  test('signed: the signed copy is served; falls back to the pinned original when it is missing', async () => {
    const r = mockState.db.signing_requests[0]
    r.status = 'signed'; r.signed_document_path = `${ORDER}/signed/r-mb.pdf`
    mockState.files[`sales-docs/${r.signed_document_path}`] = Buffer.from('%PDF-1.4 SIGNED')
    expect((await readStream(await docRoute.GET(getReq('http://x'), { params: { token: 'tok-mb' } }))).bytes.toString()).toBe('%PDF-1.4 SIGNED')
    delete mockState.files[`sales-docs/${r.signed_document_path}`]
    expect((await readStream(await docRoute.GET(getReq('http://x'), { params: { token: 'tok-mb' } }))).bytes.equals(PDF)).toBe(true)
  })
})

describe('token GET ?html=1', () => {
  test('subcontract: same { data: { …, document_html, company_name } } shape, streamed (no Content-Length)', async () => {
    const res = await tokenRoute.GET(getReq('http://x/api/signing-requests/tok-sub?html=1'), { params: { token: 'tok-sub' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = JSON.parse((await readStream(res)).bytes.toString('utf8'))
    expect(body.data.document_html).toBe(mockState.db.signing_requests[1].document_html)
    expect(body.data.document_html.length).toBeGreaterThan(5 * 1024 * 1024)
    expect(body.data).toMatchObject({ token: 'tok-sub', company_name: 'Acme', signer_name: 'Sam' })
  })
  test('without html=1: plain JSON as before; unknown token 404; MB branch unchanged (no html)', async () => {
    // (mock-db does not project columns, so the html-less select itself is not asserted here)
    const plain = await tokenRoute.GET(getReq('http://x/api/signing-requests/tok-sub'), { params: { token: 'tok-sub' } })
    expect(plain.status).toBe(200)
    expect((await plain.json()).data.token).toBe('tok-sub')
    expect((await tokenRoute.GET(getReq('http://x/api/signing-requests/nope?html=1'), { params: { token: 'nope' } })).status).toBe(404)
    const mb = await (await tokenRoute.GET(getReq('http://x/api/signing-requests/tok-mb?html=1'), { params: { token: 'tok-mb' } })).json()
    expect(mb.data).toMatchObject({ document_kind: 'pdf', document_url: '/api/signing-requests/tok-mb/document' })
    expect(JSON.stringify(mb)).not.toMatch(/document_html|sales_order_id/)
  })
})

describe('generated contract GET', () => {
  test('returns a signed link to the exact stored path (no HTML body); job access checked', async () => {
    as('apm')
    const res = await contract.GET(getReq(`http://x/api/subcontract-contract?subcontract_id=${SC}&kind=generated`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toEqual({ url: `https://signed/subcontracts/${SC}/generated-2026-11-11T00-00-00-000Z.html`, path: `subcontracts/${SC}/generated-2026-11-11T00-00-00-000Z.html` })
    expect(body).not.toHaveProperty('html')
    expect(mockState.storageCalls.filter(c => c.op === 'download')).toEqual([])
    as('apm', 'u-apm-off')
    expect((await contract.GET(getReq(`http://x/api/subcontract-contract?subcontract_id=${SC}`))).status).toBe(403)
  })
  test('signed kind: only an .html signed_contract_url; none → 404', async () => {
    as('principal')
    expect((await contract.GET(getReq(`http://x/api/subcontract-contract?subcontract_id=${SC}&kind=signed`))).status).toBe(404)
    mockState.db.subcontracts[0].signed_contract_url = `contracts/${SC}/signed.pdf`
    expect((await contract.GET(getReq(`http://x/api/subcontract-contract?subcontract_id=${SC}&kind=signed`))).status).toBe(400)
  })
})

describe('send for signature with a staged document', () => {
  const html = '<html><body>' + 'Section '.repeat(800_000) + '</body></html>' // > 5 MB
  const staged = async (ctx = { job: J1, rec: SC, user: 'u-apm' }, subject = 'u-apm') => {
    const u = await mintUpload({ target: 'signing-html', subject, ctx, name: 'signing.html', contentType: 'text/html', size: Buffer.byteLength(html) })
    mockState.files[`documents/${u.path}`] = Buffer.from(html)
    return u
  }
  const body = att => ({ job_id: J1, subcontract_id: SC, signer_email: 'S@X.test', signer_name: 'Sam Signer', document_title: 'Sub', document_attachment: att })

  test('stores exactly the verified staged HTML; small response (no document_html); email sent; copy saved', async () => {
    as('apm')
    const u = await staged()
    const res = await signing.POST(req('/api/signing-requests', 'POST', body(u.attachment)))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(out).length).toBeLessThan(5000)
    expect(out.data).not.toHaveProperty('document_html')
    expect(out.data).toMatchObject({ signer_email: 's@x.test', signer_name: 'Sam Signer', subcontract_id: SC })
    const row = mockState.db.signing_requests.find(r => r.id === out.data.id)
    expect(row.document_html).toBe(html)
    expect(row.created_by).toBe('u-apm')
    expect(mockState.calls.filter(c => c.table === 'email')).toHaveLength(1)
    expect(mockState.calls.filter(c => c.op === 'upload' && c.table === 'storage:documents')).toHaveLength(1) // saveGeneratedContract copy
  })
  test('email failure still voids the new request (502)', async () => {
    as('apm')
    mockMail.fail = true
    const res = await signing.POST(req('/api/signing-requests', 'POST', body((await staged()).attachment)))
    expect(res.status).toBe(502)
    expect(mockState.db.signing_requests.filter(r => r.signer_name === 'Sam Signer').map(r => r.status)).toEqual(['voided'])
  })
  test('unvalidated / foreign staging paths are refused before any row is written', async () => {
    as('apm')
    const before = mockState.db.signing_requests.length
    expect((await signing.POST(req('/api/signing-requests', 'POST', body({ path: `signing-drafts/${J1}/u-apm/x.html`, uploadReceipt: 'v1.x.y' })))).status).toBe(422)
    const otherUser = await staged({ job: J1, rec: SC, user: 'u-principal' }, 'u-principal')
    expect((await signing.POST(req('/api/signing-requests', 'POST', body(otherUser.attachment)))).status).toBe(422)
    const noSc = await staged({ job: J1, user: 'u-apm' })
    expect((await signing.POST(req('/api/signing-requests', 'POST', body(noSc.attachment)))).status).toBe(422)
    expect(mockState.db.signing_requests.length).toBe(before)
    expect(mockState.calls.filter(c => c.table === 'email')).toEqual([])
  })
  test('inline HTML: small still works (compat), over 512 KiB → 413; signed subcontract still 409', async () => {
    as('apm')
    expect((await signing.POST(req('/api/signing-requests', 'POST', { ...body(undefined), document_html: '<p>small</p>' }))).status).toBe(200)
    expect((await signing.POST(req('/api/signing-requests', 'POST', { ...body(undefined), document_html: 'x'.repeat(600 * 1024) }))).status).toBe(413)
    mockState.db.subcontracts[0].signed_at = '2026-11-01'
    expect((await signing.POST(req('/api/signing-requests', 'POST', body((await staged()).attachment)))).status).toBe(409)
  })
})

describe('lien waiver drawn signature', () => {
  const sign = signature => waiver.POST(req('/api/lien-waiver-sign', 'POST', { submission_id: 'b1', signer_name: 'Sam', signature, expected_amount: 100, expected_period: '2026-10-01' }))
  test('tiny PNG data URL signs (compare-and-set unchanged)', async () => {
    as('subcontractor', 'u-sub')
    const res = await sign('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    expect(res.status).toBe(200)
    expect(mockState.db.billing_submissions[0]).toMatchObject({ lien_waiver_signer_name: 'Sam', lien_waiver_signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' })
    expect((await sign('data:image/png;base64,AAAA')).status).toBe(400) // already signed
  })
  test('oversized → 413, not an image → 400; nothing written', async () => {
    as('subcontractor', 'u-sub')
    expect((await sign('data:image/png;base64,' + 'A'.repeat(300 * 1024))).status).toBe(413)
    expect((await sign('data:text/html;base64,PHNjcmlwdD4=')).status).toBe(400)
    expect((await sign({ src: 'x' })).status).toBe(400)
    expect(mockState.db.billing_submissions[0].lien_waiver_signed_at).toBeNull()
  })
  test('signer / status guards unchanged: other sub 403, unapproved 422, changed amount 409', async () => {
    as('subcontractor', 'u-other')
    expect((await sign(null)).status).toBe(403)
    as('subcontractor', 'u-sub')
    mockState.db.billing_submissions[0].amount_billed = 101
    expect((await sign(null)).status).toBe(409)
    mockState.db.billing_submissions[0].status = 'pending'
    expect((await sign(null)).status).toBe(422)
  })
})
