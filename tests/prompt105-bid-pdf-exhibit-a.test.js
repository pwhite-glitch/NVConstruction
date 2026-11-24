/**
 * Prompt 105: the sub's bid PDF becomes Exhibit A.
 * Peyton 11/24: "the sub's bid PDF never becomes Exhibit A."
 *  - lib/bid-proposal-attach.js: pure name / path / vendor helpers.
 *  - POST /api/subcontracts/attach-bid: copies a bid PDF / job document into
 *    prime-contracts/bid-proposals/<job_id>/ (deterministic name) or links a proposal file in
 *    place; only-if-empty unless replace; signed contracts keep their Exhibit A.
 *  - GET  /api/subcontracts/attach-bid: the "Choose Exhibit A" picker's candidates.
 *  - Dashboard (award → job, save subcontract) and the job page picker (source checks).
 * DB/auth/storage are mocked; nothing live.
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
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})

const route = require('../app/api/subcontracts/attach-bid/route')
const A = require('../lib/bid-proposal-attach')
const { EXHIBIT_FILE_TYPE_MESSAGE } = require('../lib/subcontract-exhibits')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

const J1 = '11111111-1111-4111-8111-111111111111'
const J2 = '22222222-2222-4222-8222-222222222222'
const SC1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const SC2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const SC3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const P2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const S1 = 'cccccccc-0000-4000-8000-000000000001'
const S2 = 'cccccccc-0000-4000-8000-000000000002'
const B1 = 'dddddddd-0000-4000-8000-000000000001' // Acme on J1 (pdf)
const B2 = 'dddddddd-0000-4000-8000-000000000002' // Other Co on J1
const B3 = 'dddddddd-0000-4000-8000-000000000003' // Acme on J2's package
const B4 = 'dddddddd-0000-4000-8000-000000000004' // Acme .docx on J1
const B5 = 'dddddddd-0000-4000-8000-000000000005' // manual bid, name match
const D1 = 'eeeeeeee-0000-4000-8000-000000000001'
const D2 = 'eeeeeeee-0000-4000-8000-000000000002'
const D3 = 'eeeeeeee-0000-4000-8000-000000000003'
const D4 = 'eeeeeeee-0000-4000-8000-000000000004'
const D5 = 'eeeeeeee-0000-4000-8000-000000000005'

const B1_DOC = `${P1}/${S1}-1700000000000-Acme Bid & Co.pdf`
const B1_DEST = `bid-proposals/${J1}/bid-${B1}-Acme-Bid-Co.pdf`
const USED = `bid-proposals/${J1}/1700000000001.pdf`
const LOOSE = `bid-proposals/${J1}/1700000000002.pdf`

const as = (role, email = `${role}@nv.com`) => { mockState.auth = { userId: `u-${role}`, email, role, error: null } }
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const json = async r => ({ status: r.status, body: await r.json() })
const post = async body => json(await route.POST(req('/api/subcontracts/attach-bid', 'POST', body)))
const get = async id => json(await route.GET(req(`/api/subcontracts/attach-bid?subcontract_id=${id}`, 'GET')))
const flush = () => new Promise(r => setImmediate(r))
const PDF = Buffer.from('%PDF-1.4 bid')
const sc = id => mockState.db.subcontracts.find(s => s.id === id)
const copies = () => mockState.storageCalls.filter(c => c.op === 'copy')
const scWrites = () => mockState.calls.filter(c => c.table === 'subcontracts' && c.op === 'update')

function seed(over = {}) {
  resetMockState({
    jobs: [{ id: J1, pm_email: 'pm@nv.com' }, { id: J2, pm_email: 'other@nv.com' }],
    pm_job_assignments: [],
    profiles: [],
    signing_requests: [],
    change_log: [],
    bid_packages: [{ id: P1, job_id: J1, title: 'Plumbing' }, { id: P2, job_id: J2, title: 'Other job' }],
    bid_submissions: [
      { id: B1, bid_package_id: P1, sub_id: S1, company_name: 'Acme Plumbing', status: 'awarded', submitted_at: '2026-11-20T10:00:00Z', doc_url: B1_DOC },
      { id: B2, bid_package_id: P1, sub_id: S2, company_name: 'Other Co', status: 'rejected', submitted_at: '2026-11-19T10:00:00Z', doc_url: `${P1}/${S2}-1700-other.pdf` },
      { id: B3, bid_package_id: P2, sub_id: S1, company_name: 'Acme Plumbing', status: 'submitted', submitted_at: '2026-11-18T10:00:00Z', doc_url: `${P2}/${S1}-1700-elsewhere.pdf` },
      { id: B4, bid_package_id: P1, sub_id: S1, company_name: 'Acme Plumbing', status: 'submitted', submitted_at: '2026-11-17T10:00:00Z', doc_url: `${P1}/${S1}-1700-bid.docx` },
      { id: B5, bid_package_id: P1, sub_id: null, company_name: '  acme  PLUMBING ', status: 'submitted', submitted_at: '2026-11-21T10:00:00Z', doc_url: `${P1}/manual-1700-manual bid.pdf` },
    ],
    subcontracts: [
      { id: SC1, job_id: J1, vendor_name: 'Acme Plumbing', sub_id: S1, status: 'active', signed_at: null, signed_contract_url: null, bid_proposal_url: null },
      { id: SC2, job_id: J1, vendor_name: 'Other Co', sub_id: S2, status: 'active', signed_at: null, signed_contract_url: null, bid_proposal_url: USED },
      { id: SC3, job_id: J2, vendor_name: 'Acme Plumbing', sub_id: S1, status: 'active', signed_at: null, signed_contract_url: null, bid_proposal_url: null },
    ],
    job_documents: [
      { id: D1, job_id: J1, category: 'drawings', storage_path: `${J1}/plans.pdf`, file_name: 'plans.pdf', uploaded_at: '2026-11-10' },
      { id: D2, job_id: J1, category: 'billing_schedule', storage_path: `${J1}/billing.pdf`, file_name: 'billing.pdf', uploaded_at: '2026-11-11' },
      { id: D3, job_id: J2, category: 'drawings', storage_path: `${J2}/x.pdf`, file_name: 'x.pdf', uploaded_at: '2026-11-12' },
      { id: D4, job_id: J1, category: 'drawings', storage_path: `elsewhere/y.pdf`, file_name: 'y.pdf', uploaded_at: '2026-11-13' },
      { id: D5, job_id: J1, category: 'specs', storage_path: `${J1}/specs.docx`, file_name: 'specs.docx', uploaded_at: '2026-11-14' },
    ],
    ...over,
  })
  mockState.files[`bid-docs/${B1_DOC}`] = PDF
  mockState.files[`bid-docs/${P1}/manual-1700-manual bid.pdf`] = PDF
  mockState.files[`job-documents/${J1}/plans.pdf`] = PDF
  mockState.files[`prime-contracts/${USED}`] = PDF
  mockState.files[`prime-contracts/${LOOSE}`] = PDF
  mockState.files[`prime-contracts/bid-proposals/${J2}/other-job.pdf`] = PDF
  as('principal')
}

// ── 1. pure helpers ───────────────────────────────────────────────────────────
describe('lib/bid-proposal-attach', () => {
  test('cleanSourceName strips the bid-docs prefixes, keeps the extension', () => {
    expect(A.cleanSourceName(B1_DOC)).toBe('Acme Bid & Co.pdf')
    expect(A.cleanSourceName(`${P1}/manual-1732400000000-Proposal v2.PDF`)).toBe('Proposal v2.PDF')
    expect(A.cleanSourceName('bid-proposals/x/1700000000000.pdf')).toBe('1700000000000.pdf')
    expect(A.cleanSourceName('17-plans.pdf')).toBe('plans.pdf')
    expect(A.cleanSourceName('plain.pdf')).toBe('plain.pdf')
  })

  test('safeProposalFileName: spaces, &, unicode, long names, no extension', () => {
    expect(A.safeProposalFileName('Acme Bid & Co.pdf')).toBe('Acme-Bid-Co.pdf')
    expect(A.safeProposalFileName('Résumé — offre.PDF')).toBe('Resume-offre.pdf')
    expect(A.safeProposalFileName('日本.pdf')).toBe('proposal.pdf')
    expect(A.safeProposalFileName('--..weird..--.png')).toBe('weird.png')
    expect(A.safeProposalFileName('no extension here')).toBe('no-extension-here')
    expect(A.safeProposalFileName('')).toBe('proposal')
    const long = A.safeProposalFileName('x'.repeat(300) + '.pdf')
    expect(long.length).toBeLessThanOrEqual(100)
    expect(long.endsWith('.pdf')).toBe(true)
  })

  test('attachedProposalPath is deterministic and distinct per source', () => {
    const a = A.attachedProposalPath({ jobId: J1, source: 'bid_submission', sourceId: B1, name: 'Acme Bid & Co.pdf' })
    expect(a).toBe(B1_DEST)
    expect(A.attachedProposalPath({ jobId: J1, source: 'bid_submission', sourceId: B1, name: 'Acme Bid & Co.pdf' })).toBe(a)
    const d = A.attachedProposalPath({ jobId: J1, source: 'job_document', sourceId: B1, name: 'Acme Bid & Co.pdf' })
    expect(d).toBe(`bid-proposals/${J1}/doc-${B1}-Acme-Bid-Co.pdf`)
    expect(d).not.toBe(a)
    expect(A.attachedProposalPath({ jobId: J1, source: 'bid_submission', sourceId: B2, name: 'Acme Bid & Co.pdf' })).not.toBe(a)
    expect(() => A.attachedProposalPath({ jobId: J1, source: 'proposal_file', sourceId: B1, name: 'x.pdf' })).toThrow()
    expect(A.isInProposalFolder(a, J1)).toBe(true)
  })

  test('isInProposalFolder: this job only, one segment, no dot segments / URLs', () => {
    expect(A.isInProposalFolder(`bid-proposals/${J1}/a.pdf`, J1)).toBe(true)
    expect(A.isInProposalFolder(`bid-proposals/${J1.toUpperCase()}/a.pdf`, J1)).toBe(true)
    expect(A.isInProposalFolder(`bid-proposals/${J2}/a.pdf`, J1)).toBe(false)
    expect(A.isInProposalFolder(`bid-proposals/${J1}/sub/a.pdf`, J1)).toBe(false)
    expect(A.isInProposalFolder(`bid-proposals/${J1}/../${J2}/a.pdf`, J1)).toBe(false)
    expect(A.isInProposalFolder(`bid-proposals/${J1}/`, J1)).toBe(false)
    expect(A.isInProposalFolder(`https://x.co/bid-proposals/${J1}/a.pdf`, J1)).toBe(false)
    expect(A.isInProposalFolder(`other/${J1}/a.pdf`, J1)).toBe(false)
    expect(A.isInProposalFolder(null, J1)).toBe(false)
  })

  test('vendorMatches: sub_id, name (case / spaces), manual bid', () => {
    const sc = { sub_id: S1, vendor_name: 'Acme Plumbing' }
    expect(A.vendorMatches({ sub_id: S1, company_name: 'Renamed LLC' }, sc)).toBe(true)
    expect(A.vendorMatches({ sub_id: S2, company_name: ' ACME   plumbing ' }, sc)).toBe(true)
    expect(A.vendorMatches({ sub_id: null, company_name: 'acme plumbing' }, { sub_id: null, vendor_name: 'Acme Plumbing' })).toBe(true)
    expect(A.vendorMatches({ sub_id: S2, company_name: 'Other Co' }, sc)).toBe(false)
    expect(A.vendorMatches({ sub_id: null, company_name: '' }, { sub_id: null, vendor_name: '' })).toBe(false)
  })

  test('contentTypeFor / ATTACH_SOURCES', () => {
    expect(A.contentTypeFor('a.PDF')).toBe('application/pdf')
    expect(A.contentTypeFor('a.png')).toBe('image/png')
    expect(A.contentTypeFor('a.jpeg')).toBe('image/jpeg')
    expect(A.contentTypeFor('a.jpg')).toBe('image/jpeg')
    expect(A.ATTACH_SOURCES).toEqual(['bid_submission', 'job_document', 'proposal_file', 'subcontract'])
  })
})

// ── 2. POST route ─────────────────────────────────────────────────────────────
describe('POST /api/subcontracts/attach-bid', () => {
  beforeEach(() => seed())

  test('401 without auth, 403 for a sub, 403 for a PM not on the job', async () => {
    mockState.auth = null
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).status).toBe(401)
    as('subcontractor')
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).status).toBe(403)
    as('pm', 'someone@nv.com')
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).status).toBe(403)
    expect(copies()).toHaveLength(0)
    expect(scWrites()).toHaveLength(0)
  })

  test('PM on the job may attach; bad uuid / unknown source / no job → 400; missing → 404', async () => {
    expect((await post({ subcontract_id: 'nope', source: 'bid_submission', id: B1 })).status).toBe(400)
    expect((await post({ subcontract_id: SC1, source: 'url', id: B1 })).status).toBe(400)
    expect((await post({ subcontract_id: 'aaaaaaaa-0000-4000-8000-00000000009f', source: 'bid_submission', id: B1 })).status).toBe(404)
    mockState.db.subcontracts[0].job_id = null
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r).toEqual({ status: 400, body: { error: 'Put this subcontract on a job first.' } })
    seed(); as('pm', 'pm@nv.com')
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).status).toBe(200)
  })

  test('bid copy lands at bid-proposals/<job>/bid-<id>-<safe> in prime-contracts and is saved + logged', async () => {
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r).toEqual({ status: 200, body: { ok: true, path: B1_DEST, name: `bid-${B1}-Acme-Bid-Co.pdf`, replaced: false, copied: true } })
    expect(copies()).toEqual([expect.objectContaining({ bucket: 'bid-docs', path: B1_DOC, to: B1_DEST, destinationBucket: 'prime-contracts' })])
    expect(mockState.files[`prime-contracts/${B1_DEST}`]).toEqual(PDF)
    expect(mockState.files[`bid-docs/${B1_DOC}`]).toEqual(PDF) // source never removed
    expect(sc(SC1).bid_proposal_url).toBe(B1_DEST)
    await flush()
    expect(mockState.db.change_log).toEqual([expect.objectContaining({ entity_id: SC1, field_name: 'bid_proposal_url', old_value: null, new_value: B1_DEST, note: "Exhibit A attached from the sub's bid — Acme Plumbing" })])
  })

  test('manual bid (no sub_id) matches by company name', async () => {
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B5 })
    expect(r.status).toBe(200)
    expect(r.body.path).toBe(`bid-proposals/${J1}/bid-${B5}-manual-bid.pdf`)
  })

  test('bid on another job, bid from another sub, .docx bid → 400; nothing copied or written', async () => {
    expect(await post({ subcontract_id: SC1, source: 'bid_submission', id: B3 })).toEqual({ status: 400, body: { error: "That bid is not on this job's bid packages." } })
    expect(await post({ subcontract_id: SC1, source: 'bid_submission', id: B2 })).toEqual({ status: 400, body: { error: 'That bid is from a different sub.' } })
    expect(await post({ subcontract_id: SC1, source: 'bid_submission', id: B4 })).toEqual({ status: 400, body: { error: EXHIBIT_FILE_TYPE_MESSAGE } })
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: 'dddddddd-0000-4000-8000-0000000000ff' })).status).toBe(404)
    expect(copies()).toHaveLength(0)
    expect(scWrites()).toHaveLength(0)
  })

  test('job_document: copies this job’s doc; other job / outside "<job_id>/" / billing / .docx refused', async () => {
    expect((await post({ subcontract_id: SC1, source: 'job_document', id: D3 })).body.error).toBe('That document is not on this job.')
    expect((await post({ subcontract_id: SC1, source: 'job_document', id: D4 })).body.error).toBe('That document is not on this job.')
    expect((await post({ subcontract_id: SC1, source: 'job_document', id: D2 })).status).toBe(400)
    expect(await post({ subcontract_id: SC1, source: 'job_document', id: D5 })).toEqual({ status: 400, body: { error: EXHIBIT_FILE_TYPE_MESSAGE } })
    expect(scWrites()).toHaveLength(0)
    const r = await post({ subcontract_id: SC1, source: 'job_document', id: D1 })
    expect(r.status).toBe(200)
    expect(r.body.path).toBe(`bid-proposals/${J1}/doc-${D1}-plans.pdf`)
    expect(copies()[0]).toEqual(expect.objectContaining({ bucket: 'job-documents', path: `${J1}/plans.pdf` }))
  })

  test('proposal_file: linked in place (no copy); other job folder / in use / missing refused', async () => {
    expect((await post({ subcontract_id: SC1, source: 'proposal_file', path: `bid-proposals/${J2}/other-job.pdf` })).status).toBe(400)
    expect((await post({ subcontract_id: SC1, source: 'proposal_file', path: `bid-proposals/${J1}/../${J2}/other-job.pdf` })).status).toBe(400)
    expect(await post({ subcontract_id: SC1, source: 'proposal_file', path: USED })).toEqual({ status: 400, body: { error: 'That file is already Exhibit A for Other Co.', code: 'in_use' } })
    expect((await post({ subcontract_id: SC1, source: 'proposal_file', path: `bid-proposals/${J1}/gone.pdf` })).status).toBe(422)
    expect(scWrites()).toHaveLength(0)
    const r = await post({ subcontract_id: SC1, source: 'proposal_file', path: LOOSE })
    expect(r.body).toEqual({ ok: true, path: LOOSE, name: '1700000000002.pdf', replaced: false, copied: false })
    expect(copies()).toHaveLength(0)
    expect(sc(SC1).bid_proposal_url).toBe(LOOSE)
  })

  test('subcontract source: shares another subcontract’s proposal on the same job; same id refused', async () => {
    expect((await post({ subcontract_id: SC1, source: 'subcontract', id: SC1 })).status).toBe(400)
    expect((await post({ subcontract_id: SC3, source: 'subcontract', id: SC2 })).body.error).toBe('That subcontract is on a different job.')
    const r = await post({ subcontract_id: SC1, source: 'subcontract', id: SC2 })
    expect(r.status).toBe(200)
    expect(sc(SC1).bid_proposal_url).toBe(USED)
    expect(copies()).toHaveLength(0)
  })

  test('only-if-empty: 409 has_proposal, no copy and no write; replace:true replaces and logs', async () => {
    sc(SC1).bid_proposal_url = LOOSE
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r).toEqual({ status: 409, body: { error: 'This subcontract already has an Exhibit A (1700000000002.pdf). Confirm to replace it.', code: 'has_proposal', current: '1700000000002.pdf' } })
    expect(copies()).toHaveLength(0)
    expect(scWrites()).toHaveLength(0)
    const ok = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1, replace: true })
    expect(ok.body).toEqual(expect.objectContaining({ ok: true, path: B1_DEST, replaced: true, copied: true }))
    expect(sc(SC1).bid_proposal_url).toBe(B1_DEST)
    expect(mockState.files[`prime-contracts/${LOOSE}`]).toEqual(PDF) // the old file is never deleted
    await flush()
    expect(mockState.db.change_log[0]).toEqual(expect.objectContaining({ old_value: LOOSE, new_value: B1_DEST, note: "Exhibit A replaced from the sub's bid — Acme Plumbing" }))
  })

  test('retry with the same source after success → already_linked, no second copy, no write', async () => {
    await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    mockState.storageCalls = []; mockState.calls = []
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r).toEqual({ status: 200, body: { ok: true, already_linked: true, path: B1_DEST, name: `bid-${B1}-Acme-Bid-Co.pdf` } })
    expect(mockState.storageCalls).toHaveLength(0)
    expect(scWrites()).toHaveLength(0)
  })

  test('destination already copied but not linked → no copy, link saved', async () => {
    mockState.files[`prime-contracts/${B1_DEST}`] = PDF
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r.body).toEqual(expect.objectContaining({ ok: true, path: B1_DEST, copied: false }))
    expect(copies()).toHaveLength(0)
    expect(sc(SC1).bid_proposal_url).toBe(B1_DEST)
  })

  test('copy error → download + upload fallback stores the file', async () => {
    mockState.failCopy = { 'bid-docs': 'copy is broken' }
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r.body).toEqual(expect.objectContaining({ ok: true, path: B1_DEST, copied: true }))
    expect(mockState.storageCalls.some(c => c.op === 'download' && c.bucket === 'bid-docs' && c.path === B1_DOC)).toBe(true)
    expect(mockState.calls).toEqual(expect.arrayContaining([{ table: 'storage:prime-contracts', op: 'upload', payload: B1_DEST }]))
    expect(mockState.files[`prime-contracts/${B1_DEST}`]).toEqual(PDF)
  })

  test('fallback refuses a source over the size limit (413); upload failure is 502', async () => {
    mockState.failCopy = { 'bid-docs': 'copy is broken' }
    mockState.fileMeta[`bid-docs/${B1_DOC}`] = { size: 200 * 1024 * 1024 }
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).status).toBe(413)
    delete mockState.fileMeta[`bid-docs/${B1_DOC}`]
    mockState.failUpload = { 'prime-contracts': 'bucket offline' }
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r.status).toBe(502)
    expect(r.body.error).toMatch(/bucket offline/)
    expect(sc(SC1).bid_proposal_url).toBe(null)
  })

  test('source missing from storage → 422, nothing saved', async () => {
    delete mockState.files[`bid-docs/${B1_DOC}`]
    expect(await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })).toEqual({ status: 422, body: { error: 'The bid file is no longer in storage.' } })
    expect(scWrites()).toHaveLength(0)
  })

  test('signed + existing Exhibit A → 409 signed even with replace; signed + empty → allowed', async () => {
    sc(SC1).bid_proposal_url = LOOSE
    sc(SC1).signed_at = '2026-11-01T00:00:00Z'
    for (const replace of [false, true]) {
      const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1, replace })
      expect(r).toEqual({ status: 409, body: { error: "This subcontract is signed; Exhibit A can't be changed.", code: 'signed' } })
    }
    seed()
    sc(SC1).bid_proposal_url = LOOSE
    mockState.db.signing_requests = [{ id: 'sr1', subcontract_id: SC1, status: 'signed' }]
    expect((await post({ subcontract_id: SC1, source: 'bid_submission', id: B1, replace: true })).body.code).toBe('signed')
    expect(copies()).toHaveLength(0)
    seed()
    sc(SC1).signed_at = '2026-11-01T00:00:00Z'
    const ok = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(ok.status).toBe(200)
    expect(sc(SC1).bid_proposal_url).toBe(B1_DEST)
  })

  test('guarded update: filled meanwhile → 409 has_proposal, the other value kept', async () => {
    mockState.beforeWrite = (table, op) => { if (table === 'subcontracts' && op === 'update') sc(SC1).bid_proposal_url = LOOSE }
    const r = await post({ subcontract_id: SC1, source: 'bid_submission', id: B1 })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('has_proposal')
    expect(sc(SC1).bid_proposal_url).toBe(LOOSE)
    await flush()
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test('mock .or() blank-column form filters; other forms remain no-ops', async () => {
    const { supabaseModule } = require('./helpers/mock-db')
    const db = supabaseModule.createClient()
    const { data } = await db.from('subcontracts').select('id').or('bid_proposal_url.is.null,bid_proposal_url.eq.')
    expect(data.map(r => r.id).sort()).toEqual([SC1, SC3])
    const { data: all } = await db.from('subcontracts').select('id').or('status.is.null,status.eq.active')
    expect(all).toHaveLength(3)
  })
})

// ── 3. GET route ──────────────────────────────────────────────────────────────
describe('GET /api/subcontracts/attach-bid', () => {
  beforeEach(() => seed())

  test('lists this sub’s bids on this job, unlinked proposal files, job docs minus billing; type_ok', async () => {
    mockState.fileCreatedAt[`prime-contracts/${LOOSE}`] = '2026-11-02'
    const r = await get(SC1)
    expect(r.status).toBe(200)
    expect(r.body.current).toBe(null)
    expect(r.body.bids.map(b => [b.id, b.name, b.type_ok])).toEqual([
      [B5, 'manual bid.pdf', true],
      [B1, 'Acme Bid & Co.pdf', true],
      [B4, 'bid.docx', false],
    ])
    expect(r.body.bids[1]).toEqual(expect.objectContaining({ package_title: 'Plumbing', company_name: 'Acme Plumbing', status: 'awarded' }))
    expect(r.body.proposal_files).toEqual([{ path: LOOSE, name: '1700000000002.pdf', created_at: '2026-11-02', type_ok: true }])
    expect(r.body.job_documents.map(d => [d.id, d.type_ok])).toEqual([[D5, false], [D1, true]])
    expect(JSON.stringify(r.body)).not.toMatch(/signed|https?:/)
  })

  test('current proposal is reported and excluded from the unlinked files', async () => {
    sc(SC1).bid_proposal_url = LOOSE
    const r = await get(SC1)
    expect(r.body.current).toEqual({ path: LOOSE, name: '1700000000002.pdf' })
    expect(r.body.proposal_files).toEqual([])
  })

  test('denyJob enforced; sub role refused; a failed lookup is a 500, not a short list', async () => {
    as('pm', 'someone@nv.com')
    expect((await get(SC1)).status).toBe(403)
    as('subcontractor')
    expect((await get(SC1)).status).toBe(403)
    as('principal')
    mockState.failSelect = { job_documents: 'boom' }
    const r = await get(SC1)
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/boom/)
  })
})

// ── 4. dashboard (source) ─────────────────────────────────────────────────────
describe('dashboard: award → Exhibit A', () => {
  const src = read('app/dashboard/page.js')
  const fn = name => { const i = src.indexOf(`async function ${name}(`); return src.slice(i, src.indexOf('\n  }\n', i)) }

  test('attachBidAsExhibitA posts source bid_submission and skips without a file', () => {
    const h = fn('attachBidAsExhibitA')
    expect(h).toMatch(/if \(!subcontractId \|\| !submission\?\.doc_url\) return \{ ok: true, skipped: true \}/)
    expect(h).toMatch(/fetch\('\/api\/subcontracts\/attach-bid'/)
    expect(h).toMatch(/source: 'bid_submission', id: submission\.id/)
  })

  test('createJobFromBid reads the subcontract response, attaches awardedSub, alerts errors', () => {
    const c = fn('createJobFromBid')
    expect(c).toMatch(/const scData = await scRes\.json\(\)/)
    expect(c).toMatch(/alert\('Job created, but the subcontract was not saved: ' \+ scData\.error\)/)
    expect(c).toMatch(/attachBidAsExhibitA\(scData\.id, awardedSub\)/)
    expect(c).toMatch(/att\.code !== 'has_proposal'/)
    expect(c).toMatch(/Use "Choose Exhibit A" in Gen Contract/)
    expect(c.indexOf('attachBidAsExhibitA')).toBeLessThan(c.indexOf('router.push'))
  })

  test('saveSubcontract attaches after the save; has_proposal silent; other errors alerted', () => {
    const c = fn('saveSubcontract')
    expect(c).toMatch(/attachBidAsExhibitA\(id, sub\)/)
    expect(c.indexOf('id = data.id')).toBeLessThan(c.indexOf('attachBidAsExhibitA'))
    expect(c).toMatch(/if \(!att\.ok && att\.code !== 'has_proposal'\) alert\('Subcontract saved, but the bid PDF was not attached as Exhibit A: ' \+ att\.error\)/)
    expect(c).toMatch(/return id/)
  })
})

// ── 5. job page (source) ──────────────────────────────────────────────────────
describe('job page: Choose Exhibit A picker', () => {
  const src = read('app/jobdetail/page.js')

  test('button text, groups and the attach-bid calls', () => {
    expect(src).toContain('>Choose Exhibit A</button>')
    expect(src).toContain('>Change</button>')
    expect(src).toContain(`"This sub's bids"`)
    expect(src).toContain("'Unlinked proposal files on this job'")
    expect(src).toContain("'Job documents'")
    expect(src).toContain('PDF or image only')
    expect(src).toMatch(/fetch\(`\/api\/subcontracts\/attach-bid\?subcontract_id=/)
    expect(src).toMatch(/fetch\('\/api\/subcontracts\/attach-bid', \{\s*method: 'POST'/)
  })

  test('has_proposal → confirm → replace: true; success reloads contracts', () => {
    const i = src.indexOf('async function chooseExhibitA(')
    const c = src.slice(i, src.indexOf('\n  }\n', i))
    expect(c).toMatch(/r\.status === 409 && r\.data\.code === 'has_proposal'/)
    expect(c).toMatch(/window\.confirm\(`Replace Exhibit A \(/)
    expect(c).toMatch(/r = await post\(true\)/)
    expect(c).toMatch(/replace: true/)
    expect(c).toMatch(/await loadContracts\(\)/)
    expect(c).toMatch(/setContractGenMsg\(`Exhibit A set to \$\{item\.name\}\.`\)/)
  })

  test('missing Exhibit A cancel opens the picker (generate and e-sign); confirm text unchanged', () => {
    expect(src).toMatch(/if \(missingExhibitA\(check\)\) \{\s*openExhibitAPicker\(\)\s*setContractGenMsg\('Cancelled\. Nothing was generated\. Choose Exhibit A below, or generate again to continue without it\.'\)/)
    expect(src).toMatch(/if \(missingExhibitA\(check\)\) \{\s*openExhibitAPicker\(\)\s*setSignMsg\('Cancelled\. Nothing was sent\. Choose Exhibit A below/)
    expect(src).toMatch(/w\.key === 'proposal' \|\| w\.key === 'proposal_type'/)
    expect(src).toContain('setExhibitAPicker(EMPTY_EXHIBIT_A_PICKER)')
  })
})
