/**
 * 2026-11-06 evening security / destructive / file-access fixes:
 *  1) invite-sub Reset PW / Resend must not demote or rename
 *  2) invite-team-member must not overwrite an existing account
 *  3) /api/jobs/delete Owner-only, refuses protected financial history
 *  4) /api/jobs/archive Owner-only, archived-only payload; dashboard buckets
 *  5) submittals ?file_path= job check
 *  6) /api/schedule-files job-scoped storage
 * (7, closed RFIs, is in rfi-actions-route.test.js)
 */

let mockDb
let mockAuth
let mockWrites
let mockRpcCalls
let mockRpcResult
let mockSent
let mockAuthUsers
let mockLinks
let mockStorage

function mockQuery(table) {
  const filters = []
  let op = 'select'
  let head = false
  let payload = null
  const rows = () => (mockDb[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, payload)); mockWrites.push({ table, op, payload }); return { data: hit.map(r => ({ ...r })), error: null } }
    if (op === 'delete') { const gone = rows(); mockDb[table] = (mockDb[table] || []).filter(r => !gone.includes(r)); mockWrites.push({ table, op, ids: gone.map(r => r.id) }); return { data: null, error: null } }
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({ id: p.id || `${table}-new-${(mockDb[table] || []).length + i}`, ...p }))
      if (op === 'upsert') {
        for (const r of list) {
          const existing = (mockDb[table] || []).find(x => x.id === r.id)
          if (existing) Object.assign(existing, r)
          else mockDb[table] = [...(mockDb[table] || []), r]
        }
      } else mockDb[table] = [...(mockDb[table] || []), ...list]
      mockWrites.push({ table, op, payload })
      return { data: list, error: null }
    }
    const data = rows()
    return head ? { data: null, count: data.length, error: null } : { data, error: null }
  }
  const likeToRe = pat => new RegExp('^' + String(pat).split(/(\\.|%|_)/).map(t => t === '%' ? '.*' : t === '_' ? '.' : t.startsWith('\\') ? t[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', 's')
  const q = {
    select: (cols, opts) => { if (opts?.head) head = true; return q },
    order: () => q, limit: () => q, range: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    neq: (c, v) => { filters.push(r => r[c] !== v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    ilike: (c, v) => { const plain = String(v).replace(/\\(.)/g, '$1').toLowerCase(); filters.push(r => String(r[c] ?? '').toLowerCase() === plain); return q },
    like: (c, v) => { const re = likeToRe(v); filters.push(r => re.test(String(r[c] ?? ''))); return q },
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    insert: p => { op = 'insert'; payload = p; return q },
    upsert: p => { op = 'upsert'; payload = p; return q },
    single: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: t => mockQuery(t),
    rpc: async (name, args) => { mockRpcCalls.push({ name, args }); return mockRpcResult },
    auth: {
      admin: {
        generateLink: async ({ type, email }) => {
          mockLinks.push({ type, email })
          const existing = mockAuthUsers.find(u => u.email === email)
          if (type === 'invite') {
            if (existing) return { data: null, error: { message: 'A user with this email address has already been registered', status: 422 } }
            const user = { id: `new-${mockAuthUsers.length}`, email }
            mockAuthUsers.push(user)
            mockDb.profiles.push({ id: user.id, role: 'subcontractor', full_name: null }) // signup trigger
            return { data: { user, properties: { action_link: 'https://invite/' + email } }, error: null }
          }
          return { data: { properties: { action_link: 'https://recover/' + email } }, error: null }
        },
        listUsers: async () => ({ data: { users: mockAuthUsers }, error: null }),
      },
    },
    storage: { from: bucket => ({
      createSignedUrl: async path => { mockStorage.push({ bucket, op: 'sign', path }); return { data: { signedUrl: 'https://signed/' + path }, error: null } },
      createSignedUploadUrl: async path => { mockStorage.push({ bucket, op: 'upload', path }); return { data: { signedUrl: 'https://upload/' + path }, error: null } },
      remove: async paths => { mockStorage.push({ bucket, op: 'remove', paths }); return { data: null, error: null } },
    }) },
  }),
}))
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: async msg => { mockSent.push(msg); return { data: { id: 're_1' }, error: null } } } } } }))
jest.mock('../lib/server-auth', () => {
  const actual = jest.requireActual('../lib/server-auth')
  return {
    ...actual,
    requireAuth: async () => mockAuth,
    requirePM: async () => (actual.isPM(mockAuth.role) ? mockAuth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
  }
})

const inviteSub = require('../app/api/invite-sub/route')
const inviteTeamMember = require('../app/api/invite-team-member/route')
const jobsDelete = require('../app/api/jobs/delete/route')
const jobsArchive = require('../app/api/jobs/archive/route')
const submittals = require('../app/api/submittals/route')
const scheduleFiles = require('../app/api/schedule-files/route')
const { blankCompanyFill } = require('../lib/invite-guards')
const lifecycle = require('../lib/job-lifecycle')
const { jobUploadPathError } = require('../lib/storage-path')

const JOB = '8ae26b84-c4df-4a75-a466-48ee7bed9f0c'
const OTHER = '11111111-2222-4333-8444-555555555555'
const req = (method, body, url = 'http://x/api') => new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockAuth = { userId: 'me', email: 'me@nv.co', role, error: null, ...extra } }
const profile = id => mockDb.profiles.find(p => p.id === id)
const profileWrites = () => mockWrites.filter(w => w.table === 'profiles')

