/**
 * Prompt 64: subcontract e-signing records the PERSON (not the company) as the
 * signer, collects their title at sign time, and writes name / title / date /
 * "on behalf of <company>" onto the contract's SUBCONTRACTOR lines and the
 * signature record. DB/storage/auth/Resend are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
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
jest.mock('../lib/roles', () => ({ denyJob: async () => null, denyJobOf: async () => null }))
jest.mock('../lib/sub-access', () => ({ canAccessSubcontract: async () => true, getSubContracts: async () => [] }))
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: async msg => { require('./helpers/mock-db').mockState.sent.push(msg); return { data: { id: 'em' }, error: null } } } } } }))

const initiate = require('../app/api/sub-initiate-sign/route')
const signingRoute = require('../app/api/signing-requests/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')
const { buildSubcontractHtml } = require('../lib/buildSubcontractHtml')
const { fillSubcontractSignatureLines } = require('../lib/generated-contract')

const SC = 'aaaaaaaa-0000-4000-8000-000000000064'
const jsonReq = (url, method, body) => new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const out = async r => ({ status: r.status, body: await r.json() })
const signPost = (token, body) => tokenRoute.POST(jsonReq(`http://x/api/signing-requests/${token}`, 'POST', body), { params: { token } }).then(out)
const reqFor = () => mockState.db.signing_requests.find(r => r.subcontract_id === SC)

function seed({ fullName = 'Jane Doe' } = {}) {
  resetMockState({
    jobs: [{ id: 'job1', job_number: '264', project_name: 'Proj', location: 'Longview' }],
    subcontracts: [{ id: SC, job_id: 'job1', sub_id: 'subuser', company_id: 'co1', vendor_name: 'JC Concreteworks LLC', description: 'Concrete', contract_value: 1000, status: 'active', signed_at: null, signed_contract_url: null }],
    profiles: [{ id: 'subuser', full_name: fullName }, { id: 'coworker', full_name: '  Bob Partner ' }],
    signing_requests: [],
  })
  mockState.defaults = { signing_requests: () => ({ status: 'pending', token: `tok-${Math.random().toString(36).slice(2)}` }) }
  mockState.sent = []
  mockState.auth = null
}

const F = { date: '11/09/2026', sub_name: 'JC Concreteworks LLC', sub_address: '', entity_type: 'llc', trade: 'Concrete', project_name: 'P', project_address: 'A', owner_name: 'O', owner_address: '', contract_amount: '1000', pay_pct: '100', scope_of_work: 's', job_number: '264', subcontract_number: '2026-264-001', pm_name: 'PM', superintendent: 'S', cover_letter_body: 'Body', contract_documents: 'Doc', scope_notes: 'Note' }

// Today's job-page / already-sent markup: same structure, no data-esign markers.
const UNMARKED = buildSubcontractHtml(F).replace(/ data-esign="[^"]*"/g, '')

const NV_COLUMN = html => html.slice(html.indexOf('<strong>NV Construction LLC</strong>'), html.indexOf('<strong>SUBCONTRACTOR:</strong>'))
const SUB_COLUMN = html => html.slice(html.indexOf('<strong>SUBCONTRACTOR:</strong>'), html.indexOf('Federal I.D.'))
const COVER = html => html.slice(0, html.indexOf('<!-- SUBCONTRACT AGREEMENT -->'))

describe('A) person, not company, as signer_name', () => {
  test('sub-initiate-sign stores profiles.full_name, never the vendor_name', async () => {
    seed()
    mockState.auth = { userId: 'subuser', role: 'subcontractor', companyId: 'co1' }
    const r = await out(await initiate.POST(jsonReq('http://x', 'POST', { subcontract_id: SC })))
    expect(r.status).toBe(200)
    expect(reqFor().signer_name).toBe('Jane Doe')
    expect(reqFor().signer_name).not.toBe('JC Concreteworks LLC')
    expect(reqFor().document_html).toContain('JC Concreteworks LLC') // the company stays on the contract
  })
  test('a company-permissioned user signs under their own name', async () => {
    seed()
    mockState.auth = { userId: 'coworker', role: 'sub_admin', companyId: 'co1' }
    expect((await initiate.POST(jsonReq('http://x', 'POST', { subcontract_id: SC }))).status).toBe(200)
    expect(reqFor().signer_name).toBe('Bob Partner')
  })
  test('blank full_name stores null (not the company); signing then accepts any typed name + title', async () => {
    seed({ fullName: '   ' })
    mockState.auth = { userId: 'subuser', role: 'subcontractor', companyId: 'co1' }
    const r = await out(await initiate.POST(jsonReq('http://x', 'POST', { subcontract_id: SC })))
    expect(r.status).toBe(200)
    expect(reqFor().signer_name).toBeNull()
    mockState.auth = null
    const s = await signPost(r.body.token, { signature_text: 'Any Person', signer_title: 'Owner' })
    expect(s.status).toBe(200)
    expect(reqFor().status).toBe('signed')
  })
  test('POST /api/signing-requests requires signer_name (400), no company fallback', async () => {
    seed()
    mockState.auth = { userId: 'pm1', role: 'pm' }
    for (const signer_name of [undefined, '', '   ']) {
      const r = await out(await signingRoute.POST(jsonReq('http://x', 'POST', { job_id: 'job1', subcontract_id: SC, signer_email: 'a@b.com', signer_name, document_html: '<p>x</p>' })))
      expect(r.status).toBe(400)
    }
    expect(mockState.db.signing_requests).toHaveLength(0)
    expect(mockState.sent).toHaveLength(0)
    const ok = await out(await signingRoute.POST(jsonReq('http://x', 'POST', { job_id: 'job1', subcontract_id: SC, signer_email: 'a@b.com', signer_name: '  Jane Doe ', document_html: '<p>x</p>' })))
    expect(ok.status).toBe(200)
    expect(reqFor().signer_name).toBe('Jane Doe')
  })
  test('job page: no fallback to the company and Send Link needs a name', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/jobdetail/page.js'), 'utf8')
    const fn = src.slice(src.indexOf('async function sendForESign()'), src.indexOf('// ── Change Orders'))
    expect(fn).not.toContain('signerName.trim() || contractGenForm.sub_name')
    expect(fn).not.toMatch(/signer_name:[^\n]*(contractGenForm\.sub_name|vendor_name)/)
    expect(fn).toMatch(/signer_name: signerName\.trim\(\),/)
    expect(fn).toMatch(/if \(!signerName\.trim\(\)\)/)
    expect(src).toMatch(/disabled=\{!signerName\.trim\(\) \|\| !signerEmail\.trim\(\) \|\| sendingSign\}/)
    expect(src).toContain('placeholder="Recipient\'s full legal name"')
  })
})

describe('D) filling the contract signature lines', () => {
  const sig = { signature_text: 'Jane Doe', signer_title: 'Managing Member', signed_at: '2026-11-10T03:30:00.000Z', company_name: 'JC Concreteworks LLC' }
  // 03:30Z on 11/10 is still 11/9 in Chicago
  test.each([['marked (lib builder)', buildSubcontractHtml(F)], ['unmarked (job page / already sent)', UNMARKED]])('%s', (_, html) => {
    const filled = fillSubcontractSignatureLines(html, sig)
    // cover letter box
    expect(COVER(filled)).toMatch(/height:24px[^>]*><span[^>]*>Jane Doe<\/span><\/div>\s*<div style="font-size:9pt">Subcontractor Signature<\/div>/)
    expect(COVER(filled)).toContain('Jane Doe, Managing Member &mdash; on behalf of JC Concreteworks LLC')
    // SUBCONTRACTOR column
    const sub = SUB_COLUMN(filled)
    expect(sub).toMatch(/width:190px"><span[^>]*>Jane Doe<\/span><\/span>/)
    expect(sub).toMatch(/width:110px">Managing Member<\/span>/)
    expect(sub).toMatch(/width:80px">11\/9\/2026<\/span>/)
    expect(sub).toContain('on behalf of JC Concreteworks LLC')
    // NV Construction LLC column untouched
    expect(NV_COLUMN(filled)).toBe(NV_COLUMN(html))
    expect(NV_COLUMN(filled)).toContain('<span class="sig-line" style="width:130px"></span>')
    expect(NV_COLUMN(filled)).toContain('<span class="sig-line" style="width:90px"></span>')
    expect(NV_COLUMN(filled)).not.toMatch(/Jane Doe|Managing Member|11\/9\/2026/)
    // Federal I.D. onward (phone, e-mail, initials, competent-person form) untouched
    expect(filled.slice(filled.indexOf('Federal I.D.'))).toBe(html.slice(html.indexOf('Federal I.D.')))
  })
  test('escapes name, title and company', () => {
    const filled = fillSubcontractSignatureLines(UNMARKED, { signature_text: '<script>n</script>', signer_title: '<b>T</b>', signed_at: '2026-11-09T15:00:00Z', company_name: 'A & <img src=x>' })
    expect(filled).not.toMatch(/<script>n<\/script>|<b>T<\/b>|<img src=x>/)
    expect(filled).toContain('&lt;script&gt;n&lt;/script&gt;')
    expect(filled).toContain('&lt;b&gt;T&lt;/b&gt;')
    expect(filled).toContain('on behalf of A &amp; &lt;img src=x&gt;')
  })
  test('no company: no "on behalf of"; no name: unchanged', () => {
    const filled = fillSubcontractSignatureLines(UNMARKED, { ...sig, company_name: null })
    expect(filled).not.toContain('data-esign-filled="sub-on-behalf"')
    expect(filled).not.toMatch(/&mdash; on behalf of/)
    expect(SUB_COLUMN(filled)).toContain('Managing Member')
    expect(fillSubcontractSignatureLines(UNMARKED, { ...sig, signature_text: ' ' })).toBe(UNMARKED)
  })
})

describe('C) token POST for subcontracts', () => {
  const seedRequest = (signer_name = 'Jane Doe', html = UNMARKED) => {
    seed()
    mockState.db.signing_requests.push({ id: 'sr64', token: 'tok64', job_id: 'job1', subcontract_id: SC, signer_email: 'jane@x.test', signer_name, document_title: 'Subcontract', document_html: html, status: 'pending' })
  }
  test('missing title: 400 and the request stays pending', async () => {
    seedRequest()
    for (const body of [{ signature_text: 'Jane Doe' }, { signature_text: 'Jane Doe', signer_title: '   ' }]) {
      const r = await signPost('tok64', body)
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/Title is required/)
    }
    expect(reqFor().status).toBe('pending')
    expect(mockState.db.subcontracts[0].signed_contract_url).toBeNull()
    expect(mockState.sent).toHaveLength(0)
  })
  test('legacy request that stored the company still needs the exact company string', async () => {
    seedRequest('JC Concreteworks LLC')
    expect((await signPost('tok64', { signature_text: 'Jane Doe', signer_title: 'Owner' })).status).toBe(400)
    expect((await signPost('tok64', { signature_text: 'jc concreteworks llc', signer_title: 'Owner' })).status).toBe(200)
  })
  test.each([['unmarked', UNMARKED], ['marked', buildSubcontractHtml(F)]])('name + title: stored %s HTML has filled lines and a certificate with title + on behalf of', async (_, html) => {
    seedRequest('Jane Doe', html)
    const r = await signPost('tok64', { signature_text: ' jane doe ', signer_title: ' President ', signer_ip: '1.2.3.4' })
    expect(r.status).toBe(200)
    const row = reqFor()
    expect(row.status).toBe('signed')
    expect(row).not.toHaveProperty('signer_title')
    expect(mockState.calls.filter(c => c.table === 'signing_requests').some(c => 'signer_title' in (c.payload || {}))).toBe(false)
    const p = mockState.db.subcontracts[0].signed_contract_url
    expect(p).toMatch(new RegExp(`^contracts/${SC}/esigned-`))
    const stored = mockState.files[`documents/${p}`].toString('utf8')
    expect(SUB_COLUMN(stored)).toMatch(/width:190px"><span[^>]*>jane doe<\/span>/)
    expect(SUB_COLUMN(stored)).toMatch(/width:110px">President<\/span>/)
    expect(SUB_COLUMN(stored)).toMatch(/width:80px">\d{1,2}\/\d{1,2}\/\d{4}<\/span>/)
    expect(SUB_COLUMN(stored)).toContain('on behalf of JC Concreteworks LLC')
    expect(NV_COLUMN(stored)).toBe(NV_COLUMN(html))
    const cert = stored.slice(stored.indexOf('Electronic Signature Record'))
    expect(cert).toMatch(/Signed by<\/td><td[^>]*>Jane Doe</)
    expect(cert).toMatch(/Title<\/td><td[^>]*>President</)
    expect(cert).toMatch(/On behalf of<\/td><td[^>]*>JC Concreteworks LLC</)
    expect(cert).toContain(' CT')
    expect(mockState.sent.map(m => m.subject)).toEqual(['Signed: Subcontract', 'Jane Doe signed: Subcontract'])
    expect(mockState.sent[0].html).toContain('Jane Doe, President on behalf of JC Concreteworks LLC')
  })
  test('subcontract read fails: still signs, no "on behalf of"', async () => {
    seedRequest()
    mockState.failSelect.subcontracts = 'boom'
    const r = await signPost('tok64', { signature_text: 'Jane Doe', signer_title: 'Owner' })
    expect(r.status).toBe(200)
    const stored = mockState.files[`documents/${mockState.db.subcontracts[0].signed_contract_url}`].toString('utf8')
    expect(stored).not.toContain('On behalf of')
    expect(stored).not.toContain('data-esign-filled="sub-on-behalf"')
    expect(SUB_COLUMN(stored)).toMatch(/width:110px">Owner<\/span>/)
    expect(stored).toMatch(/Title<\/td><td[^>]*>Owner</)
  })
  test('GET exposes the company for "Signing on behalf of"', async () => {
    seedRequest()
    const g = await out(await tokenRoute.GET(new Request('http://x?html=1'), { params: { token: 'tok64' } }))
    expect(g.body.data.company_name).toBe('JC Concreteworks LLC')
    expect(g.body.data.document_kind).toBeUndefined()
  })
})

describe('B) sign page source', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/sign/page.js'), 'utf8')
  test('title is required for non-PDF documents and sent as signer_title; MB posts stay name-only', () => {
    expect(src).toMatch(/const titleRequired = !!request && request\.document_kind !== 'pdf'/)
    expect(src).toMatch(/signer_title: sigTitle\.trim\(\)/)
    expect(src).toContain('{ signature_text: sigText.trim(), signer_ip }')
    expect(src).toMatch(/disabled=\{!canSubmit \|\| submitting\}/)
    expect(src).toMatch(/const canSubmit = !!sigText\.trim\(\) && \(!titleRequired \|\| !!sigTitle\.trim\(\)\) && agreed/)
  })
})
