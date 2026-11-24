/**
 * Prompt 103: multiple subcontract exhibits (C, D, …), the exhibit list in the contract body,
 * PDF / image-only proposals. Peyton 11/24: "Peyton wants PDFs to show as exhibits".
 *  - lib/subcontract-exhibits.js: file types, saved-list sanitizer, lettering, contract list HTML,
 *    warnings, merge order A, B, C, D.
 *  - lib/subcontract-exhibits-server.js: extras only from this job's documents, re-lettering,
 *    unreadable extras, 100 MB merge guard.
 *  - PUT /api/subcontracts { exhibits }, bid_proposal_url type check (new / changed only).
 *  - /api/signing-requests: unreadable extra → 502 with its letter; SignWell 25 MB → 413.
 *  - SignWell file name "Exhibits A-D"; sub-initiate-sign lists the exhibits in the contract.
 * DB/auth/storage/fetch are mocked; nothing live.
 */
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

const X = require('../lib/subcontract-exhibits')
const XS = require('../lib/subcontract-exhibits-server')
const { buildSignwellPacket } = require('../lib/signwell-packet')
const { buildSubcontractHtml } = require('../lib/buildSubcontractHtml')
const { docCategoryLabel, isJobDocCategory } = require('../lib/job-docs')
const subcontracts = require('../app/api/subcontracts/route')
const exhibitsRoute = require('../app/api/subcontract-exhibits/route')
const signingRoute = require('../app/api/signing-requests/route')
const subInitiate = require('../app/api/sub-initiate-sign/route')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const D_PLANS = 'dddddddd-0000-4000-8000-000000000001'
const D_SPECS = 'dddddddd-0000-4000-8000-000000000002'
const D_GEO = 'dddddddd-0000-4000-8000-000000000003'
const D_OTHERJOB = 'dddddddd-0000-4000-8000-000000000004'
const D_BILLING = 'dddddddd-0000-4000-8000-000000000005'
const D_DOCX = 'dddddddd-0000-4000-8000-000000000006'
const D_OUTSIDE = 'dddddddd-0000-4000-8000-000000000007'
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const json = async r => ({ status: r.status, body: await r.json() })

async function pdfOfPages(n, size = [300, 400]) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage(size)
  return Buffer.from(await d.save())
}
// A JPEG pdf-lib embeds as-is (SOI + SOF0 1×1, 3 channels) followed by `pad` bytes.
const bigJpeg = pad => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]), Buffer.alloc(pad)])

const doc = (id, category, name, job = J1, extra = {}) => ({ id, job_id: job, category, file_name: name, storage_path: `${job}/${category}/1-${name}`, uploaded_at: '2026-11-20T10:00:00Z', ...extra })
const DOCS = [
  doc(D_PLANS, 'plans', 'plans.pdf'),
  doc(D_SPECS, 'specs', 'specs.pdf'),
  doc(D_GEO, 'geotech', 'soil.png'),
  doc(D_OTHERJOB, 'plans', 'theirs.pdf', J2),
  doc(D_BILLING, 'billing_schedule', 'sched.pdf'),
  doc(D_DOCX, 'specs', 'specs.docx'),
  doc(D_OUTSIDE, 'plans', 'outside.pdf', J1, { storage_path: `${J2}/plans/outside.pdf` }),
]
const ex = (id, title = '', source = 'job_document') => ({ job_document_id: id, title, source })