beforeEach(() => {
  mockWrites = []
  mockRpcCalls = []
  mockRpcResult = { data: { ok: true }, error: null }
  mockSent = []
  mockLinks = []
  mockStorage = []
  mockAuthUsers = [
    { id: 'subpm1', email: 'subpm@acme.co' },
    { id: 'subnoco', email: 'loose@sub.co' },
    { id: 'owner1', email: 'owner@nv.co' },
    { id: 'pm1', email: 'pm@nv.co' },
    { id: 'apm1', email: 'apm@nv.co' },
    { id: 'other-sub', email: 'b@bco.co' },
  ]
  mockDb = {
    profiles: [
      { id: 'me', role: 'principal', company_id: null },
      { id: 'subadmin', role: 'sub_admin', company_id: 'co1', company_name: 'Acme Concrete', full_name: 'Ann Admin' },
      { id: 'subpm1', role: 'sub_pm', company_id: 'co1', company_name: 'Acme Concrete', full_name: 'Pat Sub PM', invite_email: 'subpm@acme.co' },
      { id: 'subnoco', role: 'sub_estimator', company_id: null, company_name: null, full_name: 'Lou Est' },
      { id: 'owner1', role: 'principal', full_name: 'Olive Owner' },
      { id: 'owner2', role: 'principal', full_name: 'Otto Owner' },
      { id: 'pm1', role: 'pm', full_name: 'Pete PM' },
      { id: 'apm1', role: 'apm', full_name: 'Amy APM' },
      { id: 'other-sub', role: 'subcontractor', company_id: 'co2', company_name: 'B Co', full_name: 'Bea' },
    ],
    companies: [{ id: 'co1', name: 'Acme Concrete' }, { id: 'co2', name: 'B Co' }],
    sub_directory: [{ id: 'dir1', email: 'subpm@acme.co', company_name: 'Acme Concrete', contact_name: 'Directory Name' }],
    jobs: [{ id: JOB, pm_email: null, archived: false, status: 'active' }, { id: OTHER, pm_email: null, archived: false, status: 'active' }],
    pm_job_assignments: [{ id: 'a1', job_id: JOB, user_id: 'pmA' }],
    billing_submissions: [], draw_requests: [], aia_applications: [], subcontracts: [],
    direct_costs: [], purchase_orders: [], general_conditions: [], owner_reimb_invoices: [],
    submittals: [
      { id: 's1', job_id: JOB, file_url: JSON.stringify([{ path: `${JOB}/1700000000000_shop_dwg.pdf`, name: 'shop dwg.pdf' }]) },
      { id: 's2', job_id: OTHER, file_url: JSON.stringify([{ path: `${OTHER}/1700000000001_other.pdf`, name: 'other.pdf' }]) },
      { id: 's3', job_id: OTHER, file_url: 'legacy/old_file.pdf' },
    ],
    job_schedule_files: [
      { id: 'f1', job_id: JOB, storage_path: `${JOB}/1700-plan.mpp`, file_name: 'plan.mpp' },
      { id: 'f2', job_id: OTHER, storage_path: `${OTHER}/1700-theirs.mpp`, file_name: 'theirs.mpp' },
    ],
  }
})

