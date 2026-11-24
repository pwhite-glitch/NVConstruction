/**
 * Prompt 102: sub company address as street / city / state / ZIP (stored composed in the one
 * sub_directory.address column), required at /apply + /register, editable by the sub from
 * My Documents via /api/sub-docs address_parts, and the same contract-address lookup for the
 * Gen Contract form and /api/sub-initiate-sign. DB/auth are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    SUB_ROLES: SUB,
    requireAuth: async () => (mockState.auth ? mockState.auth : unauth()),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
jest.mock('../lib/sub-access', () => ({ getSubContracts: async () => [] }))
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: async () => ({ data: { id: 'em' }, error: null }) } } } }))

const A = require('../lib/sub-address')
const G = require('../lib/subcontract-generator')
const registerCompany = require('../app/api/register-company/route')
const subDocs = require('../app/api/sub-docs/route')
const initiate = require('../app/api/sub-initiate-sign/route')

// The shared mock client has no .upsert() (register-company upserts the profile); add a
// minimal one here, recorded in mockState.calls, without changing the shared helper.
{
  const client = require('./helpers/mock-db').supabaseModule.createClient()
  const from = client.from
  client.from = t => Object.assign(from(t), { upsert: p => { mockState.calls.push({ table: t, op: 'upsert', payload: p }); return Promise.resolve({ data: null, error: null }) } })
}

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const req = (body, headers = {}) => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const out = async r => ({ status: r.status, body: await r.json() })
const PARTS = { street: ' 123 Main St ', city: 'Dallas', state: 'tx', zip: '75201' }

// ── 1. helpers ───────────────────────────────────────────────────────────────
describe('lib/sub-address', () => {
  test('composeAddress formats "street, City, ST 12345"', () => {
    expect(A.composeAddress(PARTS)).toBe('123 Main St, Dallas, TX 75201')
    expect(A.composeAddress({ ...PARTS, zip: '752011234' })).toBe('123 Main St, Dallas, TX 75201-1234')
    expect(A.composeAddress({ ...PARTS, zip: '75201-1234', city: '  Fort   Worth ' })).toBe('123 Main St, Fort Worth, TX 75201-1234')
  })
  test('addressPartsError: required parts', () => {
    expect(A.addressPartsError(PARTS)).toBeNull()
    expect(A.addressPartsError(null)).toMatch(/Street/)
    expect(A.addressPartsError({ ...PARTS, street: '  ' })).toMatch(/Street/)
    expect(A.addressPartsError({ ...PARTS, city: '' })).toMatch(/City/)
    expect(A.addressPartsError({ ...PARTS, state: '' })).toMatch(/State/)
    expect(A.addressPartsError({ ...PARTS, zip: '' })).toMatch(/ZIP/)
  })
  test('addressPartsError: state is 2 letters, ZIP 5 or 9 digits', () => {
    expect(A.addressPartsError({ ...PARTS, state: 'Tex' })).toMatch(/State/)
    expect(A.addressPartsError({ ...PARTS, state: 'T1' })).toMatch(/State/)
    expect(A.addressPartsError({ ...PARTS, state: 'tx' })).toBeNull()
    expect(A.composeAddress({ ...PARTS, state: 'tx' })).toMatch(/, TX 75201$/)
    expect(A.addressPartsError({ ...PARTS, zip: '7520' })).toMatch(/ZIP/)
    expect(A.addressPartsError({ ...PARTS, zip: '7520a' })).toMatch(/ZIP/)
    for (const zip of ['75201', '75201-1234', '752011234']) expect(A.addressPartsError({ ...PARTS, zip })).toBeNull()
  })
  test('addressPartsError: length caps', () => {
    expect(A.addressPartsError({ ...PARTS, street: 'x'.repeat(201) })).toMatch(/200/)
    expect(A.addressPartsError({ ...PARTS, city: 'x'.repeat(101) })).toMatch(/100/)
    expect(A.addressPartsError({ ...PARTS, street: 'x'.repeat(200), city: 'y'.repeat(100) })).toBeNull()
  })
  test('isBlankAddress', () => {
    for (const v of [null, undefined, '', '   ', '\n']) expect(A.isBlankAddress(v)).toBe(true)
    expect(A.isBlankAddress('1 Main St')).toBe(false)
  })
  test('parseAddress round-trips composed addresses; otherwise empty', () => {
    expect(A.parseAddress('123 Main St, Dallas, TX 75201')).toEqual({ street: '123 Main St', city: 'Dallas', state: 'TX', zip: '75201' })
    expect(A.parseAddress('PO Box 4, Suite 2, Tyler, tx 75701-1234')).toEqual({ street: 'PO Box 4, Suite 2', city: 'Tyler', state: 'TX', zip: '75701-1234' })
    expect(A.parseAddress('somewhere in Texas')).toEqual({ street: '', city: '', state: '', zip: '' })
    expect(A.parseAddress(null)).toEqual({ street: '', city: '', state: '', zip: '' })
  })
})

// ── 2. contract address precedence ───────────────────────────────────────────
describe('resolveContractAddresses', () => {
  const job = { job_number: '1', owner_address: 'Job Owner Addr' }
  const sub = { id: 'd1', address: 'Dir Sub Addr' }
  const lj = { owner_address: 'Latest Owner' }
  const ls = { sub_address: 'Latest Sub' }
  test('saved > directory / job > latest', () => {
    expect(G.resolveContractAddresses({ saved: { sub_address: 'Saved Sub', owner_address: 'Saved Owner' }, sub, job, latestJobFields: lj, latestSubFields: ls }))
      .toEqual({ sub_address: 'Saved Sub', owner_address: 'Saved Owner' })
    expect(G.resolveContractAddresses({ saved: { sub_address: ' ' }, sub, job, latestJobFields: lj, latestSubFields: ls }))
      .toEqual({ sub_address: 'Dir Sub Addr', owner_address: 'Job Owner Addr' })
    expect(G.resolveContractAddresses({ sub: { address: '' }, job: {}, latestJobFields: lj, latestSubFields: ls }))
      .toEqual({ sub_address: 'Latest Sub', owner_address: 'Latest Owner' })
    expect(G.resolveContractAddresses({})).toEqual({ sub_address: '', owner_address: '' })
  })
  test('buildGeneratorDefaults uses the same values', () => {
    const cases = [
      { saved: { sub_address: 'S', owner_address: 'O' }, sub, job, latestJobFields: lj, latestSubFields: ls },
      { saved: null, sub, job, latestJobFields: lj, latestSubFields: ls },
      { saved: null, sub: null, job: { job_number: '1' }, latestJobFields: lj, latestSubFields: ls },
      { saved: null, sub: null, job: null },
    ]
    for (const c of cases) {
      const f = G.buildGeneratorDefaults({ ...c, subcontract: { id: 'sc' } })
      expect({ sub_address: f.sub_address, owner_address: f.owner_address }).toEqual(G.resolveContractAddresses(c))
    }
  })
})

// ── 3. register-company ──────────────────────────────────────────────────────
describe('register-company requires a valid address before writing', () => {
  beforeEach(() => {
    resetMockState({ profiles: [], companies: [], sub_directory: [] })
    mockState.auth = { userId: 'u-new', email: 'new@sub.co', role: 'subcontractor', error: null }
  })
  const base = { user_id: 'u-new', email: 'new@sub.co', company_name: 'New Sub LLC' }
  const auth = { authorization: 'Bearer t' }

  test('missing address → 400, nothing inserted', async () => {
    const r = await out(await registerCompany.POST(req(base, auth)))
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Company address is required.')
    expect(mockState.calls).toEqual([])
    const blank = await out(await registerCompany.POST(req({ ...base, address: '   ' }, auth)))
    expect(blank.status).toBe(400)
    expect(mockState.calls).toEqual([])
  })
  test('invalid parts → 400 with the message, nothing inserted', async () => {
    const r = await out(await registerCompany.POST(req({ ...base, address_parts: { ...PARTS, zip: '7520' } }, auth)))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/ZIP/)
    // Even with a valid plain address alongside, bad parts are rejected.
    const r2 = await out(await registerCompany.POST(req({ ...base, address: '1 Elm, Tyler, TX 75701', address_parts: { ...PARTS, state: 'Tex' } }, auth)))
    expect(r2.status).toBe(400)
    expect(mockState.calls).toEqual([])
  })
  test('valid parts → composed address stored on the pending directory row', async () => {
    const r = await out(await registerCompany.POST(req({ ...base, address_parts: PARTS }, auth)))
    expect(r.status).toBe(200)
    const dir = mockState.db.sub_directory[0]
    expect(dir.address).toBe('123 Main St, Dallas, TX 75201')
    expect(dir.status).toBe('pending')
  })
  test('a plain non-blank address string is still accepted', async () => {
    const r = await out(await registerCompany.POST(req({ ...base, address: ' 9 Oak Ln, Tyler, TX 75701 ' }, auth)))
    expect(r.status).toBe(200)
    expect(mockState.db.sub_directory[0].address).toBe('9 Oak Ln, Tyler, TX 75701')
  })
})

// ── 4. sub-docs ──────────────────────────────────────────────────────────────
describe('sub-docs: sub sets their own address via address_parts only', () => {
  const MINE = 'dir-mine', OTHER = 'dir-other'
  beforeEach(() => {
    resetMockState({ sub_directory: [
      { id: MINE, email: 'sub@co.co', company_name: 'Mine', address: null, w9_url: `${MINE}/w9.pdf`, coi_url: null, coi_expiration: '2027-01-01' },
      { id: OTHER, email: 'other@co.co', company_name: 'Other', address: 'Old', w9_url: null, coi_url: null },
    ] })
    mockState.auth = { userId: 'sub1', email: 'sub@co.co', role: 'subcontractor', error: null }
  })
  const row = id => mockState.db.sub_directory.find(d => d.id === id)

  test('own row: composed address saved, documents untouched', async () => {
    const r = await out(await subDocs.POST(req({ directory_id: MINE, address_parts: PARTS })))
    expect(r.status).toBe(200)
    expect(r.body.address).toBe('123 Main St, Dallas, TX 75201')
    expect(row(MINE)).toMatchObject({ address: '123 Main St, Dallas, TX 75201', w9_url: `${MINE}/w9.pdf`, coi_expiration: '2027-01-01' })
  })
  test('invalid parts → 400, nothing written', async () => {
    const r = await out(await subDocs.POST(req({ directory_id: MINE, address_parts: { ...PARTS, state: 'T1' } })))
    expect(r.status).toBe(400)
    expect(row(MINE).address).toBeNull()
    expect(mockState.calls.filter(c => c.op === 'update')).toEqual([])
  })
  test("another sub's row → 403", async () => {
    const r = await subDocs.POST(req({ directory_id: OTHER, address_parts: PARTS }))
    expect(r.status).toBe(403)
    expect(row(OTHER).address).toBe('Old')
  })
  test('raw `address` from a sub is ignored', async () => {
    const r = await subDocs.POST(req({ directory_id: MINE, address: 'Typed free text' }))
    expect(r.status).toBe(200)
    expect(row(MINE).address).toBeNull()
  })
  test('office keeps free-text address editing', async () => {
    mockState.auth = { userId: 'pm1', email: 'pm@nv.co', role: 'pm', error: null }
    const r = await subDocs.POST(req({ directory_id: OTHER, address: 'Anything, really' }))
    expect(r.status).toBe(200)
    expect(row(OTHER).address).toBe('Anything, really')
  })
})

// ── 5. sub-initiate-sign fills the addresses ─────────────────────────────────
describe('sub-initiate-sign: contract addresses', () => {
  const SC = 'aaaaaaaa-0000-4000-8000-000000000102'
  function seed({ generator_fields = null, dir = [] } = {}) {
    resetMockState({
      jobs: [{ id: 'job1', job_number: '264', project_name: 'Proj', location: 'Longview', owner_address: '1420 W Loop 281, Longview TX 75603' }],
      subcontracts: [{ id: SC, job_id: 'job1', sub_id: 'subuser', company_id: 'co1', vendor_name: 'JC Concreteworks LLC', description: 'Concrete', contract_value: 1000, status: 'active', generator_fields }],
      profiles: [{ id: 'subuser', full_name: 'Jane Doe' }],
      sub_directory: dir,
      signing_requests: [],
    })
    mockState.defaults = { signing_requests: () => ({ status: 'pending', token: 'tok-102' }) }
    mockState.auth = { userId: 'subuser', role: 'subcontractor', companyId: 'co1' }
  }
  const html = () => mockState.db.signing_requests[0].document_html

  test('Directory row (by login email) + job owner address', async () => {
    seed({ dir: [{ id: 'd1', email: 'subuser@x.com', company_name: 'Something Else', status: 'approved', address: '55 Pine St, Tyler, TX 75701' }] })
    expect((await initiate.POST(req({ subcontract_id: SC }))).status).toBe(200)
    expect(html()).toContain('55 Pine St, Tyler, TX 75701')
    expect(html()).toContain('1420 W Loop 281, Longview TX 75603')
  })
  test('saved generator_fields win; pending Directory rows are not used', async () => {
    seed({
      generator_fields: { sub_address: 'Saved Sub Addr', owner_address: 'Saved Owner Addr' },
      dir: [{ id: 'd1', email: 'subuser@x.com', company_name: 'JC Concreteworks LLC', status: 'approved', address: 'Dir Addr' }],
    })
    expect((await initiate.POST(req({ subcontract_id: SC }))).status).toBe(200)
    expect(html()).toContain('Saved Sub Addr')
    expect(html()).toContain('Saved Owner Addr')
    expect(html()).not.toContain('Dir Addr')

    seed({ dir: [{ id: 'd1', email: 'subuser@x.com', company_name: 'JC Concreteworks LLC', status: 'pending', address: 'Pending Addr' }] })
    expect((await initiate.POST(req({ subcontract_id: SC }))).status).toBe(200)
    expect(html()).not.toContain('Pending Addr')
  })
  test('a failed Directory read leaves the sub address blank, request still succeeds', async () => {
    seed()
    mockState.failSelect = { sub_directory: 'boom' }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await initiate.POST(req({ subcontract_id: SC }))).status).toBe(200)
    expect(html()).toContain('1420 W Loop 281, Longview TX 75603')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ── 6. pages wired up (static checks) ────────────────────────────────────────
describe('pages', () => {
  test('/apply validates parts in step 1 (before signUp) and posts address_parts', () => {
    const p = read('app/apply/page.js')
    const goNext = p.slice(p.indexOf('function goNext'), p.indexOf('async function uploadDoc'))
    expect(goNext).toMatch(/addressPartsError\(company\)/)
    expect(p).toMatch(/address_parts: \{ street: company\.street/)
    expect(p).toMatch(/maxLength=\{2\}/)
    expect(p).toMatch(/inputMode="numeric"/)
  })
  test('/register validates before signUp and posts address_parts', () => {
    const p = read('app/register/page.js')
    expect(p.indexOf('addressPartsError(form)')).toBeGreaterThan(-1)
    expect(p.indexOf('addressPartsError(form)')).toBeLessThan(p.indexOf('supabase.auth.signUp'))
    expect(p).toMatch(/address_parts:/)
  })
  test('Gen Contract warns on blank addresses before exhibitCheck in both actions', () => {
    const p = read('app/jobdetail/page.js')
    for (const fn of ['function generateSubcontract()', 'async function sendForESign()']) {
      const body = p.slice(p.indexOf(fn), p.indexOf(fn) + 1200)
      expect(body.indexOf('confirmContractAddresses()')).toBeGreaterThan(-1)
      expect(body.indexOf('confirmContractAddresses()')).toBeLessThan(body.indexOf('exhibitCheck('))
    }
    expect(p).toMatch(/No Directory entry matched this sub/)
  })
  test('Directory lists show a "No address" badge', () => {
    expect(read('app/admin/page.js')).toMatch(/isBlankAddress\(d\.address\) && <span[^>]*>No address</)
    expect(read('app/admin/page.js')).toMatch(/value="missing-address"/)
    expect(read('app/dashboard/page.js')).toMatch(/isBlankAddress\(sub\.address\) && <span[^>]*>No address</)
  })
})
