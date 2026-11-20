/**
 * Prompt 98: SignWell e-signature for subcontracts (test mode by default).
 *  - lib/signwell.js client: headers, test_mode default, key never in errors, 429 message.
 *  - text tags written into the contract's e-sign slots (white), packet files.
 *  - /api/signing-requests: SignWell instead of the built-in link when the key is set; built-in
 *    flow unchanged without it; "run migration 081" before the columns exist.
 *  - /api/signwell/webhook: signature valid / invalid / missing secret; re-fetch; metadata and
 *    stored doc-id must match; completed stores the PDF once (idempotent); status updates.
 *  - /api/subcontracts/signwell: remind / void guards.
 * fetch, DB, auth and storage are mocked; nothing live.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('pdf-lib')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send: async () => (global.__resendSent = (global.__resendSent || 0) + 1, { error: null }) } } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})

const SW = require('../lib/signwell')
const SWSrv = require('../lib/signwell-server')
const SWS = require('../lib/signwell-status')
const { withSignwellTextTags, buildSignwellPacket } = require('../lib/signwell-packet')
const { signedMethodLabel } = require('../lib/signed-upload')
const { buildSubcontractHtml } = require('../lib/buildSubcontractHtml')
const signingRoute = require('../app/api/signing-requests/route')
const webhook = require('../app/api/signwell/webhook/route')
const office = require('../app/api/subcontracts/signwell/route')
const subInitiate = require('../app/api/sub-initiate-sign/route')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

const KEY = 'sw_live_SECRETKEY_1234567890'
const HOOK = 'hook-3ca1189b-ae29-4a9e-878d-5c53dee86987'
const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const SC2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const F = { sub_name: 'Acme', contract_amount: '100', job_number: '7469', subcontract_number: '2026-7469-001', pay_pct: '100' }
const DOC = 'a692e1ce-9929-4541-adc7-61932bab39d3'

const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const req = (url, method, body, raw) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(raw != null ? { body: raw } : body ? { body: JSON.stringify(body) } : {}) })
const json = async r => ({ status: r.status, body: await r.json() })

async function onePagePdf() {
  const d = await PDFDocument.create(); d.addPage([200, 200]); return Buffer.from(await d.save())
}
let PDF
beforeAll(async () => { PDF = await onePagePdf() })

// ── fetch mock ──────────────────────────────────────────────────────────────
let calls, docs, fetchOverride, hookList
const res = (status, body, { binary } = {}) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => { const b = Buffer.from(binary || []); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) },
})
function installFetch() {
  calls = []
  docs = {}
  fetchOverride = null
  hookList = []
  global.fetch = jest.fn(async (url, init = {}) => {
    const call = { url, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    if (fetchOverride) { const o = fetchOverride(call); if (o) return o }
    const u = new URL(url)
    if (u.pathname === '/api/v1/hooks' && init.method === 'GET') return res(200, hookList)
    const m = /^\/api\/v1\/documents(?:\/([^/]+))?(?:\/(\w+))?$/.exec(u.pathname)
    if (!m) return res(404, { message: 'nope' })
    const [, id, sub] = m
    if (!id && init.method === 'POST') {
      const d = { id: DOC, status: 'Sent', test_mode: call.body.test_mode, metadata: call.body.metadata }
      docs[DOC] = d
      return res(201, d)
    }
    const d = docs[id]
    if (!d) return res(404, { message: 'not found' })
    if (!sub && init.method === 'GET') return res(200, d)
    if (!sub && init.method === 'DELETE') { d.status = 'Canceled'; return res(204, null) }
    if (sub === 'remind') return res(201, d)
    if (sub === 'completed_pdf') return res(200, null, { binary: PDF })
    return res(404, {})
  })
}

function seed(extra = {}) {
  resetMockState({
    jobs: [{ id: J1, pm_email: 'pm@nv.com', job_number: '7469' }, { id: J2, pm_email: 'other@nv.com' }],
    pm_job_assignments: [],
    subcontracts: [
      { id: SC1, job_id: J1, vendor_name: 'Acme Plumbing', status: 'active', contract_value: 12500, signed_at: null, signed_contract_url: null, bid_proposal_url: `bid-proposals/${J1}/p.pdf`, signwell_document_id: null, signwell_status: null, signwell_sent_at: null, signwell_completed_at: null },
      { id: SC2, job_id: J2, vendor_name: 'Other Co', status: 'active', contract_value: 9000, signed_at: null, signed_contract_url: null, signwell_document_id: null, signwell_status: null },
    ],
    signing_requests: [],
    job_documents: [],
    change_log: [],
    ...extra,
  })
}

const ENV_KEYS = ['SIGNWELL_API_KEY', 'SIGNWELL_WEBHOOK_ID', 'SIGNWELL_TEST_MODE']
let savedEnv
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  process.env.SIGNWELL_API_KEY = KEY
  process.env.SIGNWELL_WEBHOOK_ID = HOOK
  delete process.env.SIGNWELL_TEST_MODE
  global.__resendSent = 0
  installFetch()
  SWSrv.resetSignwellHookCache()
  seed()
  as('principal')
})
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] } })

// ── client ──────────────────────────────────────────────────────────────────
describe('lib/signwell client', () => {
  test('X-Api-Key header, base URL, test_mode defaults ON, signing order + metadata', async () => {
    await SW.createDocument({ name: 'S', files: [{ name: 'a.html', bytes: '<p>x</p>' }], recipients: [{ id: '1', name: 'Jane', email: 'j@x.com' }], metadata: { subcontract_id: SC1, job_id: J1 } })
    const c = calls[0]
    expect(c.url).toBe('https://www.signwell.com/api/v1/documents')
    expect(c.method).toBe('POST')
    expect(c.headers['X-Api-Key']).toBe(KEY)
    expect(c.body.test_mode).toBe(true)
    expect(c.body.apply_signing_order).toBe(true)
    expect(c.body.text_tags).toBe(true)
    expect(c.body.draft).toBe(false)
    expect(c.body.metadata).toEqual({ subcontract_id: SC1, job_id: J1 })
    expect(Buffer.from(c.body.files[0].file_base64, 'base64').toString()).toBe('<p>x</p>')
    expect(c.body.recipients).toEqual([{ id: '1', name: 'Jane', email: 'j@x.com' }])
  })

  test('test_mode is off only for SIGNWELL_TEST_MODE === "false"', async () => {
    expect(SW.isSignwellTestMode({})).toBe(true)
    expect(SW.isSignwellTestMode({ SIGNWELL_TEST_MODE: 'FALSE' })).toBe(true)
    expect(SW.isSignwellTestMode({ SIGNWELL_TEST_MODE: '0' })).toBe(true)
    expect(SW.isSignwellTestMode({ SIGNWELL_TEST_MODE: 'false' })).toBe(false)
    process.env.SIGNWELL_TEST_MODE = 'false'
    await SW.createDocument({ files: [{ name: 'a.pdf', bytes: PDF }], recipients: [{ name: 'J', email: 'j@x.com' }] })
    expect(calls[0].body.test_mode).toBe(false)
  })

  test('isSignwellEnabled follows the key', () => {
    expect(SW.isSignwellEnabled({ SIGNWELL_API_KEY: 'k' })).toBe(true)
    expect(SW.isSignwellEnabled({})).toBe(false)
  })

  test('completed_pdf asks for the audit page; remind / delete / send hit the documented paths', async () => {
    docs[DOC] = { id: DOC, status: 'Completed' }
    const pdf = await SW.getCompletedPdf(DOC)
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF')
    const u = new URL(calls[0].url)
    expect(u.pathname).toBe(`/api/v1/documents/${DOC}/completed_pdf`)
    expect(u.searchParams.get('audit_page')).toBe('true')
    await SW.remind(DOC)
    expect(calls[1]).toMatchObject({ method: 'POST', url: `https://www.signwell.com/api/v1/documents/${DOC}/remind` })
    await SW.deleteDocument(DOC)
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: `https://www.signwell.com/api/v1/documents/${DOC}` })
    fetchOverride = () => res(200, { id: DOC, status: 'Sent' })
    await SW.sendDocument(DOC)
    expect(calls[3]).toMatchObject({ method: 'POST', url: `https://www.signwell.com/api/v1/documents/${DOC}/send` })
    expect(calls[3].body.test_mode).toBe(true)
  })

  test('the key never appears in error messages (echoed body, network error); 429 is clear', async () => {
    fetchOverride = () => res(422, { message: 'bad', meta: { messages: [`token ${KEY} is wrong`] } })
    let err = await SW.getDocument(DOC).catch(e => e)
    expect(err.message).not.toContain(KEY)
    expect(err.message).toContain('[redacted]')
    fetchOverride = () => { throw new Error(`connect failed for ${KEY}`) }
    err = await SW.getDocument(DOC).catch(e => e)
    expect(err.message).not.toContain(KEY)
    fetchOverride = () => res(429, { error: 'Limit 20/min, resets in 40s' })
    err = await SW.getDocument(DOC).catch(e => e)
    expect(err.status).toBe(429)
    expect(err.message).toMatch(/rate limit/i)
    expect(err.message).toContain('resets in 40s')
    fetchOverride = () => res(401, { message: 'revoked' })
    err = await SW.getDocument(DOC).catch(e => e)
    expect(err.message).not.toContain(KEY)
  })

  test('no key → not_configured, no request', async () => {
    delete process.env.SIGNWELL_API_KEY
    const err = await SW.getDocument(DOC).catch(e => e)
    expect(err.code).toBe('not_configured')
    expect(calls).toHaveLength(0)
  })

  test('status mapping + labels + open set', () => {
    expect(SWS.mapSignwellStatus('Sent')).toBe('sent')
    expect(SWS.mapSignwellStatus('Viewed')).toBe('viewed')
    expect(SWS.mapSignwellStatus('Pending')).toBe('pending')
    expect(SWS.mapSignwellStatus('Completed')).toBe('completed')
    expect(SWS.mapSignwellStatus('Manually completed')).toBe('manually_completed')
    expect(SWS.mapSignwellStatus('Declined')).toBe('declined')
    expect(SWS.mapSignwellStatus('Canceled')).toBe('canceled')
    expect(SWS.mapSignwellStatus('Expired')).toBe('expired')
    expect(SWS.mapSignwellStatus('Bounced')).toBe('bounced')
    expect(SWS.mapSignwellStatus('Error')).toBe('error')
    expect(SWS.mapSignwellStatus('weird')).toBeNull()
    expect(SWS.signwellStatusLabel('viewed')).toBe('Viewed')
    expect(SWS.signwellStatusLabel('canceled')).toBe('Voided')
    expect(SWS.isSignwellOpen('sent')).toBe(true)
    expect(SWS.isSignwellOpen('completed')).toBe(false)
    expect(SWS.isSignwellOpen('declined')).toBe(false)
    expect(signedMethodLabel('signwell')).toBe('Signed (SignWell)')
  })
})

// ── packet / text tags ──────────────────────────────────────────────────────
describe('text tags', () => {
  test('tags go into the e-sign slots of the generated contract in white text', () => {
    const html = buildSubcontractHtml(F, 'https://p')
    const t = withSignwellTextTags(html)
    expect(t.tagged).toBe(true)
    expect(t.slots).toEqual(['cover-signature', 'sub-signature', 'sub-title', 'sub-date'])
    expect(t.html).toMatch(/data-esign="sub-signature"[^>]*><span data-signwell-tag="1" style="color:#ffffff[^"]*">\{\{s:1:y:::sub_signature:185:28\}\}<\/span>/)
    expect(t.html).toContain('{{t:1:y:Title::sub_title:105:16}}')
    expect(t.html).toContain('{{af_d_s:1:y:::sub_date:78:16}}')
    // only signer 1 (no NV countersignature in the built-in flow)
    expect(t.html).not.toMatch(/\{\{\w+:2:/)
  })

  test('the job page builder has the same slots', () => {
    const page = read('app/jobdetail/page.js')
    for (const m of ['cover-signature', 'sub-signature', 'sub-title', 'sub-date']) expect(page).toContain(`data-esign="${m}"`)
  })

  test('no slots → text tags off (SignWell signature page); exhibits PDF is a second file', () => {
    const p = buildSignwellPacket({ html: '<p>contract</p>', exhibitsBytes: PDF, vendorName: 'Acme/Plumbing' })
    expect(p.textTags).toBe(false)
    expect(p.files.map(f => f.name)).toEqual(['Subcontract - Acme Plumbing.html', 'Exhibits A-B - Acme Plumbing.pdf'])
  })
})

// ── send ────────────────────────────────────────────────────────────────────
const sendBody = (extra = {}) => ({ job_id: J1, subcontract_id: SC1, signer_email: 'Jane@Acme.com', signer_name: 'Jane Doe', document_html: buildSubcontractHtml(F, 'https://p'), document_title: 'Subcontract — Acme', ...extra })
const send = b => signingRoute.POST(req('/api/signing-requests', 'POST', b))
const sc1 = () => mockState.db.subcontracts.find(r => r.id === SC1)

describe('send through SignWell', () => {
  test('key set → SignWell document (contract HTML + exhibits PDF), recorded on the subcontract, no built-in link or email', async () => {
    mockState.files[`prime-contracts/bid-proposals/${J1}/p.pdf`] = PDF
    mockState.db.signing_requests.push({ id: 'old', subcontract_id: SC1, status: 'pending' })
    const r = await json(await send(sendBody({ exhibits: { proposal: true, billing: false } })))
    expect(r.status).toBe(200)
    expect(r.body.provider).toBe('signwell')
    expect(r.body.data).toMatchObject({ signwell_document_id: DOC, signwell_status: 'sent', test_mode: true })
    expect(r.body.exhibits_included).toEqual(['proposal'])
    expect(r.body.voided).toBe(1)
    const create = calls.find(c => c.method === 'POST' && c.url.endsWith('/documents'))
    expect(create.body.recipients).toEqual([{ id: '1', name: 'Jane Doe', email: 'jane@acme.com' }])
    expect(create.body.metadata).toEqual({ subcontract_id: SC1, job_id: J1 })
    expect(create.body.files).toHaveLength(2)
    expect(Buffer.from(create.body.files[0].file_base64, 'base64').toString()).toContain('{{s:1:y:::sub_signature:185:28}}')
    expect(Buffer.from(create.body.files[1].file_base64, 'base64').subarray(0, 4).toString()).toBe('%PDF')
    expect(create.body.text_tags).toBe(true)
    expect(sc1()).toMatchObject({ signwell_document_id: DOC, signwell_status: 'sent', status: 'active' })
    expect(sc1().signwell_sent_at).toBeTruthy()
    expect(mockState.db.signing_requests.filter(x => x.id !== 'old')).toHaveLength(0)
    expect(global.__resendSent).toBe(0)
    // amounts untouched
    expect(sc1().contract_value).toBe(12500)
  })

  test('no key → built-in flow exactly as before (signing link + email, no SignWell call)', async () => {
    delete process.env.SIGNWELL_API_KEY
    const r = await json(await send(sendBody()))
    expect(r.status).toBe(200)
    expect(r.body.provider).toBeUndefined()
    expect(mockState.db.signing_requests).toHaveLength(1)
    expect(global.__resendSent).toBe(1)
    expect(calls).toHaveLength(0)
  })

  test('before migration 081 → clear "run migration 081" error, nothing sent; built-in still works without key', async () => {
    mockState.missingSelectCols = { subcontracts: ['signwell_document_id'] }
    const r = await json(await send(sendBody()))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('migration_081')
    expect(r.body.error).toMatch(/migration 081/)
    expect(calls).toHaveLength(0)
    expect(mockState.db.signing_requests).toHaveLength(0)
    delete process.env.SIGNWELL_API_KEY
    expect((await send(sendBody())).status).toBe(200)
  })

  test('already out on SignWell → 409; supers / PM off the job refused; SignWell failure sends nothing', async () => {
    Object.assign(sc1(), { signwell_document_id: 'x', signwell_status: 'viewed' })
    expect((await send(sendBody())).status).toBe(409)
    Object.assign(sc1(), { signwell_document_id: null, signwell_status: null })
    as('super')
    expect((await send(sendBody())).status).toBe(403)
    as('pm')
    const b = await json(await send(sendBody({ job_id: J2, subcontract_id: SC2 })))
    expect(b.status).toBe(403)
    as('principal')
    fetchOverride = () => res(429, { error: 'too many' })
    const f = await json(await send(sendBody()))
    expect(f.status).toBe(429)
    expect(f.body.error).toMatch(/Nothing was sent/)
    expect(f.body.error).not.toContain(KEY)
    expect(sc1().signwell_document_id).toBeNull()
  })

  test('sub self-initiate is refused while a SignWell request is open', async () => {
    Object.assign(sc1(), { signwell_document_id: DOC, signwell_status: 'sent', sub_id: 'u-subcontractor' })
    as('subcontractor')
    const r = await json(await subInitiate.POST(req('/api/sub-initiate-sign', 'POST', { subcontract_id: SC1 })))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('signwell_open')
    expect(mockState.db.signing_requests).toHaveLength(0)
  })
})

// ── webhook ─────────────────────────────────────────────────────────────────
const sign = (type, time, key = HOOK) => crypto.createHmac('sha256', key).update(`${type}@${time}`).digest('hex')
const event = (type, { time = 1689332249, hash, id = DOC } = {}) => ({ event: { type, time, hash: hash ?? sign(type, time) }, data: { object: { id, status: 'Completed', metadata: { subcontract_id: SC2 } } } })
const hook = p => webhook.POST(req('/api/signwell/webhook', 'POST', null, typeof p === 'string' ? p : JSON.stringify(p)))
const sent = () => { Object.assign(sc1(), { signwell_document_id: DOC, signwell_status: 'sent', signwell_sent_at: '2026-11-20T18:00:00Z' }); docs[DOC] = { id: DOC, status: 'Sent', metadata: { subcontract_id: SC1, job_id: J1 } } }

describe('webhook', () => {
  test('signature: valid accepted; wrong hash / wrong key / missing secret / bad JSON → 401', async () => {
    sent()
    expect((await hook(event('document_viewed'))).status).toBe(200)
    expect((await hook(event('document_viewed', { hash: 'f'.repeat(64) }))).status).toBe(401)
    expect((await hook(event('document_viewed', { hash: sign('document_viewed', 1689332249, 'other') }))).status).toBe(401)
    expect((await hook(event('document_viewed', { hash: sign('document_completed', 1689332249) }))).status).toBe(401)
    expect((await hook('not json')).status).toBe(401)
    delete process.env.SIGNWELL_WEBHOOK_ID
    expect((await hook(event('document_viewed'))).status).toBe(401)
    expect(SW.verifySignwellEvent({ type: 'a', time: 1, hash: sign('a', 1) }, HOOK)).toBe(true)
    expect(SW.verifySignwellEvent({ type: 'a', time: 1, hash: sign('a', 1).toUpperCase() }, HOOK)).toBe(false)
  })

  test('acts on the re-fetched document, not the posted body', async () => {
    sent()
    docs[DOC].status = 'Viewed'
    // the posted body claims Completed and another subcontract; ignored
    const r = await json(await hook(event('document_viewed')))
    expect(r.status).toBe(200)
    expect(sc1().signwell_status).toBe('viewed')
    expect(sc1().signed_contract_url).toBeNull()
    expect(calls.some(c => c.method === 'GET' && c.url.endsWith(`/documents/${DOC}`))).toBe(true)
  })

  test('metadata subcontract or stored doc id mismatch → rejected, nothing written', async () => {
    sent()
    docs[DOC].metadata = { subcontract_id: SC2, job_id: J2 }
    expect((await hook(event('document_completed'))).status).toBe(404)
    docs[DOC].metadata = { subcontract_id: SC1, job_id: J1 }
    sc1().signwell_document_id = 'some-other-doc'
    expect((await hook(event('document_completed'))).status).toBe(404)
    sc1().signwell_document_id = DOC
    docs[DOC].metadata = { subcontract_id: SC1, job_id: J2 }
    expect((await hook(event('document_completed'))).status).toBe(404)
    expect(mockState.calls.filter(c => c.table === 'subcontracts')).toHaveLength(0)
    expect(Object.keys(mockState.files).some(k => k.includes('signwell-'))).toBe(false)
  })

  test('completed: stores the audit-page PDF, marks signed (signwell); repeat is a no-op', async () => {
    sent()
    docs[DOC].status = 'Completed'
    const r = await json(await hook(event('document_completed')))
    expect(r.status).toBe(200)
    const p = `contracts/${SC1}/signwell-${DOC}.pdf`
    expect(mockState.files[`documents/${p}`].subarray(0, 4).toString()).toBe('%PDF')
    expect(sc1()).toMatchObject({ signed_contract_url: p, signed_method: 'signwell', signwell_status: 'completed', status: 'signed' })
    expect(sc1().signed_at).toBeTruthy()
    expect(sc1().signwell_completed_at).toBeTruthy()
    expect(calls.some(c => c.url.includes('/completed_pdf') && c.url.includes('audit_page=true'))).toBe(true)
    // only signing fields written
    const keys = new Set(mockState.calls.filter(c => c.table === 'subcontracts').flatMap(c => Object.keys(c.payload)))
    for (const k of keys) expect(['signed_contract_url', 'signed_method', 'signwell_status', 'signwell_completed_at', 'signed_at', 'status']).toContain(k)
    expect(sc1().contract_value).toBe(12500)

    const before = mockState.calls.length
    const pdfCalls = calls.filter(c => c.url.includes('/completed_pdf')).length
    const again = await json(await hook(event('document_completed', { time: 1689332250 })))
    expect(again.status).toBe(200)
    expect(again.body.unchanged).toBe(true)
    expect(mockState.calls.length).toBe(before)
    expect(calls.filter(c => c.url.includes('/completed_pdf')).length).toBe(pdfCalls)
  })

  test('completed before migration 080: still stored and signed (signed_method dropped)', async () => {
    sent()
    docs[DOC].status = 'Completed'
    mockState.missingCols = { subcontracts: ['signed_method'] }
    expect((await hook(event('document_completed'))).status).toBe(200)
    expect(sc1()).toMatchObject({ signwell_status: 'completed', status: 'signed' })
    expect(sc1().signed_method).toBeUndefined()
  })

  test('declined / canceled / expired / bounced / error update signwell_status only', async () => {
    for (const [type, st] of [['document_declined', 'Declined'], ['document_canceled', 'Canceled'], ['document_expired', 'Expired'], ['document_bounced', 'Bounced'], ['document_error', 'Error']]) {
      seed(); sent()
      docs[DOC].status = st
      expect((await hook(event(type))).status).toBe(200)
      expect(sc1().signwell_status).toBe(SWS.mapSignwellStatus(st))
      expect(sc1()).toMatchObject({ status: 'active', signed_at: null, signed_contract_url: null })
    }
  })

  test('unknown event → 200 no-op without fetching; canceled is final for status events', async () => {
    sent()
    const r = await json(await hook(event('template_created')))
    expect(r.status).toBe(200)
    expect(r.body.ignored).toBe('event')
    expect(calls).toHaveLength(0)
    sc1().signwell_status = 'canceled'
    docs[DOC].status = 'Viewed'
    await hook(event('document_viewed'))
    expect(sc1().signwell_status).toBe('canceled')
  })

  test('webhook before migration 081 → 503, nothing written', async () => {
    sent()
    mockState.missingSelectCols = { subcontracts: ['signwell_document_id'] }
    expect((await hook(event('document_viewed'))).status).toBe(503)
  })
})

// ── webhook key lookup (prompt 98b) ─────────────────────────────────────────
const HA = '6ff542d5-590c-44b2-8131-7ae998e78c5b'
const HB = '35826895-d91f-49d9-a397-39955b7a5ac9'
const BYPASS = 'SECRETBYPASS0123456789'
const cb = (host = 'nv-construction.vercel.app', p = '/api/signwell/webhook') => `https://${host}${p}?x-vercel-protection-bypass=${BYPASS}`
const signedBy = (key, type = 'document_viewed', time = 1689332249) => event(type, { time, hash: sign(type, time, key) })
const hookCalls = () => calls.filter(c => c.url.endsWith('/api/v1/hooks')).length

describe('webhook key lookup without SIGNWELL_WEBHOOK_ID', () => {
  test('SIGNWELL_WEBHOOK_ID still wins: no lookup, looked-up ids not accepted', async () => {
    sent()
    hookList = [{ id: HA, callback_url: cb() }]
    expect((await hook(signedBy(HOOK))).status).toBe(200)
    expect((await hook(signedBy(HA))).status).toBe(401)
    expect(hookCalls()).toBe(0)
  })

  test('lookup: callback path matches ignoring host and query; X-Api-Key sent', async () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    sent()
    docs[DOC].status = 'Viewed'
    hookList = [{ id: HA, callback_url: cb('nv-construction-git-prompt98-nv.vercel.app') }]
    expect((await hook(signedBy(HA))).status).toBe(200)
    expect(sc1().signwell_status).toBe('viewed')
    const c = calls.find(x => x.url.endsWith('/api/v1/hooks'))
    expect(c).toMatchObject({ method: 'GET', url: 'https://www.signwell.com/api/v1/hooks' })
    expect(c.headers['X-Api-Key']).toBe(KEY)
  })

  test('non-matching paths (other path, sub-path, trailing slash, bad URL) are ignored', async () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    sent()
    hookList = [
      { id: HA, callback_url: cb(undefined, '/api/other') },
      { id: HB, callback_url: cb(undefined, '/api/signwell/webhook/extra') },
      { id: 'h3', callback_url: cb(undefined, '/api/signwell/webhook/') },
      { id: 'h4', callback_url: 'not a url' },
      { id: 'h5' },
    ]
    for (const k of [HA, HB, 'h3', 'h4', 'h5']) expect((await hook(signedBy(k))).status).toBe(401)
    expect(SWSrv.matchingHookIds(hookList)).toEqual([])
    expect(SWSrv.matchingHookIds([{ id: HA, callback_url: 'http://localhost:3000/api/signwell/webhook' }, { id: HA, callback_url: cb() }, null])).toEqual([HA])
    expect(sc1().signwell_status).toBe('sent')
  })

  test('multiple candidates: the second one verifies', async () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    sent()
    hookList = [{ id: HA, callback_url: cb('a.vercel.app') }, { id: 'other', callback_url: 'https://x.com/hook' }, { id: HB, callback_url: cb('b.vercel.app') }]
    expect((await hook(signedBy(HB))).status).toBe(200)
    expect((await hook(signedBy(HA))).status).toBe(200)
    expect(hookCalls()).toBe(1)
  })

  test('cached ~10 min; a failure refetches once (new hook), throttled; expiry refetches', async () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    sent()
    hookList = [{ id: HA, callback_url: cb() }]
    expect((await hook(signedBy(HA))).status).toBe(200)
    expect((await hook(signedBy(HA, 'document_viewed', 1689332250))).status).toBe(200)
    expect(hookCalls()).toBe(1) // cached
    hookList.push({ id: HB, callback_url: cb('preview.vercel.app') })
    expect((await hook(signedBy(HB))).status).toBe(200) // cache miss → one refetch → accepted
    expect(hookCalls()).toBe(2)
    expect((await hook(signedBy('forged'))).status).toBe(401)
    expect((await hook(signedBy('forged2'))).status).toBe(401)
    expect(hookCalls()).toBe(2) // refetch throttled: forged requests don't hit SignWell

    // direct: expiry and throttle window, with a controlled clock
    SWSrv.resetSignwellHookCache()
    calls.length = 0
    const t0 = 1_000_000_000_000
    const ev = signedBy(HA).event
    expect(await SWSrv.verifySignwellWebhook(ev, { now: t0 })).toBe(true)
    expect(await SWSrv.verifySignwellWebhook(ev, { now: t0 + SWSrv.SIGNWELL_HOOK_CACHE_MS - 1 })).toBe(true)
    expect(hookCalls()).toBe(1)
    expect(await SWSrv.verifySignwellWebhook(ev, { now: t0 + SWSrv.SIGNWELL_HOOK_CACHE_MS })).toBe(true)
    expect(hookCalls()).toBe(2)
    const bad = signedBy('nope').event
    const t1 = t0 + SWSrv.SIGNWELL_HOOK_CACHE_MS + 1000
    expect(await SWSrv.verifySignwellWebhook(bad, { now: t1 })).toBe(false) // one refetch
    expect(hookCalls()).toBe(3)
    expect(await SWSrv.verifySignwellWebhook(bad, { now: t1 + 1000 })).toBe(false) // throttled
    expect(hookCalls()).toBe(3)
    expect(await SWSrv.verifySignwellWebhook(bad, { now: t1 + SWSrv.SIGNWELL_HOOK_REFETCH_MIN_MS })).toBe(false)
    expect(hookCalls()).toBe(4)
    // malformed events never trigger a lookup
    SWSrv.resetSignwellHookCache()
    calls.length = 0
    expect(await SWSrv.verifySignwellWebhook({ type: 'x', time: 1, hash: 'zz' })).toBe(false)
    expect(await SWSrv.verifySignwellWebhook(null)).toBe(false)
    expect(hookCalls()).toBe(0)
  })

  test('no key → 401 without any request; no matching hook / list failure → 401', async () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    delete process.env.SIGNWELL_API_KEY
    sent()
    expect((await hook(signedBy(HA))).status).toBe(401)
    expect(calls).toHaveLength(0)
    process.env.SIGNWELL_API_KEY = KEY
    expect((await hook(signedBy(HA))).status).toBe(401) // no hooks at all
    fetchOverride = c => (c.url.endsWith('/hooks') ? res(500, { message: 'boom' }) : null)
    SWSrv.resetSignwellHookCache()
    expect((await hook(signedBy(HA))).status).toBe(401)
    fetchOverride = c => (c.url.endsWith('/hooks') ? res(401, { message: 'revoked' }) : null)
    SWSrv.resetSignwellHookCache()
    expect((await hook(signedBy(HA))).status).toBe(401)
    expect(sc1().signwell_status).toBe('sent')
  })

  test('nothing secret (key, hook ids, callback query) in responses or logs', async () => {
    const logged = []
    const spies = ['error', 'log', 'warn', 'info'].map(m => jest.spyOn(console, m).mockImplementation((...a) => { logged.push(a.map(String).join(' ')) }))
    try {
      delete process.env.SIGNWELL_WEBHOOK_ID
      sent()
      hookList = [{ id: HA, callback_url: cb() }, { id: HB, callback_url: cb('x.vercel.app', '/nope') }]
      const bodies = []
      for (const p of [signedBy(HA), signedBy(HB), signedBy('forged'), 'junk']) bodies.push(JSON.stringify((await json(await hook(p))).body))
      fetchOverride = c => (c.url.endsWith('/hooks') ? res(422, { message: `bad ${KEY} ${BYPASS} ${HA}` }) : null)
      SWSrv.resetSignwellHookCache()
      bodies.push(JSON.stringify((await json(await hook(signedBy(HA)))).body))
      const all = bodies.join('\n') + '\n' + logged.join('\n')
      for (const s of [KEY, HA, HB, BYPASS, 'x-vercel-protection-bypass']) expect(all).not.toContain(s)
      expect(logged.some(l => l.includes('no matching SignWell webhook'))).toBe(true)
    } finally {
      spies.forEach(s => s.mockRestore())
    }
  })
})

// ── office remind / void ────────────────────────────────────────────────────
const act = (action, id = SC1) => office.POST(req('/api/subcontracts/signwell', 'POST', { subcontract_id: id, action }))

describe('office remind / void', () => {
  test('GET exposes only booleans', async () => {
    const r = await json(await office.GET(req('/api/subcontracts/signwell', 'GET')))
    expect(r.body).toEqual({ enabled: true, test_mode: true })
    expect(JSON.stringify(r.body)).not.toContain(KEY)
    as('super')
    expect((await json(await office.GET(req('/api/subcontracts/signwell', 'GET')))).body).toEqual({ enabled: false, test_mode: false })
  })

  test('remind sends; void deletes the doc, sets canceled, keeps the status', async () => {
    sent()
    expect((await act('remind')).status).toBe(200)
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith(`/documents/${DOC}/remind`))).toBe(true)
    expect((await act('void')).status).toBe(200)
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith(`/documents/${DOC}`))).toBe(true)
    expect(sc1()).toMatchObject({ signwell_status: 'canceled', status: 'active' })
    // nothing open any more
    expect((await act('remind')).status).toBe(409)
    expect((await act('void')).status).toBe(409)
  })

  test('guards: super / sub 403, PM off the job 403, bad action 400, no key 409, before 081 409', async () => {
    sent()
    as('super'); expect((await act('remind')).status).toBe(403)
    as('subcontractor'); expect((await act('remind')).status).toBe(403)
    as('pm')
    Object.assign(mockState.db.subcontracts.find(r => r.id === SC2), { signwell_document_id: DOC, signwell_status: 'sent' })
    expect((await act('void', SC2)).status).toBe(403)
    expect((await act('void')).status).toBe(200) // PM on J1
    as('principal')
    expect((await act('nope')).status).toBe(400)
    delete process.env.SIGNWELL_API_KEY
    expect((await act('remind')).status).toBe(409)
    process.env.SIGNWELL_API_KEY = KEY
    mockState.missingSelectCols = { subcontracts: ['signwell_document_id'] }
    const r = await json(await act('remind'))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('migration_081')
    expect(calls.filter(c => c.url.includes('/remind'))).toHaveLength(0)
  })
})

describe('source checks', () => {
  test('migration 081 adds the four columns + index inside BEGIN/COMMIT', () => {
    const sql = read('supabase/migrations/081_subcontract_signwell.sql')
    for (const c of ['signwell_document_id text', 'signwell_status text', 'signwell_sent_at timestamptz', 'signwell_completed_at timestamptz']) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c}`)
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS subcontracts_signwell_document_id_idx ON public.subcontracts(signwell_document_id)')
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/)
  })

  test('the job page never imports the server client (key stays server-side)', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).not.toMatch(/lib\/signwell'/)
    expect(page).not.toContain('SIGNWELL_API_KEY')
    expect(page).toContain("from '../../lib/signwell-status'")
  })
})