// ── 1) invite-sub ────────────────────────────────────────────────────────────
describe('invite-sub existing account (Reset PW / Resend)', () => {
  test('existing Sub PM: recovery link sent, role and full_name not written', async () => {
    as('pm')
    const res = await inviteSub.POST(req('POST', { email: 'subpm@acme.co', company_name: 'Acme Concrete' }))
    expect(res.status).toBe(200)
    expect((await res.json()).action).toBe('reset')
    expect(mockLinks.map(l => l.type)).toEqual(['invite', 'recovery'])
    for (const w of profileWrites()) {
      expect(w.payload).not.toHaveProperty('role')
      expect(w.payload).not.toHaveProperty('full_name')
    }
    expect(profile('subpm1')).toMatchObject({ role: 'sub_pm', full_name: 'Pat Sub PM', company_id: 'co1' })
    expect(mockSent).toHaveLength(1)
  })

  test('directory_id path for an existing user does not rename to the directory contact', async () => {
    as('admin')
    await inviteSub.POST(req('POST', { directory_id: 'dir1' }))
    expect(profile('subpm1').full_name).toBe('Pat Sub PM')
    expect(profile('subpm1').role).toBe('sub_pm')
  })

  test('fills only blank company fields on an existing sub', async () => {
    as('pm')
    await inviteSub.POST(req('POST', { email: 'loose@sub.co', company_id: 'co1', company_name: 'Acme Concrete', role: 'subcontractor', full_name: 'Renamed' }))
    const writes = profileWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0].payload).toEqual({ company_id: 'co1', company_name: 'Acme Concrete' })
    expect(profile('subnoco')).toMatchObject({ role: 'sub_estimator', full_name: 'Lou Est' })
  })

  test('Owner / PM / APM email: 403, no link, no profile write, no email', async () => {
    as('pm')
    for (const email of ['owner@nv.co', 'pm@nv.co', 'apm@nv.co']) {
      const res = await inviteSub.POST(req('POST', { email }))
      expect(res.status).toBe(403)
    }
    expect(mockLinks.filter(l => l.type === 'recovery')).toHaveLength(0)
    expect(profileWrites()).toHaveLength(0)
    expect(mockSent).toHaveLength(0)
    expect(profile('pm1').role).toBe('pm')
  })

  test('brand-new invite still creates the profile with role and name', async () => {
    as('pm')
    const res = await inviteSub.POST(req('POST', { email: 'fresh@new.co', company_name: 'Acme Concrete', full_name: 'Fresh Person', role: 'sub_pm' }))
    expect(res.status).toBe(200)
    const w = profileWrites()
    expect(w).toHaveLength(1)
    expect(w[0].op).toBe('upsert')
    expect(w[0].payload).toMatchObject({ role: 'sub_pm', full_name: 'Fresh Person', company_id: 'co1', invite_email: 'fresh@new.co' })
  })

  test('blankCompanyFill never returns role / name / invite_email', () => {
    expect(blankCompanyFill({ company_id: null, company_name: '' }, { companyId: 'c', companyName: 'N' })).toEqual({ company_id: 'c', company_name: 'N' })
    expect(blankCompanyFill({ company_id: 'x', company_name: 'Y' }, { companyId: 'c', companyName: 'N' })).toEqual({})
    expect(blankCompanyFill(null, { companyId: 'c' })).toEqual({})
  })
})