function seed({ gf = null, sc = {}, docs = DOCS } = {}) {
  resetMockState({
    jobs: [{ id: J1, pm_email: 'pm@nv.com', job_number: '7469', project_name: 'Braum Longview', location: 'Longview' }, { id: J2, pm_email: 'other@nv.com' }],
    pm_job_assignments: [],
    subcontracts: [
      { id: SC1, job_id: J1, sub_id: 'subuser', company_id: 'co1', vendor_name: 'Acme Plumbing', description: 'Plumbing', status: 'active', contract_value: 12500, signed_at: null, signed_contract_url: null, bid_proposal_url: `bid-proposals/${J1}/1700.pdf`, generator_fields: gf, signwell_document_id: null, signwell_status: null, ...sc },
    ],
    job_documents: docs.map(d => ({ ...d })),
    signing_requests: [],
    profiles: [{ id: 'subuser', full_name: 'Jane Doe' }],
    sub_directory: [],
    change_log: [],
  })
}
async function putFiles() {
  mockState.files[`prime-contracts/bid-proposals/${J1}/1700.pdf`] = await pdfOfPages(2)
  mockState.files[`job-documents/${J1}/billing_schedule/1-sched.pdf`] = await pdfOfPages(1)
  mockState.files[`job-documents/${J1}/plans/1-plans.pdf`] = await pdfOfPages(3)
  mockState.files[`job-documents/${J1}/specs/1-specs.pdf`] = await pdfOfPages(1)
  mockState.files[`job-documents/${J1}/geotech/1-soil.png`] = PNG_1PX
}
const sc1 = () => mockState.db.subcontracts.find(r => r.id === SC1)

