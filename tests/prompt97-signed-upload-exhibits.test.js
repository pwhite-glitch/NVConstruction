/**
 * Prompt 97: office signed-contract upload + Exhibit A (proposal) / Exhibit B (billing schedule).
 * Peyton 11/20: "a place where i can upload a signed contract if they dont want to do esign …
 * a billing schedule … as an exhibit b and thier proposal as exhibit a … attach it to subcontracts"
 *  - POST /api/subcontracts/signed-upload: role + job guards, contracts/<id>/ prefix, file must
 *    exist, replace needs confirm, signing fields only (no amounts), missing-column retry (080).
 *  - e-sign copy records signed_method 'esign' (tolerates a missing column).
 *  - lib/sub-billing-dates.js: next pay-app due dates (Central).
 *  - lib/subcontract-exhibits.js: merge order, image → page, unsupported → note, missing skipped.
 *  - warning logic, exhibits routes (office + signing token), Exhibit B PDF.
 * DB/auth/storage are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('pdf-lib')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
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

const signedUpload = require('../app/api/subcontracts/signed-upload/route')
const exhibitsRoute = require('../app/api/subcontract-exhibits/route')
const tokenExhibits = require('../app/api/signing-requests/[token]/exhibits/route')
const { saveSignedContract } = require('../lib/generated-contract')
const SU = require('../lib/signed-upload')
const D = require('../lib/sub-billing-dates')
const X = require('../lib/subcontract-exhibits')
const { buildExhibitBPdf, exhibitBContent } = require('../lib/exhibit-b-pdf')
const { isJobDocCategory } = require('../lib/job-docs')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const SC2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const json = async r => ({ status: r.status, body: await r.json() })
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function pdfOfPages(n, size = [300, 400]) {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage(size)
  return Buffer.from(await d.save())
}

function seed(extra = {}) {
  resetMockState({
    jobs: [{ id: J1, pm_email: 'pm@nv.com', job_number: '7469', project_name: 'Braum Longview' }, { id: J2, pm_email: 'other@nv.com' }],
    pm_job_assignments: [],
    subcontracts: [
      { id: SC1, job_id: J1, vendor_name: 'Acme Plumbing', status: 'active', contract_value: 12500, signed_at: null, signed_contract_url: null, bid_proposal_url: 'bid-proposals/' + J1 + '/1700.pdf' },
      { id: SC2, job_id: J2, vendor_name: 'Other Co', status: 'active', contract_value: 9000, signed_at: null, signed_contract_url: null },
    ],
    change_log: [],
    ...extra,
  })
}
const upPath = (id = SC1, name = 'office-signed-1.pdf') => `contracts/${id}/${name}`
const putFile = (p, buf = Buffer.from('%PDF-1.4 x')) => { mockState.files[`documents/${p}`] = buf }

// ── 1. office signed-contract upload route ────────────────────────────────────
describe('POST /api/subcontracts/signed-upload', () => {
  beforeEach(() => seed())
  const post = body => signedUpload.POST(req('/api/subcontracts/signed-upload', 'POST', body))

  test('owner / admin on any job, PM on their job: saves signed_contract_url, signed_at, method, uploader; status signed', async () => {
    for (const role of ['principal', 'admin']) {
      seed(); as(role); putFile(upPath())
      const r = await json(await post({ subcontract_id: SC1, path: upPath() }))
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ ok: true, signed_contract_url: upPath(), method_saved: true })
      const sc = mockState.db.subcontracts.find(s => s.id === SC1)
      expect(sc).toMatchObject({ signed_contract_url: upPath(), signed_method: 'manual_upload', signed_uploaded_by: `u-${role}`, status: 'signed' })
      expect(typeof sc.signed_at).toBe('string')
    }
    seed(); mockState.auth = { userId: 'u-pm', email: 'pm@nv.com', role: 'pm', error: null }; putFile(upPath())
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(200)
  })

  test('PM / APM not on the job → 403; super and subs → 403; nothing written', async () => {
    mockState.auth = { userId: 'u-pm2', email: 'pm2@nv.com', role: 'pm', error: null }; putFile(upPath())
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(403)
    mockState.auth = { userId: 'u-apm', email: 'apm@nv.com', role: 'apm', error: null }
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(403)
    as('super')
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(403)
    as('subcontractor')
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(403)
    expect(mockState.calls.filter(c => c.table === 'subcontracts')).toEqual([])
  })

  test('assigned APM (pm_job_assignments) is allowed', async () => {
    seed({ pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-apm' }] }); as('apm'); putFile(upPath())
    expect((await post({ subcontract_id: SC1, path: upPath() })).status).toBe(200)
  })

  test('path must be under contracts/<this subcontract>/, a PDF or image, no traversal', async () => {
    as('principal')
    const bad = [
      upPath(SC2), `contracts/${SC1}/../${SC2}/x.pdf`, `contracts/${SC1}/sub/x.pdf`, `contracts/${SC1}/x.exe`,
      `subcontracts/${SC1}/x.pdf`, `/contracts/${SC1}/x.pdf`, `contracts/${SC1}/`, `https://evil/contracts/${SC1}/x.pdf`,
    ]
    for (const p of bad) {
      putFile(p)
      const r = await post({ subcontract_id: SC1, path: p })
      expect([p, r.status]).toEqual([p, 400])
    }
    for (const ok of ['a.pdf', 'b.PNG', 'c.jpg', 'd.jpeg', 'e.heic']) expect(SU.signedUploadPathError(upPath(SC1, ok), SC1)).toBeNull()
    expect(mockState.calls.filter(c => c.table === 'subcontracts')).toEqual([])
  })

  test('subcontract of another job in the body → 400; unknown id → 404; bad id → 400', async () => {
    as('principal'); putFile(upPath())
    expect((await post({ subcontract_id: SC1, job_id: J2, path: upPath() })).status).toBe(400)
    expect((await post({ subcontract_id: 'aaaaaaaa-0000-4000-8000-000000000009', path: upPath() })).status).toBe(404)
    expect((await post({ subcontract_id: 'nope', path: upPath() })).status).toBe(400)
  })

  test('file not in storage → 422, nothing written', async () => {
    as('principal')
    const r = await post({ subcontract_id: SC1, path: upPath() })
    expect(r.status).toBe(422)
    expect(mockState.calls.filter(c => c.table === 'subcontracts')).toEqual([])
  })

  test('replacing a signed file needs replace: true (the page asks first)', async () => {
    seed(); mockState.db.subcontracts[0].signed_contract_url = `contracts/${SC1}/esigned-old.html`; as('admin')
    putFile(upPath())
    const r = await json(await post({ subcontract_id: SC1, path: upPath() }))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('already_signed')
    expect((await post({ subcontract_id: SC1, path: upPath(), replace: true })).status).toBe(200)
    expect(mockState.db.subcontracts[0].signed_contract_url).toBe(upPath())
  })

  test('writes only signing columns: never contract value, numbering, billing or budget', async () => {
    as('principal'); putFile(upPath())
    await post({ subcontract_id: SC1, path: upPath(), contract_value: 1, budget_allocations: [{ x: 1 }], subcontract_number: '9', status: 'complete' })
    const writes = mockState.calls.filter(c => c.table === 'subcontracts' && c.op === 'update')
    const keys = [...new Set(writes.flatMap(w => Object.keys(w.payload)))].sort()
    expect(keys).toEqual(['signed_at', 'signed_contract_url', 'signed_method', 'signed_uploaded_by', 'status'].sort())
    expect(writes.find(w => 'status' in w.payload).payload).toEqual({ status: 'signed' })
    expect(mockState.db.subcontracts[0].contract_value).toBe(12500)
    expect(Object.keys(SU.buildSignedUploadPatch({ path: 'p', userId: 'u', now: 'n' })).sort()).toEqual(['signed_at', 'signed_contract_url', 'signed_method', 'signed_uploaded_by'])
  })

  test('before migration 080: signed_method / signed_uploaded_by dropped, the rest saves (method_saved false)', async () => {
    as('principal'); putFile(upPath())
    mockState.missingCols = { subcontracts: ['signed_method', 'signed_uploaded_by'] }
    const r = await json(await post({ subcontract_id: SC1, path: upPath() }))
    expect(r.status).toBe(200)
    expect(r.body.method_saved).toBe(false)
    const sc = mockState.db.subcontracts[0]
    expect(sc.signed_contract_url).toBe(upPath())
    expect(sc.signed_method).toBeUndefined()
    expect(sc.status).toBe('signed')
  })
})

describe('signed method labels / roles', () => {
  test('labels', () => {
    expect(SU.signedMethodLabel('manual_upload')).toBe('Signed (uploaded)')
    expect(SU.signedMethodLabel('esign')).toBe('Signed (e-sign)')
    expect(SU.signedMethodLabel(null)).toBeNull()
  })
  test('office roles only', () => {
    expect(['principal', 'admin', 'pm', 'apm'].every(SU.canUploadSignedContract)).toBe(true)
    expect(['super', 'subcontractor', 'sub_admin', null].some(SU.canUploadSignedContract)).toBe(false)
  })
  test('upload path lands under contracts/<id>/ with a safe extension', () => {
    expect(SU.signedUploadPath(SC1, 'Signed Copy.PDF', 5)).toBe(`contracts/${SC1}/office-signed-5.pdf`)
    expect(SU.signedUploadPath(SC1, 'photo.jpeg', 5)).toBe(`contracts/${SC1}/office-signed-5.jpeg`)
    expect(SU.signedUploadPath(SC1, 'weird.exe', 5)).toBe(`contracts/${SC1}/office-signed-5.pdf`)
  })
})

// ── 2. e-sign records signed_method 'esign' ───────────────────────────────────
describe('saveSignedContract signed_method', () => {
  test("sets 'esign' when the e-signed copy becomes the signed contract", async () => {
    seed()
    const out = await saveSignedContract(require('@supabase/supabase-js').createClient(), { subcontractId: SC1, html: '<html><body>x</body></html>', certificate: { signature_text: 'A B' }, at: '2026-11-20T17:00:00Z' })
    expect(out.linked).toBe(true)
    expect(mockState.db.subcontracts[0]).toMatchObject({ signed_method: 'esign', status: 'signed', signed_contract_url: out.path })
  })
  test('does not overwrite a manual upload already on file', async () => {
    seed(); Object.assign(mockState.db.subcontracts[0], { signed_contract_url: upPath(), signed_method: 'manual_upload' })
    const out = await saveSignedContract(require('@supabase/supabase-js').createClient(), { subcontractId: SC1, html: 'x', certificate: {}, at: '2026-11-20T17:00:00Z' })
    expect(out.linked).toBe(false)
    expect(mockState.db.subcontracts[0].signed_method).toBe('manual_upload')
  })
  test('before 080 (no column) signing still completes', async () => {
    seed(); mockState.missingCols = { subcontracts: ['signed_method'] }
    const out = await saveSignedContract(require('@supabase/supabase-js').createClient(), { subcontractId: SC1, html: 'x', certificate: {}, at: '2026-11-20T17:00:00Z' })
    expect(out.linked).toBe(true)
    expect(mockState.db.subcontracts[0].status).toBe('signed')
  })
})

// ── 3. billing schedule dates ─────────────────────────────────────────────────
describe('nextSubBillingDueDates (Central)', () => {
  const NOW = new Date('2026-11-20T17:00:00Z') // Fri Nov 20 2026, Central
  test('monthly: due day each month from today, clamped to short months', () => {
    const d = D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_due: 31 }, { now: NOW, count: 4 })
    expect(d).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_due: 20 }, { now: NOW, count: 2 })).toEqual(['2026-11-20', '2026-12-20'])
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_due: 5 }, { now: NOW, count: 2 })).toEqual(['2026-12-05', '2027-01-05'])
  })
  test('weekly: next matching weekday, then every 7 days', () => {
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'weekly', sub_billing_due: 1 }, { now: NOW, count: 3 })).toEqual(['2026-11-23', '2026-11-30', '2026-12-07'])
  })
  test('bi-weekly: stays on the anchor cycle', () => {
    const job = { sub_billing_frequency: 'biweekly', sub_billing_due: 5, sub_billing_start: '2026-10-02', sub_billing_anchor: '2026-10-02' }
    expect(D.nextSubBillingDueDates(job, { now: NOW, count: 3 })).toEqual(['2026-11-27', '2026-12-11', '2026-12-25'])
    // Anchor exactly two weeks before today's Friday → today is a due date.
    expect(D.nextSubBillingDueDates({ ...job, sub_billing_anchor: '2026-11-06' }, { now: NOW, count: 1 })).toEqual(['2026-11-20'])
  })
  test('no dates before the first billing due date; 12 by default', () => {
    const d = D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_due: 15, sub_billing_start: '2027-03-15' }, { now: NOW })
    expect(d[0]).toBe('2027-03-15')
    expect(d).toHaveLength(12)
  })
  test('Central date, not UTC: 03:00Z Nov 21 is still Nov 20 in Chicago', () => {
    const late = new Date('2026-11-21T03:00:00Z')
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_due: 20 }, { now: late, count: 1 })).toEqual(['2026-11-20'])
  })
  test('settings missing → []; due taken from start when blank', () => {
    expect(D.nextSubBillingDueDates({}, { now: NOW })).toEqual([])
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'weekly' }, { now: NOW })).toEqual([])
    expect(D.nextSubBillingDueDates({ sub_billing_frequency: 'monthly', sub_billing_start: '2026-12-10' }, { now: NOW, count: 1 })).toEqual(['2026-12-10'])
  })
  test('cadence labels', () => {
    expect(D.cadenceLabel(D.subBillingSettings({ sub_billing_frequency: 'monthly', sub_billing_due: 1 }))).toBe('The 1st of each month')
    expect(D.cadenceLabel(D.subBillingSettings({ sub_billing_frequency: 'biweekly', sub_billing_due: 5 }))).toBe('Every other Friday')
    expect(D.formatDueDate('2026-11-27')).toBe('Fri, Nov 27, 2026')
  })
})

// ── 4. exhibit merge ──────────────────────────────────────────────────────────
describe('buildExhibitsPdf', () => {
  test('order: proposal pages, then the schedule (image → page); no cover pages (prompt 107b)', async () => {
    const proposal = await pdfOfPages(2, [300, 400])
    const out = await X.buildExhibitsPdf([
      { exhibit: X.EXHIBIT_B, file: { name: 'schedule.png', bytes: PNG_1PX } }, // given out of order on purpose
      { exhibit: X.EXHIBIT_A, file: { name: 'proposal.pdf', bytes: proposal } },
    ], { subtitle: 'Acme' })
    expect(out.included).toEqual(['proposal', 'billing'])
    expect(out.notes).toEqual([])
    const doc = await PDFDocument.load(out.bytes)
    const sizes = doc.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())])
    expect(sizes).toEqual([[300, 400], [300, 400], [612, 792]])
  })
  test('a missing exhibit is skipped: no empty cover page', async () => {
    const out = await X.buildExhibitsPdf([{ exhibit: X.EXHIBIT_A, file: null }, { exhibit: X.EXHIBIT_B, file: { name: 's.pdf', bytes: await pdfOfPages(1) } }])
    expect(out.included).toEqual(['billing'])
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1) // prompt 107b: no cover page
    const none = await X.buildExhibitsPdf([{ exhibit: X.EXHIBIT_A, file: null }])
    expect(none).toEqual({ bytes: null, included: [], notes: [] })
  })
  test('HEIC / other / unreadable PDF: one notice page with an "attached separately" note naming the file', async () => {
    const heic = Buffer.from('\x00\x00\x00\x18ftypheic....', 'binary')
    const out = await X.buildExhibitsPdf([
      { exhibit: X.EXHIBIT_A, file: { name: 'proposal.heic', bytes: heic } },
      { exhibit: X.EXHIBIT_B, file: { name: 'broken.pdf', bytes: Buffer.from('%PDF-1.4 not really') } },
    ])
    expect(out.included).toEqual(['proposal', 'billing'])
    expect(out.notes.map(n => [n.key, n.name])).toEqual([['proposal', 'proposal.heic'], ['billing', 'broken.pdf']])
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(2)
  })
  test('file kinds by magic bytes', () => {
    expect(X.fileKind(Buffer.from('%PDF-1.7'))).toBe('pdf')
    expect(X.fileKind(PNG_1PX)).toBe('png')
    expect(X.fileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(X.fileKind(Buffer.from('ftypheic'))).toBe('other')
  })
})

describe('contract appendix + exhibits path', () => {
  const p1 = X.exhibitsPdfPath(SC1, new Date('2026-11-20T17:00:00.123Z'))
  test('path layout and ownership check', () => {
    expect(p1).toBe(`subcontracts/${SC1}/exhibits-2026-11-20T17-00-00-123Z.pdf`)
    expect(X.isExhibitsPathFor(p1, SC1)).toBe(true)
    expect(X.isExhibitsPathFor(p1, SC2)).toBe(false)
    expect(X.isExhibitsPathFor(`subcontracts/${SC1}/generated-x.html`, SC1)).toBe(false)
  })
  test('appendix: one note naming A then B, only those included, marker read back only for this subcontract', () => {
    const html = X.withExhibitAppendix('<html><body>C</body></html>', X.exhibitAppendixHtml({ proposal: { name: 'p<1>.pdf' }, billing: { name: 's.pdf' }, exhibitsPath: p1 }))
    // prompt 107b: no cover pages / file names, just "Exhibits A and B (attached) …"
    expect(html).toContain('Exhibits A and B (attached) are part of this Subcontract.')
    expect(html).not.toContain('p&lt;1&gt;.pdf')
    expect(html.endsWith('</body></html>')).toBe(true)
    expect(X.exhibitsPathFromHtml(html, SC1)).toBe(p1)
    expect(X.exhibitsPathFromHtml(html, SC2)).toBeNull()
    const onlyB = X.exhibitAppendixHtml({ billing: { name: 's.pdf' } })
    expect(onlyB).not.toContain('Exhibit A')
    expect(X.exhibitAppendixHtml({})).toBe('')
    // Re-applying replaces the earlier appendix
    const again = X.withExhibitAppendix(html, X.exhibitAppendixHtml({ billing: { name: 'new.pdf' } }))
    expect(again).not.toContain('Exhibit A')
    expect(again.match(/class="nv-exhibits"/g)).toHaveLength(1)
  })
})

// ── 5. warning logic ──────────────────────────────────────────────────────────
describe('missing-exhibit warnings', () => {
  const doc = { storage_path: `${J1}/billing_schedule/1-s.pdf` }
  test('messages', () => {
    expect(X.exhibitWarnings({ proposalPath: 'x.pdf', billingDoc: doc })).toEqual([])
    expect(X.exhibitWarnings({}).map(w => w.message)).toEqual(['Exhibit A proposal not uploaded', 'Exhibit B billing schedule not set for this job'])
  })
  test('nothing missing → no prompt, both included', () => {
    const confirmFn = jest.fn()
    expect(X.confirmExhibits({ proposalPath: 'x.pdf', billingDoc: doc }, confirmFn)).toMatchObject({ proceed: true, include: { proposal: true, billing: true } })
    expect(confirmFn).not.toHaveBeenCalled()
  })
  test('missing → asks; Cancel stops; Continue anyway leaves the missing one out', () => {
    const cancel = X.confirmExhibits({ proposalPath: '', billingDoc: doc }, () => false)
    expect(cancel.proceed).toBe(false)
    const msgs = []
    const go = X.confirmExhibits({ proposalPath: 'x.pdf', billingDoc: null }, m => { msgs.push(m); return true })
    expect(go).toMatchObject({ proceed: true, include: { proposal: true, billing: false } })
    expect(msgs[0]).toContain('Exhibit B billing schedule not set for this job')
    expect(msgs[0]).toMatch(/Continue anyway/)
    expect(msgs[0]).toMatch(/Cancel/)
  })
})

// ── 6. exhibits routes ────────────────────────────────────────────────────────
describe('/api/subcontract-exhibits', () => {
  const billingRow = { id: 'd1', job_id: J1, category: 'billing_schedule', storage_path: `${J1}/billing_schedule/1-sched.pdf`, file_name: 'sched.pdf', uploaded_at: '2026-11-20T10:00:00Z' }
  beforeEach(async () => {
    seed({ job_documents: [billingRow] })
    mockState.files[`prime-contracts/bid-proposals/${J1}/1700.pdf`] = await pdfOfPages(3)
    mockState.files[`job-documents/${billingRow.storage_path}`] = await pdfOfPages(1)
  })
  test('status lists what is on file', async () => {
    as('principal')
    const r = await json(await exhibitsRoute.GET(req(`/api/subcontract-exhibits?subcontract_id=${SC1}&kind=status`, 'GET')))
    expect(r.body).toMatchObject({ proposal: { name: '1700.pdf' }, billing: { name: 'sched.pdf' } })
  })
  test('POST merges A + B into documents/subcontracts/<id>/exhibits-….pdf (3 + 1 pages, no cover pages)', async () => {
    as('principal')
    const r = await json(await exhibitsRoute.POST(req('/api/subcontract-exhibits', 'POST', { subcontract_id: SC1, include: { proposal: true, billing: true } })))
    expect(r.status).toBe(200)
    expect(X.isExhibitsPathFor(r.body.path, SC1)).toBe(true)
    expect(r.body.included).toEqual(['proposal', 'billing'])
    expect(X.exhibitsPathFromHtml(r.body.appendix, SC1)).toBe(r.body.path)
    expect((await PDFDocument.load(mockState.files[`documents/${r.body.path}`])).getPageCount()).toBe(4)
  })
  test('include false leaves an exhibit out; nothing included → no file', async () => {
    as('principal')
    const r = await json(await exhibitsRoute.POST(req('/api/subcontract-exhibits', 'POST', { subcontract_id: SC1, include: { proposal: false, billing: true } })))
    expect(r.body.included).toEqual(['billing'])
    const none = await json(await exhibitsRoute.POST(req('/api/subcontract-exhibits', 'POST', { subcontract_id: SC1, include: { proposal: false, billing: false } })))
    expect(none.body.path).toBeNull()
  })
  test('another job’s billing schedule is never used', async () => {
    as('principal')
    mockState.db.job_documents = [{ ...billingRow, storage_path: `${J2}/billing_schedule/x.pdf` }]
    const r = await json(await exhibitsRoute.GET(req(`/api/subcontract-exhibits?subcontract_id=${SC1}&kind=status`, 'GET')))
    expect(r.body.billing).toBeNull()
  })
  test('PM not on the job → 403; nothing stored', async () => {
    mockState.auth = { userId: 'u-x', email: 'x@nv.com', role: 'pm', error: null }
    expect((await exhibitsRoute.POST(req('/api/subcontract-exhibits', 'POST', { subcontract_id: SC1 }))).status).toBe(403)
    expect(Object.keys(mockState.files).some(k => k.includes('exhibits-'))).toBe(false)
  })
})

describe('GET /api/signing-requests/<token>/exhibits', () => {
  const p1 = `subcontracts/${SC1}/exhibits-2026-11-20T17-00-00-000Z.pdf`
  const appendix = X.exhibitAppendixHtml({ proposal: { name: 'p.pdf' }, exhibitsPath: p1 })
  const get = t => tokenExhibits.GET(new Request(`http://x/api/signing-requests/${t}/exhibits`), { params: { token: t } })
  beforeEach(async () => {
    seed({ signing_requests: [
      { id: 'r1', token: 'tok1', subcontract_id: SC1, status: 'pending', document_html: `<html><body>C${appendix}</body></html>` },
      { id: 'r2', token: 'tok2', subcontract_id: SC2, status: 'pending', document_html: `<html><body>C${appendix}</body></html>` },
      { id: 'r3', token: 'tok3', subcontract_id: SC1, status: 'voided', document_html: `<html><body>C${appendix}</body></html>` },
    ] })
    mockState.files[`documents/${p1}`] = await pdfOfPages(2)
  })
  test('serves the exhibits PDF named in this request’s own contract', async () => {
    const r = await get('tok1')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/pdf')
  })
  test('a path for another subcontract is refused; voided links are gone; unknown token 404', async () => {
    expect((await get('tok2')).status).toBe(404)
    expect((await get('tok3')).status).toBe(410)
    expect((await get('nope')).status).toBe(404)
  })
})

// ── 7. Exhibit B PDF ──────────────────────────────────────────────────────────
describe('Exhibit B billing schedule PDF', () => {
  const job = { project_name: 'Braum Longview', job_number: '7469', sub_billing_frequency: 'biweekly', sub_billing_due: 5, sub_billing_start: '2026-10-02', sub_billing_anchor: '2026-10-02' }
  test('one unbranded page with title, settings, 12 dates and notes', async () => {
    const now = new Date('2026-11-20T17:00:00Z')
    const c = exhibitBContent({ job, notes: 'Lien waivers required', now })
    expect(c.title).toBe('Exhibit B – Billing Schedule')
    expect(c.project).toBe('Braum Longview — Job #7469')
    expect(c.dates).toHaveLength(12)
    expect(c.dates[0]).toBe('2026-11-27')
    expect(c.notes).toBe('Lien waivers required')
    const bytes = await buildExhibitBPdf({ job, notes: 'Lien waivers required 😀 ≥ ok', now })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/NV Construction/)
  })
  test('builds with no settings (says where to set them)', async () => {
    const bytes = await buildExhibitBPdf({ job: {}, now: new Date('2026-11-20T17:00:00Z') })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  test('billing_schedule is an accepted job document category (not in the general picker)', () => {
    expect(isJobDocCategory('billing_schedule')).toBe(true)
    expect(isJobDocCategory('nope')).toBe(false)
    expect(require('../lib/job-docs').JOB_DOC_CATEGORIES.some(c => c.value === 'billing_schedule')).toBe(false)
  })
})

// ── 8. wiring ─────────────────────────────────────────────────────────────────
describe('wiring', () => {
  test('migration 080 adds the two columns, wrapped in a transaction; 079 untouched', () => {
    const sql = read('supabase/migrations/080_subcontract_signed_method.sql')
    expect(sql).toMatch(/BEGIN;[\s\S]*ADD COLUMN IF NOT EXISTS signed_method text[\s\S]*ADD COLUMN IF NOT EXISTS signed_uploaded_by uuid;[\s\S]*COMMIT;/)
    expect(sql).toMatch(/RLS/)
    expect(read('supabase/migrations/079_subcontract_generator_fields.sql')).toMatch(/generator_fields jsonb/)
  })
  test('job page: warnings before generate and send, exhibits sent with e-sign, upload + labels', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).toMatch(/exhibitCheck\('generate the contract without it'\)/)
    expect(page).toMatch(/exhibitCheck\('send it for signature without it'\)/)
    expect(page).toMatch(/exhibits: check\.include/)
    expect(page).toMatch(/\/api\/subcontracts\/signed-upload/)
    expect(page).toMatch(/Billing Schedule \(Exhibit B\)/)
    expect(page).toMatch(/signedMethodLabel\(c\.signed_method\)/)
  })
  test('signing request POST and sub-initiated signing attach exhibits; sign page shows them', () => {
    expect(read('app/api/signing-requests/route.js')).toMatch(/buildAndStoreExhibits/)
    expect(read('app/api/sub-initiate-sign/route.js')).toMatch(/buildAndStoreExhibits/)
    expect(read('app/sign/page.js')).toMatch(/exhibits_url/)
  })
})