// ── 2) invite-team-member ────────────────────────────────────────────────────
describe('invite-team-member', () => {
  test('Owner / PM / APM email: 403 and profile unchanged', async () => {
    as('sub_admin', { userId: 'subadmin' })
    for (const email of ['owner@nv.co', 'pm@nv.co', 'apm@nv.co']) {
      const res = await inviteTeamMember.POST(req('POST', { company_id: 'co1', email }))
      expect(res.status).toBe(403)
    }
    expect(profileWrites()).toHaveLength(0)
    expect(mockSent).toHaveLength(0)
    expect(profile('owner1').role).toBe('principal')
    expect(profile('pm1')).toMatchObject({ role: 'pm' })
  })

  test('office PM resending to an Owner email is also 403', async () => {
    as('pm')
    const res = await inviteTeamMember.POST(req('POST', { company_id: 'co1', email: 'owner@nv.co', role: 'subcontractor' }))
    expect(res.status).toBe(403)
    expect(profile('owner1').role).toBe('principal')
  })

  test('Resend to an existing sub PM: recovery only, no role / name / company write', async () => {
    as('sub_admin', { userId: 'subadmin' })
    const res = await inviteTeamMember.POST(req('POST', { company_id: 'co1', email: 'subpm@acme.co', full_name: 'Other Name' }))
    expect(res.status).toBe(200)
    expect(profileWrites()).toHaveLength(0)
    expect(profile('subpm1')).toMatchObject({ role: 'sub_pm', full_name: 'Pat Sub PM', company_id: 'co1' })
    expect(mockLinks.map(l => l.type)).toEqual(['invite', 'recovery'])
    expect(mockSent).toHaveLength(1)
  })

  test('sub admin cannot resend to (or pull in) another company\'s sub', async () => {
    as('sub_admin', { userId: 'subadmin' })
    const res = await inviteTeamMember.POST(req('POST', { company_id: 'co1', email: 'b@bco.co' }))
    expect(res.status).toBe(403)
    expect(profile('other-sub').company_id).toBe('co2')
  })

  test('new invite still sets role, name and company', async () => {
    as('sub_admin', { userId: 'subadmin' })
    const res = await inviteTeamMember.POST(req('POST', { company_id: 'co1', email: 'newbie@acme.co', full_name: 'New Bie' }))
    expect(res.status).toBe(200)
    const w = profileWrites()
    expect(w).toHaveLength(1)
    expect(w[0].payload).toMatchObject({ role: 'subcontractor', full_name: 'New Bie', company_id: 'co1', company_name: 'Acme Concrete' })
  })
})

// ── 3) jobs/delete ───────────────────────────────────────────────────────────
describe('/api/jobs/delete', () => {
  test.each(['pm', 'apm', 'super', 'admin'])('%s → 403, nothing called', async role => {
    as(role)
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(403)
    expect(mockRpcCalls).toHaveLength(0)
    expect(mockWrites).toHaveLength(0)
  })

  test('Owner with approved / drawn / paid billings → 409, billings untouched, no RPC', async () => {
    as('principal')
    mockDb.billing_submissions = [
      { id: 'b1', job_id: JOB, status: 'approved' },
      { id: 'b2', job_id: JOB, status: 'pending', draw_request_id: 'd1' },
      { id: 'b3', job_id: JOB, status: 'pending', paid_at: '2026-10-01' },
    ]
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/approved, on a draw, or paid/)
    expect(mockDb.billing_submissions).toHaveLength(3)
    expect(mockRpcCalls).toHaveLength(0)
    expect(mockWrites).toHaveLength(0)
  })

  test('pending billings also block (delete never removes billings)', async () => {
    as('principal')
    mockDb.billing_submissions = [{ id: 'b1', job_id: JOB, status: 'pending' }]
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(409)
    expect(mockDb.billing_submissions).toHaveLength(1)
  })

  test.each([
    ['draw_requests', { status: 'closed', draw_number: 1 }, /draw request/],
    ['aia_applications', { status: 'certified' }, /owner pay app/],
    ['aia_applications', { status: 'draft', payment_received: true }, /owner pay app/],
    ['subcontracts', { status: 'sent', signed_at: '2026-01-01' }, /signed/],
    ['direct_costs', { nv_paid: true }, /direct cost/],
    ['purchase_orders', { draw_request_id: 'd1' }, /purchase order/],
    ['general_conditions', { draw_request_id: 'd1' }, /general conditions/],
    ['owner_reimb_invoices', { status: 'issued' }, /reimbursement invoice/],
  ])('protected %s → 409', async (table, row, re) => {
    as('principal')
    mockDb[table] = [{ id: 'x1', job_id: JOB, ...row }]
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(re)
    expect(mockRpcCalls).toHaveLength(0)
  })

  test('clean job: one atomic RPC, no client-side deletes', async () => {
    as('principal')
    mockDb.draw_requests = [{ id: 'd0', job_id: JOB, status: 'open' }]
    mockDb.aia_applications = [{ id: 'a0', job_id: JOB, status: 'draft' }]
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(200)
    expect(mockRpcCalls).toEqual([{ name: 'delete_job_if_unprotected', args: { p_job_id: JOB } }])
    expect(mockWrites).toHaveLength(0)
  })

  test('RPC refusal (re-check under lock) → 409', async () => {
    as('principal')
    mockRpcResult = { data: { ok: false, reasons: ['1 sub billing(s) are approved, on a draw, or paid.'] }, error: null }
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(409)
  })

  test('migration 044 not applied → 503, nothing deleted', async () => {
    as('principal')
    mockRpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.delete_job_if_unprotected' } }
    const res = await jobsDelete.POST(req('POST', { job_id: JOB }))
    expect(res.status).toBe(503)
    expect(mockDb.jobs.find(j => j.id === JOB)).toBeTruthy()
  })
})