// ── 1. pure helpers ───────────────────────────────────────────────────────────
describe('exhibitFileTypeError', () => {
  test('pdf / png / jpg / jpeg ok (any case); docx, heic, dwg, xlsx, no extension refused', () => {
    for (const n of ['a.pdf', 'b.PNG', 'c.jpg', 'd.JPEG', 'dir/x.y.pdf']) expect([n, X.exhibitFileTypeError(n)]).toEqual([n, null])
    for (const n of ['a.docx', 'b.heic', 'c.dwg', 'd.xlsx', 'noext', '', null, 'pdf', '.pdf']) {
      expect([n, X.exhibitFileTypeError(n)]).toEqual([n, 'Exhibits must be a PDF or a JPG/PNG image. Save Word, Excel, HEIC or drawing files as PDF first.'])
    }
  })
  test('MIME is only a second check', () => {
    expect(X.exhibitFileTypeError('a.pdf', 'application/pdf')).toBeNull()
    expect(X.exhibitFileTypeError('a.jpg', '')).toBeNull()
    expect(X.exhibitFileTypeError('a.png', 'application/octet-stream')).toBeNull()
    expect(X.exhibitFileTypeError('a.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toMatch(/PDF or a JPG\/PNG/)
    expect(X.exhibitFileTypeError('a.docx', 'application/pdf')).toMatch(/PDF or a JPG\/PNG/)
  })
})

describe('sanitizeExhibitList', () => {
  test('non-array → null; bad ids, unknown keys (letter, path, url, bucket), duplicates dropped', () => {
    expect(X.sanitizeExhibitList('x')).toBeNull()
    expect(X.sanitizeExhibitList({})).toBeNull()
    expect(X.sanitizeExhibitList(null)).toBeNull()
    const out = X.sanitizeExhibitList([
      { job_document_id: D_PLANS.toUpperCase(), title: '  Plans  set ', source: 'job_document', letter: 'C', path: 'x/y.pdf', url: 'https://evil', bucket: 'documents' },
      { job_document_id: 'not-a-uuid', title: 'x' },
      { job_document_id: D_PLANS, title: 'dupe' },
      { job_document_id: D_SPECS, title: 42, source: 'hack' },
      null, 'str', [D_GEO],
      { job_document_id: D_GEO, source: 'upload' },
    ])
    expect(out).toEqual([
      { job_document_id: D_PLANS, title: 'Plans set', source: 'job_document' },
      { job_document_id: D_SPECS, title: '', source: 'job_document' },
      { job_document_id: D_GEO, title: '', source: 'upload' },
    ])
  })
  test('caps at 10 and titles at 120 chars', () => {
    const many = Array.from({ length: 14 }, (_, i) => ex(`dddddddd-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, 'T'.repeat(300)))
    const out = X.sanitizeExhibitList(many)
    expect(out).toHaveLength(X.MAX_EXTRA_EXHIBITS)
    expect(X.MAX_EXTRA_EXHIBITS).toBe(10)
    expect(out[0].title).toHaveLength(120)
  })
})

describe('lettering + contract list', () => {
  test('extraExhibitLetter: 0 → C', () => {
    expect([0, 1, 9].map(X.extraExhibitLetter)).toEqual(['C', 'D', 'L'])
  })
  test('A / B only when included; extras always start at C, no gaps', () => {
    const extras = [{ title: 'Plans' }, { title: 'Specifications' }]
    expect(X.exhibitListForContract({ proposal: true, billing: true, extras })).toEqual([
      { letter: 'A', title: 'Subcontractor Proposal' }, { letter: 'B', title: 'Billing Schedule' },
      { letter: 'C', title: 'Plans' }, { letter: 'D', title: 'Specifications' },
    ])
    expect(X.exhibitListForContract({ proposal: false, billing: false, extras }).map(e => e.letter)).toEqual(['C', 'D'])
    expect(X.exhibitListForContract({ proposal: false, billing: true, extras: [] }).map(e => e.letter)).toEqual(['B'])
    expect(X.exhibitListForContract({})).toEqual([])
  })
  test('exhibitListHtml: empty → "", titles escaped', () => {
    expect(X.exhibitListHtml([])).toBe('')
    expect(X.exhibitListHtml(null)).toBe('')
    const h = X.exhibitListHtml([{ letter: 'A', title: 'Subcontractor Proposal' }, { letter: 'C', title: 'Plans <script>alert(1)</script> & "specs"' }])
    expect(h).toBe('<p><strong>EXHIBITS:</strong><br>Exhibit A – Subcontractor Proposal<br>Exhibit C – Plans &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;specs&quot;</p>')
  })
  test('both contract builders put the list right after CONTRACT DOCUMENTS', () => {
    const F = { sub_name: 'Acme', contract_amount: '100', job_number: '7469', subcontract_number: '2026-7469-001', pay_pct: '100', contract_documents: 'Subcontractor Proposal' }
    const html = buildSubcontractHtml({ ...F, exhibit_list: [{ letter: 'C', title: 'Plans' }] })
    expect(html.indexOf('CONTRACT DOCUMENTS:')).toBeLessThan(html.indexOf('Exhibit C – Plans'))
    expect(html.indexOf('Exhibit C – Plans')).toBeLessThan(html.indexOf('SUBMITTALS'))
    expect(buildSubcontractHtml(F)).not.toContain('EXHIBITS:')
    const page = read('app/jobdetail/page.js')
    expect(page).toMatch(/<p>\$\{contractDocLines\}<\/p>\n {2}\$\{exhibitListHtml\(f\.exhibit_list \|\| \[\]\)\}/)
  })
})

describe('warnings', () => {
  const billingDoc = { storage_path: `${J1}/billing_schedule/1-s.pdf` }
  test('a missing extra warns by title; A/B behavior unchanged; include.extras true', () => {
    const msgs = []
    const r = X.confirmExhibits({ proposalPath: 'x.pdf', billingDoc, extras: [{ title: 'Plans', missing: true }, { title: 'Specs', missing: false }] }, m => { msgs.push(m); return true })
    expect(r).toMatchObject({ proceed: true, include: { proposal: true, billing: true, extras: true } })
    expect(msgs[0]).toContain('Exhibit "Plans" is no longer in this job\'s documents')
    expect(msgs[0]).not.toContain('Specs')
    const none = jest.fn()
    expect(X.confirmExhibits({ proposalPath: 'x.pdf', billingDoc, extras: [{ title: 'Specs' }] }, none)).toMatchObject({ proceed: true })
    expect(none).not.toHaveBeenCalled()
    expect(X.exhibitWarnings({}).map(w => w.message)).toEqual(['Exhibit A proposal not uploaded', 'Exhibit B billing schedule not set for this job'])
    const typed = X.exhibitWarnings({ proposalPath: 'x.pdf', billingDoc, extras: [{ title: 'Old', typeError: 'nope' }] })
    expect(typed.map(w => w.message)).toEqual(['Exhibit "Old": nope'])
  })
  test('a .docx proposal warns but stays included', () => {
    const msgs = []
    const r = X.confirmExhibits({ proposalPath: 'bid-proposals/j/1.docx', billingDoc }, m => { msgs.push(m); return true })
    expect(msgs[0]).toContain('Exhibit A proposal is not a PDF or image (re-upload it as PDF)')
    expect(r.include.proposal).toBe(true)
    expect(X.confirmExhibits({ proposalPath: 'bid-proposals/j/1.docx', billingDoc }, () => false).proceed).toBe(false)
  })
})

// ── 2. merge order ────────────────────────────────────────────────────────────
describe('buildExhibitsPdf with extras', () => {
  test('order A, B, C, D whatever the input order; page count; included_exhibits letters', async () => {
    const C = { key: `extra:${D_PLANS}`, letter: 'C', title: 'Plans' }
    const D = { key: `extra:${D_GEO}`, letter: 'D', title: 'Geotech' }
    const out = await X.buildExhibitsPdf([
      { exhibit: C, file: { name: 'plans.pdf', bytes: await pdfOfPages(2) } },
      { exhibit: X.EXHIBIT_B, file: { name: 's.pdf', bytes: await pdfOfPages(1) } },
      { exhibit: D, file: { name: 'soil.png', bytes: PNG_1PX } },
      { exhibit: X.EXHIBIT_A, file: { name: 'p.pdf', bytes: await pdfOfPages(1, [200, 200]) } },
    ])
    expect(out.included).toEqual(['proposal', 'billing', `extra:${D_PLANS}`, `extra:${D_GEO}`])
    expect(out.included_exhibits.map(e => e.letter)).toEqual(['A', 'B', 'C', 'D'])
    expect(out.included_exhibits[2]).toEqual({ key: `extra:${D_PLANS}`, letter: 'C', title: 'Plans' })
    const pdf = await PDFDocument.load(out.bytes)
    // A: cover + 1, B: cover + 1, C: cover + 2, D: cover + image page
    expect(pdf.getPageCount()).toBe(2 + 2 + 3 + 2)
    expect([Math.round(pdf.getPage(1).getWidth())]).toEqual([200])
  })
})

// ── 3. server: status + build ─────────────────────────────────────────────────
describe('exhibitStatus / buildAndStoreExhibits', () => {
  const admin = () => require('@supabase/supabase-js').createClient()
  test('extras only from this job’s documents inside "<job_id>/"; saved order; default title from category', async () => {
    seed({ gf: { exhibits: [ex(D_SPECS), ex(D_OTHERJOB, 'Theirs'), ex(D_OUTSIDE, 'Outside'), ex(D_PLANS, 'Plan set'), ex(D_DOCX, 'Word')] } })
    const st = await XS.exhibitStatus(admin(), sc1())
    expect(st.extras.map(e => [e.id, e.title, e.missing])).toEqual([
      [D_SPECS, docCategoryLabel('specs'), false],
      [D_OTHERJOB, 'Theirs', true],
      [D_OUTSIDE, 'Outside', true],
      [D_PLANS, 'Plan set', false],
      [D_DOCX, 'Word', false],
    ])
    expect(st.extras[0].title).toBe('Specifications')
    expect(st.extras[1].path).toBeNull()
    expect(st.extras[2].path).toBeNull()
    expect(st.extras[4].typeError).toMatch(/PDF or a JPG\/PNG/)
  })

  test('missing / wrong-type extras skipped and the rest re-lettered C, D; cover pages + list', async () => {
    seed({ gf: { exhibits: [ex(D_OTHERJOB, 'Gone'), ex(D_PLANS, 'Plans'), ex(D_DOCX, 'Word'), ex(D_GEO, 'Soil')] } })
    await putFiles()
    const out = await XS.buildAndStoreExhibits(admin(), sc1(), { subtitle: 'Acme' })
    expect(out.error).toBeNull()
    expect(out.included_exhibits.map(e => [e.letter, e.title])).toEqual([['A', 'Subcontractor Proposal'], ['B', 'Billing Schedule'], ['C', 'Plans'], ['D', 'Soil']])
    expect(out.unreadable).toEqual([])
    expect(out.appendix).toContain('Exhibit C – Plans')
    expect(out.appendix).toContain('Exhibit D – Soil')
    expect(out.appendix).not.toContain('Gone')
    expect(X.exhibitsPathFromHtml(out.appendix, SC1)).toBe(out.path)
    // the appendix shape still lets withExhibitAppendix replace it
    const twice = X.withExhibitAppendix(X.withExhibitAppendix('<html><body>C</body></html>', out.appendix), out.appendix)
    expect(twice.match(/class="nv-exhibits"/g)).toHaveLength(1)
    expect((await PDFDocument.load(mockState.files[`documents/${out.path}`])).getPageCount()).toBe(3 + 2 + 4 + 2)
    // extras: false leaves them all out
    const ab = await XS.buildAndStoreExhibits(admin(), sc1(), { include: { proposal: true, billing: true, extras: false }, at: new Date('2026-11-24T00:00:00Z') })
    expect(ab.included).toEqual(['proposal', 'billing'])
  })

  test('an extra that cannot be downloaded is reported with its letter', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans'), ex(D_SPECS, 'Specs')] } })
    await putFiles()
    delete mockState.files[`job-documents/${J1}/specs/1-specs.pdf`]
    const out = await XS.buildAndStoreExhibits(admin(), sc1(), {})
    expect(out.unreadable).toEqual([{ key: `extra:${D_SPECS}`, letter: 'D', name: 'specs.pdf' }])
    expect(out.included_exhibits.map(e => e.letter)).toEqual(['A', 'B', 'C'])
  })

  test('over 100 MB of source files: stops, nothing stored', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans'), ex(D_SPECS, 'Specs')] }, sc: { bid_proposal_url: null } })
    mockState.files[`job-documents/${J1}/billing_schedule/1-sched.pdf`] = Buffer.alloc(30 * 1024 * 1024)
    mockState.files[`job-documents/${J1}/plans/1-plans.pdf`] = Buffer.alloc(40 * 1024 * 1024)
    mockState.files[`job-documents/${J1}/specs/1-specs.pdf`] = Buffer.alloc(40 * 1024 * 1024)
    const out = await XS.buildAndStoreExhibits(admin(), sc1(), {})
    expect(out.path).toBeNull()
    expect(out.code).toBe('too_large')
    expect(out.error).toBe('The exhibits are too large to merge into one PDF (over 100 MB). Remove or shrink an exhibit.')
    expect(Object.keys(mockState.files).some(k => k.startsWith('documents/'))).toBe(false)
    // the route answers 413 with the same message
    as('principal')
    const r = await json(await exhibitsRoute.POST(req('/api/subcontract-exhibits', 'POST', { subcontract_id: SC1 })))
    expect(r.status).toBe(413)
    expect(r.body.error).toMatch(/over 100 MB/)
  })

  test('status route lists extras without paths', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans'), ex(D_OTHERJOB, 'Theirs')] } })
    as('principal')
    const r = await json(await exhibitsRoute.GET(req(`/api/subcontract-exhibits?subcontract_id=${SC1}&kind=status`, 'GET')))
    expect(r.body.extras).toEqual([{ title: 'Plans', name: 'plans.pdf', missing: false }, { title: 'Theirs', name: '', missing: true }])
    expect(JSON.stringify(r.body)).not.toContain(`${J1}/plans`)
  })
})

// ── 4. PUT /api/subcontracts exhibits ─────────────────────────────────────────
describe('PUT /api/subcontracts { exhibits }', () => {
  const put = body => subcontracts.PUT(req('/api/subcontracts', 'PUT', body))
  beforeEach(() => { seed({ gf: { owner_name: 'Owner Co', saved_at: '2026-11-20T00:00:00Z' } }); as('principal') })

  test('saved in order (sanitized), text fields kept', async () => {
    const r = await json(await put({ id: SC1, exhibits: [ex(D_SPECS, 'Specs', 'upload'), { ...ex(D_PLANS, 'Plans'), letter: 'Z', path: 'x' }] }))
    expect(r.status).toBe(200)
    expect(sc1().generator_fields).toEqual({
      owner_name: 'Owner Co', saved_at: '2026-11-20T00:00:00Z',
      exhibits: [ex(D_SPECS, 'Specs', 'upload'), ex(D_PLANS, 'Plans')],
    })
  })
  test('non-array → 400; doc from another job / outside the folder / billing schedule / .docx → 400, nothing written', async () => {
    expect((await json(await put({ id: SC1, exhibits: { a: 1 } }))).body.error).toBe('exhibits must be a list.')
    for (const [id, re] of [[D_OTHERJOB, /not a document on this job/], [D_OUTSIDE, /not a document on this job/], [D_BILLING, /already Exhibit B/], [D_DOCX, /specs\.docx.*PDF or a JPG\/PNG/], ['dddddddd-0000-4000-8000-000000000999', /not a document on this job/]]) {
      const r = await json(await put({ id: SC1, exhibits: [ex(D_PLANS), ex(id)] }))
      expect([id, r.status]).toEqual([id, 400])
      expect(r.body.error).toMatch(re)
    }
    expect(mockState.calls.filter(c => c.table === 'subcontracts')).toEqual([])
  })
  test('text-only save keeps existing exhibits; exhibits-only save keeps text fields; both together', async () => {
    await put({ id: SC1, exhibits: [ex(D_PLANS, 'Plans')] })
    await put({ id: SC1, generator_fields: { owner_name: 'New Owner' } })
    expect(sc1().generator_fields).toEqual({ owner_name: 'New Owner', exhibits: [ex(D_PLANS, 'Plans')] })
    await put({ id: SC1, exhibits: [] })
    expect(sc1().generator_fields).toEqual({ owner_name: 'New Owner', exhibits: [] })
    await put({ id: SC1, generator_fields: { scope_of_work: 'S' }, exhibits: [ex(D_GEO, 'Soil')] })
    expect(sc1().generator_fields).toEqual({ scope_of_work: 'S', exhibits: [ex(D_GEO, 'Soil')] })
  })
  test('text-only save with no saved exhibits writes no exhibits key', async () => {
    await put({ id: SC1, generator_fields: { owner_name: 'O' } })
    expect(sc1().generator_fields).toEqual({ owner_name: 'O' })
  })
  test('allowed on a signed contract; PM off the job 403; sub 403', async () => {
    Object.assign(sc1(), { status: 'signed', signed_at: '2026-11-01T00:00:00Z' })
    expect((await put({ id: SC1, exhibits: [ex(D_PLANS)] })).status).toBe(200)
    mockState.auth = { userId: 'u-x', email: 'x@nv.com', role: 'pm', error: null }
    expect((await put({ id: SC1, exhibits: [] })).status).toBe(403)
    as('subcontractor')
    expect((await put({ id: SC1, exhibits: [] })).status).toBe(403)
  })
})

describe('bid_proposal_url must be a PDF / image when new or changed', () => {
  const put = body => subcontracts.PUT(req('/api/subcontracts', 'PUT', body))
  beforeEach(() => { seed({ sc: { bid_proposal_url: `bid-proposals/${J1}/old.docx` } }); as('principal') })
  test('POST with a .docx → 400; with a .pdf → ok', async () => {
    const base = { job_id: J1, vendor_name: 'New Co', contract_value: 1, status: 'draft' }
    const bad = await json(await subcontracts.POST(req('/api/subcontracts', 'POST', { ...base, bid_proposal_url: `bid-proposals/${J1}/2.docx` })))
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/Bid proposal: Exhibits must be a PDF/)
    expect((await subcontracts.POST(req('/api/subcontracts', 'POST', { ...base, bid_proposal_url: `bid-proposals/${J1}/2.pdf` }))).status).toBe(200)
  })
  test('PUT: unchanged .docx still saves; a new .docx is refused; a new .jpg saves', async () => {
    expect((await put({ id: SC1, bid_proposal_url: `bid-proposals/${J1}/old.docx`, onedrive_url: 'https://x' })).status).toBe(200)
    expect(sc1().onedrive_url).toBe('https://x')
    const r = await json(await put({ id: SC1, bid_proposal_url: `bid-proposals/${J1}/new.docx` }))
    expect(r.status).toBe(400)
    expect(sc1().bid_proposal_url).toBe(`bid-proposals/${J1}/old.docx`)
    expect((await put({ id: SC1, bid_proposal_url: `bid-proposals/${J1}/new.jpg` })).status).toBe(200)
  })
})

// ── 5. signing-requests ───────────────────────────────────────────────────────
describe('/api/signing-requests with extras', () => {
  const F = { sub_name: 'Acme', contract_amount: '100', job_number: '7469', subcontract_number: '2026-7469-001', pay_pct: '100' }
  const body = extra => ({ job_id: J1, subcontract_id: SC1, signer_email: 'jane@acme.com', signer_name: 'Jane Doe', document_html: buildSubcontractHtml(F, 'https://p'), document_title: 'Subcontract', ...extra })
  const send = b => signingRoute.POST(req('/api/signing-requests', 'POST', b))
  const ENV = ['SIGNWELL_API_KEY', 'SIGNWELL_WEBHOOK_ID', 'SIGNWELL_TEST_MODE']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    for (const k of ENV) delete process.env[k]
    global.__resendSent = 0
    as('principal')
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  test('built-in flow: extras attached; letters returned', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans')] } })
    await putFiles()
    const r = await json(await send(body({ exhibits: { proposal: true, billing: true } })))
    expect(r.status).toBe(200)
    expect(r.body.exhibits_included).toEqual(['proposal', 'billing', `extra:${D_PLANS}`])
    expect(r.body.exhibits_included_letters).toEqual(['A', 'B', 'C'])
    expect(mockState.db.signing_requests[0].document_html).toContain('Exhibit C – Plans')
  })
  test('extras-only send runs even with A and B off', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans')] } })
    await putFiles()
    const r = await json(await send(body({ exhibits: { proposal: false, billing: false } })))
    expect(r.body.exhibits_included_letters).toEqual(['C'])
    const off = await json(await send(body({ exhibits: { proposal: false, billing: false, extras: false } })))
    expect(off.body.exhibits_included).toEqual([])
  })
  test('unreadable extra → 502 naming its letter; nothing sent', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans'), ex(D_SPECS, 'Specs')] } })
    await putFiles()
    delete mockState.files[`job-documents/${J1}/specs/1-specs.pdf`]
    const r = await json(await send(body({ exhibits: { proposal: true, billing: true } })))
    expect(r.status).toBe(502)
    expect(r.body.error).toBe('Nothing was sent: could not read Exhibit D (specs.pdf). Try again.')
    expect(mockState.db.signing_requests).toHaveLength(0)
    expect(global.__resendSent).toBe(0)
  })
  test('SignWell: exhibits PDF over 25 MB → 413 before createDocument; built-in link unaffected', async () => {
    process.env.SIGNWELL_API_KEY = 'sw_test_KEY'
    process.env.SIGNWELL_WEBHOOK_ID = 'hook-1'
    const calls = []
    global.fetch = jest.fn(async (url, init = {}) => { calls.push({ url, method: init.method }); return { ok: false, status: 500, text: async () => '{}' } })
    seed({ sc: { bid_proposal_url: `bid-proposals/${J1}/big.jpg` } })
    mockState.files[`prime-contracts/bid-proposals/${J1}/big.jpg`] = bigJpeg(26 * 1024 * 1024)
    const r = await json(await send(body({ exhibits: { proposal: true, billing: false } })))
    expect(r.status).toBe(413)
    expect(r.body.error).toMatch(/^Nothing was sent: the exhibits PDF is 2[67] MB and SignWell accepts up to 25 MB per file\. Remove or shrink an exhibit, or send with the built-in e-sign link\.$/)
    expect(calls.filter(c => String(c.url).includes('/documents'))).toHaveLength(0)
    expect(sc1().signwell_document_id).toBeNull()
    delete process.env.SIGNWELL_API_KEY
    const builtIn = await json(await send(body({ exhibits: { proposal: true, billing: false } })))
    expect(builtIn.status).toBe(200)
    expect(builtIn.body.exhibits_included_letters).toEqual(['A'])
  }, 30000)
})

// ── 6. SignWell file name / sub-initiate-sign / wiring ────────────────────────
describe('SignWell packet name', () => {
  test('"Exhibits A-D" from the letters; default stays "Exhibits A-B"', () => {
    const pdf = Buffer.from('%PDF-1.4')
    expect(buildSignwellPacket({ html: '<p>x</p>', exhibitsBytes: pdf, vendorName: 'Acme', exhibitLetters: ['A', 'B', 'C', 'D'] }).files[1].name).toBe('Exhibits A-D - Acme.pdf')
    expect(buildSignwellPacket({ html: '<p>x</p>', exhibitsBytes: pdf, vendorName: 'Acme', exhibitLetters: ['C', 'D'] }).files[1].name).toBe('Exhibits C-D - Acme.pdf')
    expect(buildSignwellPacket({ html: '<p>x</p>', exhibitsBytes: pdf, vendorName: 'Acme' }).files[1].name).toBe('Exhibits A-B - Acme.pdf')
  })
})

describe('sub-initiate-sign lists the attached exhibits in the contract', () => {
  test('A, B, C in the body and the appendix', async () => {
    seed({ gf: { exhibits: [ex(D_PLANS, 'Plans'), ex(D_OTHERJOB, 'Not ours')] } })
    await putFiles()
    mockState.defaults = { signing_requests: () => ({ status: 'pending', token: 'tok-103' }) }
    mockState.auth = { userId: 'subuser', role: 'subcontractor', companyId: 'co1' }
    const r = await json(await subInitiate.POST(req('/api/sub-initiate-sign', 'POST', { subcontract_id: SC1 })))
    expect(r.status).toBe(200)
    const html = mockState.db.signing_requests[0].document_html
    expect(html).toContain('<p><strong>EXHIBITS:</strong><br>Exhibit A – Subcontractor Proposal<br>Exhibit B – Billing Schedule<br>Exhibit C – Plans</p>')
    expect(html).not.toContain('Not ours')
    expect(html.indexOf('EXHIBITS:')).toBeLessThan(html.indexOf('class="nv-exhibits"'))
  })
})

describe('wiring', () => {
  test('subcontract_exhibit is a slot category with a label; not in the general picker', () => {
    expect(isJobDocCategory('subcontract_exhibit')).toBe(true)
    expect(docCategoryLabel('subcontract_exhibit')).toBe('Subcontract Exhibit')
    expect(require('../lib/job-docs').JOB_DOC_CATEGORIES.some(c => c.value === 'subcontract_exhibit')).toBe(false)
  })
  test('routes that merge have maxDuration 60 and select generator_fields', () => {
    for (const f of ['app/api/subcontract-exhibits/route.js', 'app/api/signing-requests/route.js', 'app/api/sub-initiate-sign/route.js']) expect(read(f)).toMatch(/export const maxDuration = 60/)
    expect(read('app/api/subcontract-exhibits/route.js')).toMatch(/select\('id, job_id, vendor_name, bid_proposal_url, generator_fields'\)/)
    expect(read('app/api/signing-requests/route.js')).toMatch(/bid_proposal_url, vendor_name, generator_fields'/)
  })
  test('job page: exhibits block, uploads through uploadJobDocument, PDF/image proposal inputs, no "(A/B)" text', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).toMatch(/category: EXTRA_EXHIBIT_CATEGORY, file/)
    expect(page).toMatch(/jsonInit\('PUT', \{ id: cur\.contract_id, exhibits: list \}\)/)
    expect(page).toContain('+ Add from job documents')
    expect(page).toContain('+ Upload exhibit (PDF or image)')
    expect(page).toContain('file no longer on the job')
    expect(page).toContain("'Open Exhibits PDF'")
    expect(page).not.toContain('Open Exhibits PDF (A/B)')
    expect(page).not.toContain('accept=".pdf,.doc,.docx"')
    expect(page.match(/accept=\{EXHIBIT_FILE_ACCEPT\}/g).length).toBeGreaterThanOrEqual(3)
    expect(X.EXHIBIT_FILE_ACCEPT).toBe('.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg')
    expect(page).toMatch(/exhibit_list: exhibitListFor\(check\)/)
    expect(page).toMatch(/\{docCategoryLabel\(d\.category\)\}/)
  })
})
