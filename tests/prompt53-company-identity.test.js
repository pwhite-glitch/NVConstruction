/**
 * Prompt 53 findings 3 + 10: company identity safety.
 *  3. Directory edits never cascade into subcontracts / prime COs; a company-name
 *     change needs a reviewed confirm (preview → confirm_rename + expected_old_name
 *     + reviewed company_id); shared company renamed only by exact unique id.
 * 10. Fix Company Links: read-only review list, principal/pm only, links only
 *     selected unlinked sub users with approved Directory evidence by login email;
 *     no contract cascade; stale reviews cannot relink.
 * In-memory DB only; nothing real is written.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState, supabaseModule } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const deny = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : deny()),
    requireRole: async (req, roles) => (roles.includes(mockState.auth.role) ? mockState.auth : deny()),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
    SUB_ROLES: new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']),
  }
})
jest.mock('../lib/sub-access', () => ({ getSubContracts: async () => [] }))

const subDocs = require('../app/api/sub-docs/route')
const links = require('../app/api/repair-company-links/route')
const { prepareDirectorySave, renameConfirmMessage, classifyLinkCandidate } = require('../lib/company-identity')

const client = supabaseModule.createClient()
const realGetUser = client.auth.admin.getUserById
let authEmails = {}

const post = body => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const get = qs => new Request(`http://x/api?${qs}`)
const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const json = async r => ({ status: r.status, body: await r.json() })
const writes = t => mockState.calls.filter(c => c.table === t && c.op !== 'select')

beforeEach(() => {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '7001', project_name: 'One' }, { id: 'J2', job_number: '7002', project_name: 'Two' }],
    sub_directory: [
      { id: 'D1', company_name: 'Acme Steel', email: 'boss@acme.com', status: 'approved' },
      { id: 'Dp', company_name: '50% Off_Co\\', email: 'p@pct.com', status: 'approved' },
      { id: 'Dpend', company_name: 'Acme Steel', email: 'pending@acme.com', status: 'pending' },
      { id: 'Drej', company_name: 'Acme Steel', email: 'rej@acme.com', status: 'rejected' },
      { id: 'Dok2', company_name: 'Acme Steel', email: 'worker@acme.com', status: 'approved' },
      { id: 'Ddup', company_name: 'Twin Co', email: 't@twin.com', status: 'approved' },
    ],
    companies: [
      { id: 'C1', name: 'Acme Steel' },
      { id: 'C2', name: 'Acme Steel Supply' },
      { id: 'Cpct', name: '50% Off_Co\\' },
      { id: 'Cother', name: '5000 OffXCo' },
      { id: 'Ct1', name: 'Twin Co' },
      { id: 'Ct2', name: 'twin co' },
    ],
    subcontracts: [
      { id: 'S1', job_id: 'J1', vendor_name: 'Acme Steel', status: 'signed', signed_at: '2026-10-01' },
      { id: 'S2', job_id: 'J2', vendor_name: 'Acme Steel', status: 'active' },
      { id: 'S3', job_id: 'J2', vendor_name: 'Acme Steel Supply', status: 'active' },
    ],
    prime_change_orders: [{ id: 'P1', description: 'Acme Steel — extra beams' }],
    profiles: [
      { id: 'pBoss', role: 'subcontractor', company_id: null, company_name: 'Acme Steel', invite_email: 'boss@acme.com', full_name: 'Boss' },
      { id: 'pWorker', role: 'sub_pm', company_id: null, company_name: 'Acme Steel', invite_email: 'worker@acme.com', full_name: 'Worker' },
      { id: 'pPend', role: 'subcontractor', company_id: null, company_name: 'Acme Steel', invite_email: 'pending@acme.com' },
      { id: 'pRej', role: 'subcontractor', company_id: null, company_name: 'Acme Steel', invite_email: 'rej@acme.com' },
      { id: 'pOffice', role: 'pm', company_id: null, company_name: 'Acme Steel', invite_email: 'boss@acme.com' },
      { id: 'pLinked', role: 'subcontractor', company_id: 'C2', company_name: 'Acme Steel', invite_email: 'boss@acme.com' },
      { id: 'pNoApp', role: 'subcontractor', company_id: null, company_name: 'Acme Steel', invite_email: 'stranger@x.com' },
      { id: 'pSpoof', role: 'subcontractor', company_id: null, company_name: 'Acme Steel', invite_email: 'boss@acme.com' },
    ],
  })
  // Trustworthy login emails come from auth, not profiles.invite_email:
  // pSpoof typed the boss's email as invite_email but logs in as someone else.
  authEmails = { pBoss: 'Boss@Acme.com', pWorker: 'worker@acme.com', pPend: 'pending@acme.com', pRej: 'rej@acme.com', pOffice: 'boss@acme.com', pLinked: 'boss@acme.com', pNoApp: 'stranger@x.com', pSpoof: 'spoof@evil.com' }
  client.auth.admin.getUserById = async id => ({ data: { user: authEmails[id] ? { id, email: authEmails[id] } : null }, error: null })
  as('principal')
})
afterAll(() => { client.auth.admin.getUserById = realGetUser })

// ── Finding 3 ────────────────────────────────────────────────────────────────
describe('finding 3: Directory save / rename', () => {
  test('ordinary contact save writes only sub_directory — no financial cascades', async () => {
    const r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'Acme Steel', phone: '555', contact_name: 'Bob' })))
    expect(r.status).toBe(200)
    expect(writes('sub_directory')).toHaveLength(1)
    expect(writes('subcontracts')).toHaveLength(0)
    expect(writes('companies')).toHaveLength(0)
    expect(writes('prime_change_orders')).toHaveLength(0)
    expect(mockState.db.sub_directory[0].phone).toBe('555')
  })

  test('name change without confirmation is refused with nothing written', async () => {
    const r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'Acme Steel LLC' })))
    expect(r.status).toBe(409)
    expect(r.body.rename_required).toBe(true)
    expect(mockState.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })

  test('preview lists exact company + kept contracts; confirmed rename changes directory + company by id only', async () => {
    const pv = await json(await subDocs.POST(post({ action: 'rename-preview', directory_id: 'D1', company_name: 'Acme Steel LLC' })))
    expect(pv.status).toBe(200)
    expect(pv.body.preview).toMatchObject({ old_name: 'Acme Steel', new_name: 'Acme Steel LLC', company_id: 'C1', contracts_kept: 2, other_jobs: 0 })
    expect(pv.body.preview.jobs.map(j => j.job_number).sort()).toEqual(['7001', '7002'])
    expect(mockState.calls.filter(c => c.op !== 'select')).toHaveLength(0) // preview is read-only

    const r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'Acme Steel LLC', confirm_rename: true, expected_old_name: 'Acme Steel', company_id: 'C1' })))
    expect(r.status).toBe(200)
    expect(r.body.renamed).toEqual({ from: 'Acme Steel', to: 'Acme Steel LLC', company_renamed: true })
    expect(mockState.db.companies.find(c => c.id === 'C1').name).toBe('Acme Steel LLC')
    expect(mockState.db.companies.find(c => c.id === 'C2').name).toBe('Acme Steel Supply') // no pattern rename
    expect(mockState.db.subcontracts.map(s => s.vendor_name)).toEqual(['Acme Steel', 'Acme Steel', 'Acme Steel Supply'])
    expect(mockState.db.prime_change_orders[0].description).toBe('Acme Steel — extra beams')
    expect(writes('subcontracts')).toHaveLength(0)
    expect(writes('prime_change_orders')).toHaveLength(0)
    expect(writes('companies')[0].ids).toEqual(['C1'])
  })

  test('PM preview hides job numbers of jobs they are not on (counted only)', async () => {
    as('pm')
    mockState.db.pm_job_assignments = [{ id: 'a', job_id: 'J1', user_id: 'u-pm' }]
    const pv = await json(await subDocs.POST(post({ action: 'rename-preview', directory_id: 'D1', company_name: 'X' })))
    expect(pv.body.preview.jobs.map(j => j.id)).toEqual(['J1'])
    expect(pv.body.preview.other_jobs).toBe(1)
  })

  test('stale expected_old_name or reviewed company_id is refused, nothing written', async () => {
    let r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'New', confirm_rename: true, expected_old_name: 'Old', company_id: 'C1' })))
    expect(r.status).toBe(409)
    r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'New', confirm_rename: true, expected_old_name: 'Acme Steel', company_id: null })))
    expect(r.status).toBe(409)
    expect(mockState.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })

  test('%, _ and backslash names are literal; duplicate names never pick a company', async () => {
    let pv = await json(await subDocs.POST(post({ action: 'rename-preview', directory_id: 'Dp', company_name: 'Pct Co' })))
    expect(pv.body.preview.company_id).toBe('Cpct')
    pv = await json(await subDocs.POST(post({ action: 'rename-preview', directory_id: 'Ddup', company_name: 'Twin Two' })))
    expect(pv.body.preview.company_id).toBeNull()
    expect(pv.body.preview.company_note).toMatch(/2 companies/)
    const r = await json(await subDocs.POST(post({ directory_id: 'Ddup', company_name: 'Twin Two', confirm_rename: true, expected_old_name: 'Twin Co', company_id: null })))
    expect(r.status).toBe(200)
    expect(r.body.renamed.company_renamed).toBe(false)
    expect(mockState.db.companies.filter(c => /twin/i.test(c.name)).map(c => c.name)).toEqual(['Twin Co', 'twin co'])
  })

  test('company rename failure fails the request before the directory changes', async () => {
    mockState.missingCols = { companies: ['name'] }
    const r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'Acme LLC', confirm_rename: true, expected_old_name: 'Acme Steel', company_id: 'C1' })))
    expect(r.status).toBe(500)
    expect(mockState.db.sub_directory[0].company_name).toBe('Acme Steel')
  })

  test('directory write failure after company rename puts the company name back', async () => {
    mockState.missingCols = { sub_directory: ['company_name'] }
    const r = await json(await subDocs.POST(post({ directory_id: 'D1', company_name: 'Acme LLC', confirm_rename: true, expected_old_name: 'Acme Steel', company_id: 'C1' })))
    expect(r.status).toBe(500)
    expect(r.body.partial).toBeUndefined()
    expect(mockState.db.companies.find(c => c.id === 'C1').name).toBe('Acme Steel')
  })

  test('directory insert uses literal unique company identity (no wildcard / arbitrary pick)', async () => {
    let r = await json(await subDocs.POST(post({ action: 'insert', company_name: 'twin co' })))
    expect(r.body.company_id).toBeNull()
    expect(r.body.company_note).toMatch(/More than one/)
    r = await json(await subDocs.POST(post({ action: 'insert', company_name: '50% Off_Co\\' })))
    expect(r.body.company_id).toBe('Cpct')
  })

  test('client confirm: cancel → no save; confirm → reviewed fields; unchanged name → no preview', async () => {
    const preview = { old_name: 'Acme Steel', new_name: 'Acme LLC', company_id: 'C1', company_note: 'n', contracts_kept: 2, jobs: [{ job_number: '7001' }], other_jobs: 1 }
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => ({ preview }) }))
    let msg
    const cancel = await prepareDirectorySave({ fetchFn, confirmFn: m => { msg = m; return false }, directoryId: 'D1', originalName: 'Acme Steel', newName: 'Acme LLC' })
    expect(cancel).toEqual({ proceed: false })
    expect(msg).toMatch(/"Acme Steel" to "Acme LLC"/)
    expect(msg).toMatch(/7001, \+1 other job/)
    expect(msg).toMatch(/will NOT change/i)
    const ok = await prepareDirectorySave({ fetchFn, confirmFn: () => true, directoryId: 'D1', originalName: 'Acme Steel', newName: 'Acme LLC' })
    expect(ok.extra).toEqual({ confirm_rename: true, expected_old_name: 'Acme Steel', company_id: 'C1' })
    fetchFn.mockClear()
    const same = await prepareDirectorySave({ fetchFn, confirmFn: () => false, directoryId: 'D1', originalName: 'Acme Steel', newName: ' Acme Steel ' })
    expect(same).toEqual({ proceed: true, extra: {} })
    expect(fetchFn).not.toHaveBeenCalled()
    const err = await prepareDirectorySave({ fetchFn: async () => ({ ok: false, json: async () => ({ error: 'nope' }) }), confirmFn: () => true, directoryId: 'D1', originalName: 'a', newName: 'b' })
    expect(err).toEqual({ error: 'nope' })
  })

  test('dashboard and admin both use the reviewed rename confirm', () => {
    for (const f of ['app/dashboard/page.js', 'app/admin/page.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      expect(src).toMatch(/prepareDirectorySave\(/)
      expect(src).toMatch(/\.\.\.prep\.extra/)
    }
    expect(renameConfirmMessage({ old_name: 'A', new_name: 'B', company_note: 'x', contracts_kept: 0 })).toMatch(/none are recorded/)
  })
})

// ── Finding 10 ───────────────────────────────────────────────────────────────
describe('finding 10: Fix Company Links review', () => {
  test('principal/pm only on review and mutation', async () => {
    for (const role of ['apm', 'super', 'admin', 'subcontractor']) {
      as(role)
      expect((await links.GET(get('directory_id=D1'))).status).toBe(403)
      expect((await links.POST(post({ company_id: 'C1', directory_id: 'D1', profile_ids: ['pBoss'] }))).status).toBe(403)
    }
    as('pm')
    expect((await links.GET(get('directory_id=D1'))).status).toBe(200)
  })

  test('review list is read-only and classifies people', async () => {
    const r = await json(await links.GET(get('directory_id=D1')))
    expect(r.status).toBe(200)
    expect(r.body.company).toEqual({ id: 'C1', name: 'Acme Steel' })
    expect(r.body.candidates.map(c => c.id).sort()).toEqual(['pBoss', 'pWorker'])
    const why = Object.fromEntries(r.body.excluded.map(x => [x.id, x.reason]))
    expect(why.pPend).toMatch(/pending/)
    expect(why.pRej).toMatch(/rejected/)
    expect(why.pOffice).toMatch(/office/)
    expect(why.pLinked).toMatch(/another company/)
    expect(why.pNoApp).toMatch(/No Directory application/)
    expect(why.pSpoof).toMatch(/No Directory application/)
    expect(mockState.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })

  test('pending Directory entry cannot be used; missing company is reported, not created', async () => {
    expect((await links.GET(get('directory_id=Dpend'))).status).toBe(409)
    mockState.db.companies = mockState.db.companies.filter(c => c.id !== 'C1')
    const r = await json(await links.GET(get('directory_id=D1')))
    expect(r.body.company).toBeNull()
    expect(r.body.company_reason).toBe('none')
    expect(writes('companies')).toHaveLength(0)
  })

  test('only selected eligible people link; unselected untouched; no contract cascade', async () => {
    mockState.db.subcontracts.push({ id: 'S9', job_id: 'J1', vendor_name: 'Acme Steel', company_id: null })
    const r = await json(await links.POST(post({ company_id: 'C1', directory_id: 'D1', profile_ids: ['pBoss', 'pPend', 'pOffice', 'pLinked'] })))
    expect(r.status).toBe(200)
    expect(r.body.linked.map(x => x.id)).toEqual(['pBoss'])
    expect(r.body.skipped.map(x => x.id).sort()).toEqual(['pLinked', 'pOffice', 'pPend'])
    const p = id => mockState.db.profiles.find(x => x.id === id)
    expect(p('pBoss').company_id).toBe('C1')
    expect(p('pWorker').company_id).toBeNull() // eligible but not selected
    expect(p('pLinked').company_id).toBe('C2')
    expect(p('pOffice').company_id).toBeNull()
    expect(writes('subcontracts')).toHaveLength(0)
    expect(mockState.db.subcontracts.find(s => s.id === 'S9').company_id).toBeNull()
  })

  test('stale review: someone linked meanwhile → skipped, never moved', async () => {
    mockState.beforeWrite = (table, op) => { if (table === 'profiles' && op === 'update') mockState.db.profiles.find(x => x.id === 'pBoss').company_id = 'C2' }
    const r = await json(await links.POST(post({ company_id: 'C1', directory_id: 'D1', profile_ids: ['pBoss'] })))
    expect(r.body.linked).toHaveLength(0)
    expect(r.body.skipped[0].reason).toMatch(/Changed since review/)
    expect(mockState.db.profiles.find(x => x.id === 'pBoss').company_id).toBe('C2')
  })

  test('literal %/_ names and duplicate-name companies', async () => {
    mockState.db.profiles.push({ id: 'pPct', role: 'subcontractor', company_id: null, company_name: '50% Off_Co\\', invite_email: 'p@pct.com' })
    mockState.db.profiles.push({ id: 'pLook', role: 'subcontractor', company_id: null, company_name: '5000 OffXCo', invite_email: 'look@x.com' })
    authEmails.pPct = 'p@pct.com'
    const r = await json(await links.GET(get('directory_id=Dp')))
    expect(r.body.company.id).toBe('Cpct')
    expect(r.body.candidates.map(c => c.id)).toEqual(['pPct'])
    // Duplicate company names: nothing selectable, and a forced POST is refused.
    const d = await json(await links.GET(get('directory_id=Ddup')))
    expect(d.body.company_reason).toBe('ambiguous')
    expect((await links.POST(post({ company_id: 'Ct1', directory_id: 'Ddup', profile_ids: ['x'] }))).status).toBe(409)
  })

  test('company/directory mismatch and legacy name-only body rejected', async () => {
    expect((await links.POST(post({ company_id: 'C2', directory_id: 'D1', profile_ids: ['pBoss'] }))).status).toBe(409)
    expect((await links.POST(post({ company_name: 'Acme Steel' }))).status).toBe(400)
    expect((await links.POST(post({ company_id: 'C1', directory_id: 'D1', profile_ids: [] }))).status).toBe(400)
    expect(writes('profiles')).toHaveLength(0)
  })

  test('create-company only when no exact/loose match exists', async () => {
    expect((await links.POST(post({ action: 'create-company', directory_id: 'D1' }))).status).toBe(409)
    mockState.db.sub_directory.push({ id: 'Dnew', company_name: 'Brand New Co', email: 'n@n.com', status: 'approved' })
    const r = await json(await links.POST(post({ action: 'create-company', directory_id: 'Dnew' })))
    expect(r.status).toBe(200)
    expect(r.body.company.name).toBe('Brand New Co')
  })

  test('classifier: multiple approved companies for one login email is ambiguous', () => {
    const r = classifyLinkCandidate({ role: 'subcontractor', company_id: null }, { id: 'C1', name: 'A' }, 'x@x.com', [
      { email: 'x@x.com', status: 'approved', company_name: 'A' },
      { email: 'X@x.com', status: 'approved', company_name: 'B' },
    ])
    expect(r.eligible).toBe(false)
    expect(r.reason).toMatch(/more than one company/)
  })
})