// ── 4) jobs/archive + lifecycle helpers ──────────────────────────────────────
describe('/api/jobs/archive', () => {
  test.each(['pm', 'apm', 'super', 'admin'])('%s → 403, no write', async role => {
    as(role)
    const res = await jobsArchive.POST(req('POST', { job_id: JOB, archived: true }))
    expect(res.status).toBe(403)
    expect(mockWrites).toHaveLength(0)
  })

  test('Owner archive writes only { archived: true }; status kept', async () => {
    as('principal')
    const res = await jobsArchive.POST(req('POST', { job_id: JOB, archived: true, status: 'on_hold', contract_value: 1 }))
    expect(res.status).toBe(200)
    expect(mockWrites).toEqual([{ table: 'jobs', op: 'update', payload: { archived: true } }])
    expect(mockDb.jobs[0]).toMatchObject({ archived: true, status: 'active' })
  })

  test('Owner unarchive writes only { archived: false }', async () => {
    as('principal')
    mockDb.jobs[0].archived = true
    const res = await jobsArchive.POST(req('POST', { job_id: JOB, archived: false }))
    expect(res.status).toBe(200)
    expect(mockWrites).toEqual([{ table: 'jobs', op: 'update', payload: { archived: false } }])
  })

  test('archived must be a boolean', async () => {
    as('principal')
    const res = await jobsArchive.POST(req('POST', { job_id: JOB, archived: 'yes' }))
    expect(res.status).toBe(400)
  })

  test('dashboard buckets: archived is never Active, shows under Completed', () => {
    const a = { status: 'active', archived: true }
    expect(lifecycle.inActiveJobList(a)).toBe(false)
    expect(lifecycle.isActiveStatusJob(a)).toBe(false)
    expect(lifecycle.inCompletedJobList(a)).toBe(true)
    expect(lifecycle.inActiveJobList({ status: 'on_hold', archived: false })).toBe(true)
    expect(lifecycle.inActiveJobList({ status: 'complete' })).toBe(false)
  })

  test('Status changed to Active clears archived; an unchanged save does not', () => {
    expect(lifecycle.statusSaveClearsArchived({ archived: true, status: 'on_hold' }, 'active')).toBe(true)
    expect(lifecycle.statusSaveClearsArchived({ archived: true, status: 'complete' }, 'active')).toBe(true)
    expect(lifecycle.statusSaveClearsArchived({ archived: true, status: 'active' }, 'active')).toBe(false)
    expect(lifecycle.statusSaveClearsArchived({ archived: true, status: 'active' }, 'on_hold')).toBe(false)
    expect(lifecycle.statusSaveClearsArchived({ archived: false, status: 'on_hold' }, 'active')).toBe(false)
  })
})

// ── 5) submittals ?file_path= ────────────────────────────────────────────────
describe('submittals file links', () => {
  const sign = path => submittals.GET(req('GET', null, `http://x/api/submittals?file_path=${encodeURIComponent(path)}`))

  test('job-limited PM cannot sign another job\'s submittal path', async () => {
    as('pm', { userId: 'pmA' })
    const res = await sign(`${OTHER}/1700000000001_other.pdf`)
    expect(res.status).toBe(403)
    expect(mockStorage).toHaveLength(0)
  })

  test('own job path opens (denyJob run on the path\'s job)', async () => {
    as('pm', { userId: 'pmA' })
    const res = await sign(`${JOB}/1700000000000_shop_dwg.pdf`)
    expect(res.status).toBe(200)
    expect(mockStorage).toEqual([{ bucket: 'submittal-docs', op: 'sign', path: `${JOB}/1700000000000_shop_dwg.pdf` }])
  })

  test('path under my job id but not on any submittal → 403', async () => {
    as('pm', { userId: 'pmA' })
    const res = await sign(`${JOB}/guess.pdf`)
    expect(res.status).toBe(403)
  })

  test('other job\'s file placed under my job folder name does not pass', async () => {
    as('pm', { userId: 'pmA' })
    mockDb.submittals.push({ id: 's4', job_id: OTHER, file_url: JSON.stringify([{ path: `${JOB}/x.pdf` }]) })
    expect((await sign(`${JOB}/x.pdf`)).status).toBe(403)
  })

  test('legacy path without job id: job comes from the submittal row', async () => {
    as('pm', { userId: 'pmA' })
    expect((await sign('legacy/old_file.pdf')).status).toBe(403)
    mockDb.pm_job_assignments.push({ id: 'a2', job_id: OTHER, user_id: 'pmA' })
    expect((await sign('legacy/old_file.pdf')).status).toBe(200)
  })

  test('.. and empty segments are rejected', async () => {
    as('principal')
    expect((await sign(`${JOB}/../${OTHER}/x.pdf`)).status).toBe(400)
    expect((await sign(`${JOB}//x.pdf`)).status).toBe(400)
    expect(mockStorage).toHaveLength(0)
  })
})

