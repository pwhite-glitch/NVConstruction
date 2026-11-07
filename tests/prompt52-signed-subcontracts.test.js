/**
 * Prompt 52 (item 8): e-signed / upload-signed subcontracts count as signed.
 *  - isSubcontractSigned: signed_at, status 'signed', non-blank signed_contract_url, signed request
 *  - sub "upload signed contract" stamps signed_at / status 'signed', nothing else from the body
 *  - PUT terms lock and DELETE refuse URL-only and request-only signed contracts
 *  - jobDeleteBlockers and /api/jobs/delete see the same signals
 *  - migration 044's delete_job_if_unprotected uses the same rule; 042 untouched
 * In-memory DB only; nothing real is written and no migration is applied.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
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
jest.mock('../lib/sub-access', () => ({ canAccessSubcontract: async () => true }))

const { isSubcontractSigned } = require('../lib/signing')
const { jobDeleteBlockers } = require('../lib/job-lifecycle')
const subcontracts = require('../app/api/subcontracts/route')
const jobsDelete = require('../app/api/jobs/delete/route')

const J1 = '11111111-1111-4111-8111-111111111111'
const req = (method, body) => new Request('http://x/api', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const json = async r => ({ status: r.status, body: await r.json() })
const sc = (id, extra = {}) => ({ id, job_id: J1, vendor_name: `Vendor ${id}`, contract_value: 1000, description: 'Scope', special_terms: null, status: 'active', signed_at: null, signed_contract_url: null, ...extra })

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, job_type: 'commercial', status: 'active', archived: false, pm_email: 'pm@nv.com' }],
    subcontracts: [
      sc('plain'),
      sc('url', { signed_contract_url: `contracts/url/signed.pdf` }),
      sc('blankurl', { signed_contract_url: '   ' }),
      sc('req'),
    ],
    signing_requests: [{ id: 'sr1', subcontract_id: 'req', status: 'signed' }, { id: 'sr2', subcontract_id: 'plain', status: 'pending' }],
  })
  as('principal')
})

describe('isSubcontractSigned', () => {
  test('signed_at, status signed, non-blank URL, or a signed request', () => {
    expect(isSubcontractSigned({ signed_at: '2026-11-01T00:00:00Z' })).toBe(true)
    expect(isSubcontractSigned({ status: 'signed' })).toBe(true)
    expect(isSubcontractSigned({ status: 'active', signed_contract_url: 'contracts/x/a.pdf' })).toBe(true)
    expect(isSubcontractSigned({ status: 'active' }, { hasSignedRequest: true })).toBe(true)
    expect(isSubcontractSigned({ status: 'active', has_signed_request: true })).toBe(true)
  })
  test('blank URL, active unsigned, false request flag, nothing → not signed', () => {
    expect(isSubcontractSigned({ status: 'active', signed_contract_url: '   ' })).toBe(false)
    expect(isSubcontractSigned({ status: 'active', signed_contract_url: '' })).toBe(false)
    expect(isSubcontractSigned({ status: 'active', signed_contract_url: null })).toBe(false)
    expect(isSubcontractSigned({ status: 'active' }, { hasSignedRequest: false })).toBe(false)
    expect(isSubcontractSigned({ status: 'active', has_signed_request: false })).toBe(false)
    expect(isSubcontractSigned(null)).toBe(false)
  })
  test('safe as a filter callback (index as 2nd arg)', () => {
    expect([{ status: 'active' }, { status: 'signed' }].filter(isSubcontractSigned)).toHaveLength(1)
  })
})

describe('sub "upload signed contract"', () => {
  test('sets the URL and stamps signed_at / status signed', async () => {
    as('subcontractor')
    const r = await json(await subcontracts.PUT(req('PUT', { id: 'plain', signed_contract_url: 'contracts/plain/s.pdf' })))
    expect(r.status).toBe(200)
    const row = mockState.db.subcontracts.find(s => s.id === 'plain')
    expect(row.signed_contract_url).toBe('contracts/plain/s.pdf')
    expect(row.signed_at).toEqual(expect.any(String))
    expect(row.status).toBe('signed')
  })
  test('a sub still cannot send any other field (including signed_at / status)', async () => {
    as('subcontractor')
    for (const extra of [{ status: 'signed' }, { contract_value: 1 }]) {
      const r = await subcontracts.PUT(req('PUT', { id: 'plain', signed_contract_url: 'contracts/plain/s.pdf', ...extra }))
      expect(r.status).toBe(403)
    }
    expect(mockState.db.subcontracts.find(s => s.id === 'plain').signed_contract_url).toBeNull()
  })
})

describe('PUT terms lock', () => {
  test.each(['url', 'req'])('%s-signed: contract_value / description change → 409, nothing written', async id => {
    for (const fields of [{ contract_value: 2000 }, { description: 'New scope' }, { special_terms: 'x' }]) {
      const r = await json(await subcontracts.PUT(req('PUT', { id, ...fields })))
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/change order/)
    }
    expect(mockState.calls.filter(c => c.table === 'subcontracts' && c.op === 'update')).toHaveLength(0)
  })
  test('signed contract: non-term edits and unchanged terms still save', async () => {
    const r = await subcontracts.PUT(req('PUT', { id: 'url', contract_value: 1000, description: 'Scope', onedrive_url: 'https://od/x', retainage_pct: 5 }))
    expect(r.status).toBe(200)
    expect(mockState.db.subcontracts.find(s => s.id === 'url')).toMatchObject({ onedrive_url: 'https://od/x', retainage_pct: 5, contract_value: 1000 })
  })
  test('unsigned (and blank-URL) contracts can still change terms', async () => {
    for (const id of ['plain', 'blankurl']) {
      expect((await subcontracts.PUT(req('PUT', { id, contract_value: 2500 }))).status).toBe(200)
    }
  })
})

describe('DELETE', () => {
  test('URL-only signed → 409, kept', async () => {
    const r = await json(await subcontracts.DELETE(req('DELETE', { id: 'url' })))
    expect(r.status).toBe(409)
    expect(mockState.db.subcontracts.find(s => s.id === 'url')).toBeTruthy()
  })
  test('signed signing_request → still 409', async () => {
    const r = await json(await subcontracts.DELETE(req('DELETE', { id: 'req' })))
    expect(r.status).toBe(409)
    expect(mockState.db.subcontracts.find(s => s.id === 'req')).toBeTruthy()
  })
  test('unsigned with a blank URL can still be deleted', async () => {
    expect((await subcontracts.DELETE(req('DELETE', { id: 'blankurl' }))).status).toBe(200)
  })
})

describe('job delete', () => {
  test('jobDeleteBlockers: URL-only or signed-request-only subcontract blocks', () => {
    expect(jobDeleteBlockers({ subcontracts: [{ id: 'a', status: 'active', signed_contract_url: 'contracts/a/x.pdf' }] })).toEqual(['1 subcontract is signed.'])
    expect(jobDeleteBlockers({ subcontracts: [{ id: 'b', status: 'active', has_signed_request: true }] })).toEqual(['1 subcontract is signed.'])
    expect(jobDeleteBlockers({ subcontracts: [{ id: 'c', status: 'active', signed_contract_url: ' ' }] })).toEqual([])
  })
  test('/api/jobs/delete counts URL-only and request-only signed subcontracts and never calls the RPC', async () => {
    mockState.rpc.delete_job_if_unprotected = () => ({ data: { ok: true }, error: null })
    const r = await json(await jobsDelete.POST(req('POST', { job_id: J1 })))
    expect(r.status).toBe(409)
    expect(r.body.reasons).toContain('2 subcontracts are signed.')
    expect(mockState.calls.some(c => c.op === 'rpc')).toBe(false)
  })
  test('/api/jobs/delete passes through when no subcontract is signed', async () => {
    mockState.db.subcontracts = [sc('plain'), sc('blankurl', { signed_contract_url: '' })]
    mockState.db.signing_requests = [{ id: 'sr2', subcontract_id: 'plain', status: 'pending' }]
    mockState.rpc.delete_job_if_unprotected = () => ({ data: { ok: true }, error: null })
    expect((await jobsDelete.POST(req('POST', { job_id: J1 }))).status).toBe(200)
  })
})

describe('migration 044 (file only, not applied)', () => {
  const root = path.join(__dirname, '..')
  const sql = fs.readFileSync(path.join(root, 'migrations/044_job_lifecycle_and_schedule_access.sql'), 'utf8')
  const block = sql.slice(sql.indexOf('FROM public.subcontracts s'), sql.indexOf("subcontract(s) are signed"))
  test('signed-subcontract count includes URL and signed signing_requests', () => {
    expect(block).toMatch(/s\.signed_at IS NOT NULL/)
    expect(block).toMatch(/s\.status = 'signed'/)
    expect(block).toMatch(/btrim\(coalesce\(s\.signed_contract_url, ''\)\) <> ''/)
    expect(block).toMatch(/EXISTS \(SELECT 1 FROM public\.signing_requests sr\s+WHERE sr\.subcontract_id::text = s\.id::text AND sr\.status = 'signed'\)/)
    expect(sql).not.toMatch(/AND \(s\.signed_at IS NOT NULL OR s\.status = 'signed'\);/)
  })
  test('no data backfill: no UPDATE of subcontracts / signing_requests', () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.(subcontracts|signing_requests)/i)
  })
  test('042 is untouched vs HEAD', () => {
    const diff = execSync('git diff --name-only HEAD -- migrations/042_drawings_aia_numbers_owner_draws.sql', { cwd: root }).toString().trim()
    expect(diff).toBe('')
  })
})