// ── 6) /api/schedule-files ───────────────────────────────────────────────────
describe('/api/schedule-files', () => {
  const post = body => scheduleFiles.POST(req('POST', body))

  test('upload path without job prefix → 403', async () => {
    as('principal')
    const res = await post({ action: 'upload-url', path: 'plan.mpp' })
    expect(res.status).toBe(403)
    expect(mockStorage).toHaveLength(0)
  })

  test('upload to another job\'s folder: denyJob refuses a job-limited PM', async () => {
    as('pm', { userId: 'pmA' })
    expect((await post({ action: 'upload-url', path: `${OTHER}/1700-x.mpp` })).status).toBe(403)
    expect((await post({ action: 'upload-url', path: `${JOB}/1700-x.mpp` })).status).toBe(200)
    expect(mockStorage.map(s => s.path)).toEqual([`${JOB}/1700-x.mpp`])
  })

  test('unsafe file names are refused', async () => {
    as('principal')
    expect((await post({ action: 'upload-url', path: `${JOB}/my plan.mpp` })).status).toBe(403)
    expect((await post({ action: 'upload-url', path: `${JOB}/a/b.mpp` })).status).toBe(403)
  })

  test('record: path must match job_id', async () => {
    as('principal')
    const res = await post({ action: 'record', job_id: JOB, storage_path: `${OTHER}/1700-x.mpp`, file_name: 'x.mpp' })
    expect(res.status).toBe(403)
    expect(mockWrites).toHaveLength(0)
  })

  test('signed-url: other job → 403, own job → URL, no prefix → 403', async () => {
    as('pm', { userId: 'pmA' })
    expect((await post({ action: 'signed-url', path: `${OTHER}/1700-theirs.mpp` })).status).toBe(403)
    expect((await post({ action: 'signed-url', path: 'theirs.mpp' })).status).toBe(403)
    const ok = await post({ action: 'signed-url', path: `${JOB}/1700-plan.mpp` })
    expect(ok.status).toBe(200)
    expect((await ok.json()).url).toContain(`${JOB}/1700-plan.mpp`)
  })

  test('delete: other job → 403 and nothing removed', async () => {
    as('pm', { userId: 'pmA' })
    const res = await post({ action: 'delete', file_id: 'f2' })
    expect(res.status).toBe(403)
    expect(mockDb.job_schedule_files).toHaveLength(2)
    expect(mockStorage).toHaveLength(0)
  })

  test('delete own: row first, then storage', async () => {
    as('pm', { userId: 'pmA' })
    const res = await post({ action: 'delete', file_id: 'f1' })
    expect(res.status).toBe(200)
    expect(mockWrites[0]).toMatchObject({ table: 'job_schedule_files', op: 'delete', ids: ['f1'] })
    expect(mockStorage).toEqual([{ bucket: 'schedule-files', op: 'remove', paths: [`${JOB}/1700-plan.mpp`] }])
  })

  test('GET list runs the job check', async () => {
    as('pm', { userId: 'pmA' })
    expect((await scheduleFiles.GET(req('GET', null, `http://x/api/schedule-files?job_id=${OTHER}`))).status).toBe(403)
    const ok = await scheduleFiles.GET(req('GET', null, `http://x/api/schedule-files?job_id=${JOB}`))
    expect((await ok.json()).files.map(f => f.id)).toEqual(['f1'])
  })

  test('jobUploadPathError', () => {
    expect(jobUploadPathError(`${JOB}/1700-a.mpp`)).toBeNull()
    expect(jobUploadPathError(`${JOB}/1700-a.mpp`, OTHER)).toMatch(/does not match/)
    expect(jobUploadPathError('x/1700-a.mpp')).toMatch(/job id/)
  })
})
