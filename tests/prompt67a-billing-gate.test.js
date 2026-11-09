/**
 * Prompt 67A #4: the sub billing gate no longer fails open when a sub is on a job only
 * through a subcontract (no job_assignments row). Grandfathered: a company that already
 * has a non-rejected billing on the job keeps billing. Non-draft contracts now put the sub
 * on the job server-side with billing OFF — or ON when the company/person is grandfathered,
 * so the new row never takes billing away from someone who bills today.
 * mock-db stands in for Supabase, wrapped below with a real .or() filter.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

// mock-db's own .or() is a no-op; this file wraps its client with a REAL PostgREST-style
// .or() filter (eq/neq/is/in/ilike) so rows of other companies on the same job are
// filtered the way the database filters them. mock-db.js itself is not changed.
jest.mock('@supabase/supabase-js', () => {
  const base = require('./helpers/mock-db').supabaseModule
  const splitTop = str => {
    const out = []; let depth = 0; let cur = ''
    for (const ch of str) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    if (cur) out.push(cur)
    return out
  }
  const termFn = term => {
    const m = term.match(/^([^.]+)\.(eq|neq|is|in|ilike)\.(.*)$/)
    if (!m) throw new Error('real-or mock: unsupported term ' + term)
    const [, col, op, raw] = m
    if (op === 'eq') return r => String(r[col]) === raw
    if (op === 'neq') return r => r[col] != null && String(r[col]) !== raw
    if (op === 'is') return r => (r[col] ?? null) === (raw === 'null' ? null : raw)
    if (op === 'in') { const list = raw.replace(/^\(|\)$/g, '').split(',').map(x => x.trim().replace(/^"|"$/g, '')); return r => list.includes(r[col]) }
    const re = new RegExp('^' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
    return r => r[col] != null && re.test(String(r[col]))
  }
  const wrapClient = client => ({
    ...client,
    from: table => {
      const q = client.from(table)
      const ors = []
      const proxy = new Proxy(q, {
        get(t, k) {
          if (k === 'or') return expr => { ors.push(splitTop(expr).map(termFn)); return proxy }
          if (k === 'then') return (res, rej) => t.then(r => {
            if (r && Array.isArray(r.data) && ors.length) r = { ...r, data: r.data.filter(row => ors.every(fns => fns.some(f => f(row)))) }
            return res(r)
          }, rej)
          const v = t[k]
          if (typeof v !== 'function') return v
          return (...a) => { const out = v.apply(t, a); return out === t ? proxy : out }
        },
      })
      return proxy
    },
  })
  return { ...base, createClient: (...a) => wrapClient(base.createClient(...a)) }
})
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (mockState.auth && PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
jest.mock('../lib/roles', () => ({ denyJob: jest.fn(async () => null), denyJobOf: jest.fn(async () => null) }))
jest.mock('../lib/bot-api', () => {
  const actual = jest.requireActual('../lib/bot-api')
  return {
    ...actual,
    withBot: handler => async request => handler({
      bot: { id: 'bot-1', full_name: 'Bot' },
      supabase: require('@supabase/supabase-js').createClient(),
      request, params: {},
    }),
    logBotChange: async () => {},
  }
})
jest.mock('resend', () => ({ Resend: function Resend() { this.emails = { send: async () => ({ data: {}, error: null }) } } }))

const { getSubAccess, getCompanyPeople, billingOnFor, ensureContractAssignment, companyGrandfatheredOnJob } = require('../lib/sub-access')
const companyJobAccess = require('../app/api/company-job-access/route')
const subcontracts = require('../app/api/subcontracts/route')
const botSubcontracts = require('../app/api/bot/v1/subcontracts/route')
const subBilling = require('../app/api/sub-portal/billing/route')

const J1 = 'job-1'
const ME = { id: 'u1', full_name: 'Sam Sub', role: 'subcontractor', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'me@acme.test', job_access: 'company', can_bill: true }
const MATE = { id: 'u2', full_name: 'Mate', role: 'sub_pm', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'mate@acme.test', job_access: 'company', can_bill: true }

function seed(extra = {}) {
  resetMockState({
    companies: [{ id: 'c1', name: 'Acme Electric' }],
    profiles: [ME, MATE],
    jobs: [{ id: J1, job_number: '100', project_name: 'Job One', status: 'active' }],
    // Contract-only: the company is on J1 only through this active subcontract.
    subcontracts: [{ id: 'sc1', job_id: J1, company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', contract_value: 1000, status: 'active', retainage_pct: 10 }],
    job_assignments: [],
    billing_submissions: [],
    company_contacts: [],
    sub_directory: [],
    ...extra,
  })
}
const json = (url, method, body) => new Request(`http://x${url}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body),
})
const asSub = () => { mockState.auth = { userId: 'u1', email: 'me@acme.test', role: 'subcontractor', error: null } }
const asPM = () => { mockState.auth = { userId: 'pm1', email: 'pm@nv.test', role: 'pm', error: null } }
const assignmentInserts = () => mockState.calls.filter(c => c.table === 'job_assignments' && c.op === 'insert')
const assignmentWrites = () => mockState.calls.filter(c => c.table === 'job_assignments')

beforeEach(() => {
  seed()
  mockState.auth = null
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => console.error.mockRestore())

describe('billingOnFor', () => {
  test('rows decide when present; no rows → grandfathered only', () => {
    expect(billingOnFor([], {})).toBe(false)
    expect(billingOnFor([], { grandfathered: true })).toBe(true)
    expect(billingOnFor([{ billing_enabled: false }], { grandfathered: true })).toBe(false)
    expect(billingOnFor([{ billing_enabled: false }, { billing_enabled: true }])).toBe(true)
    expect(billingOnFor([{ billing_enabled: null }])).toBe(true)
  })
})

describe('getSubAccess', () => {
  const j1 = async () => (await getSubAccess('u1', 'me@acme.test')).jobs.find(j => j.id === J1)

  test('contract-only job, zero rows, no prior billing → billing off (job still visible)', async () => {
    const job = await j1()
    expect(job).toBeTruthy()
    expect(job).toMatchObject({ billing_on: false, can_bill: false, billing_lock_reason: 'billing_off', access_via: 'company' })
  })

  test('prior approved billing by the user → billing on (grandfathered)', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u1', status: 'approved' }]
    expect(await j1()).toMatchObject({ billing_on: true, can_bill: true, billing_lock_reason: null })
  })

  test('prior billing by a teammate → billing on', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u2', status: 'pending' }]
    expect(await j1()).toMatchObject({ billing_on: true, can_bill: true })
  })

  test('prior billing only rejected → off', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u1', status: 'rejected' }]
    expect(await j1()).toMatchObject({ billing_on: false, can_bill: false })
  })

  test('prior billing by someone outside the company → off', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'stranger', status: 'approved' }]
    expect((await j1()).billing_on).toBe(false)
  })

  test('rows present with billing_enabled false → off (unchanged), even with prior billing', async () => {
    mockState.db.job_assignments = [{ id: 'a1', job_id: J1, company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: false }]
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u1', status: 'approved' }]
    expect(await j1()).toMatchObject({ billing_on: false, can_bill: false })
  })

  test('rows present with billing_enabled true → on (unchanged)', async () => {
    mockState.db.job_assignments = [{ id: 'a1', job_id: J1, company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: true }]
    expect(await j1()).toMatchObject({ billing_on: true, can_bill: true })
  })

  test('billing_submissions read failure → off (fails closed) and logged', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u1', status: 'approved' }]
    mockState.failSelect.billing_submissions = 'connection reset'
    expect(await j1()).toMatchObject({ billing_on: false, can_bill: false })
    expect(console.error).toHaveBeenCalled()
  })
})

describe('getCompanyPeople (Companies tab)', () => {
  test('contract-only company, no rows, no billings → billing_on false', async () => {
    const { job } = await getCompanyPeople({ companyId: 'c1', jobId: J1 })
    expect(job).toMatchObject({ on_job: true, has_company_row: false, billing_on: false })
  })
  test('with a prior billing → billing_on true', async () => {
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u2', status: 'approved' }]
    const { job, people } = await getCompanyPeople({ companyId: 'c1', jobId: J1 })
    expect(job.billing_on).toBe(true)
    expect(people.find(p => p.user_id === 'u1').job.can_bill_job).toBe(true)
  })
})

describe('sub portal billing POST', () => {
  test('contract-only, never-billed sub is refused 403', async () => {
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', { job_id: J1, invoice_number: 'INV-1', doc_url: 'u1/inv.pdf' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/^Billing is not enabled/)
    expect(mockState.calls.filter(c => c.table === 'billing_submissions')).toHaveLength(0)
  })
})

describe('company-job-access', () => {
  test('grant_person on a contract-only job with no rows and no billings → rows with billing off', async () => {
    asPM()
    const res = await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: J1, company_id: 'c1', action: 'grant_person', user_id: 'u1' }))
    expect(res.status).toBe(200)
    const ins = assignmentInserts()
    expect(ins).toHaveLength(2)
    for (const c of ins) expect(c.payload.billing_enabled).toBe(false)
    expect(ins.map(c => c.payload.sub_id || null)).toEqual([null, 'u1'])
  })

  test('grant_person when the company already billed here → rows keep billing on', async () => {
    asPM()
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u2', status: 'approved' }]
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: J1, company_id: 'c1', action: 'grant_person', user_id: 'u1' }))
    for (const c of assignmentInserts()) expect(c.payload.billing_enabled).toBe(true)
  })

  test('add_company on a never-billed contract-only company → billing off', async () => {
    asPM()
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: J1, company_id: 'c1', action: 'add_company' }))
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload.billing_enabled).toBe(false)
  })

  test('add_company on a grandfathered contract-only company → billing on', async () => {
    asPM()
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u2', status: 'approved' }]
    const res = await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: J1, company_id: 'c1', action: 'add_company' }))
    expect(res.status).toBe(200)
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ company_id: 'c1', billing_enabled: true })
    expect(assignmentInserts()[0].payload.billing_enabled_at).toBeTruthy()
    expect((await getSubAccess('u1', 'me@acme.test')).jobs.find(j => j.id === J1).billing_on).toBe(true)
  })

  test('add_company when the billing_submissions read fails → billing off (fails closed)', async () => {
    asPM()
    mockState.db.billing_submissions = [{ id: 'b1', job_id: J1, sub_id: 'u2', status: 'approved' }]
    mockState.failSelect.billing_submissions = 'connection reset'
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: J1, company_id: 'c1', action: 'add_company' }))
    expect(assignmentInserts()[0].payload.billing_enabled).toBe(false)
  })
})

describe('/api/subcontracts assigns the sub when a contract is non-draft', () => {
  beforeEach(() => { seed({ subcontracts: [] }); asPM() })
  const body = extra => ({ job_id: J1, company_id: 'c1', vendor_name: 'Acme Electric', contract_value: 500, ...extra })

  test("POST status 'active' → one company row, billing off", async () => {
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', body({ status: 'active' })))
    const out = await res.json()
    expect(out.ok).toBe(true)
    expect(out.assignment_error).toBeUndefined()
    const ins = assignmentInserts()
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).toMatchObject({ job_id: J1, company_id: 'c1', billing_enabled: false })
    expect(ins[0].payload.sub_id).toBeUndefined()
  })

  test("POST status 'draft' → nothing assigned", async () => {
    await subcontracts.POST(json('/api/subcontracts', 'POST', body({ status: 'draft' })))
    expect(assignmentWrites()).toHaveLength(0)
  })

  test('existing row (billing on) is not modified and nothing is added', async () => {
    mockState.db.job_assignments = [{ id: 'a1', job_id: J1, company_id: null, sub_id: 'u2', sub_email: 'mate@acme.test', billing_enabled: true }]
    await subcontracts.POST(json('/api/subcontracts', 'POST', body({ status: 'active' })))
    expect(assignmentWrites()).toHaveLength(0)
    expect(mockState.db.job_assignments[0].billing_enabled).toBe(true)
  })

  test('Bid Leveling shape (no company_id): company resolved by vendor name', async () => {
    await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: J1, vendor_name: 'ACME ELECTRIC, LLC', contract_value: 1, status: 'active' }))
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ company_id: 'c1', billing_enabled: false })
  })

  test('no company at all, only a sub_id → person row (lower-case email), billing off', async () => {
    mockState.db.profiles.push({ id: 'u9', role: 'subcontractor', company_id: null, invite_email: 'Solo@Sub.Test' })
    await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: J1, vendor_name: 'Nobody Known', sub_id: 'u9', contract_value: 1, status: 'active' }))
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ job_id: J1, sub_id: 'u9', sub_email: 'solo@sub.test', company_id: null, billing_enabled: false })
  })

  test('PUT draft → active inserts one row', async () => {
    mockState.db.subcontracts = [{ id: 'sc2', job_id: J1, company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', contract_value: 500, status: 'draft' }]
    mockState.db.signing_requests = []
    const res = await subcontracts.PUT(json('/api/subcontracts', 'PUT', { id: 'sc2', status: 'active' }))
    expect((await res.json()).ok).toBe(true)
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ company_id: 'c1', billing_enabled: false })
  })

  test('PUT that keeps an active contract on the same job/company assigns nothing', async () => {
    mockState.db.subcontracts = [{ id: 'sc2', job_id: J1, company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', contract_value: 500, status: 'active' }]
    mockState.db.signing_requests = []
    await subcontracts.PUT(json('/api/subcontracts', 'PUT', { id: 'sc2', description: 'new words' }))
    expect(assignmentWrites()).toHaveLength(0)
  })

  test('assignment failure still returns ok with assignment_error (contract saved)', async () => {
    mockState.failWrite.job_assignments = { insert: 'permission denied for job_assignments' }
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', body({ status: 'active' })))
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out).toMatchObject({ ok: true, assignment_error: 'permission denied for job_assignments' })
    expect(out.id).toBeTruthy()
    expect(mockState.db.subcontracts).toHaveLength(1)
  })

  test('23505 (row appeared concurrently) is not an error', async () => {
    mockState.failWrite.job_assignments = { insert: { message: 'duplicate key', code: '23505' } }
    const r = await ensureContractAssignment(require('./helpers/mock-db').supabaseModule.createClient(), { jobId: J1, companyId: 'c1' })
    expect(r).toEqual({ ok: true, created: false, error: null })
  })
})

// Leah shape (#R-101): On Time Plumbing (company C) is on the job only through an active
// contract (no sub_id), no assignment rows, and Leah has an approved billing there.
// Filter-sensitive: another company (Z) has a row (billing OFF) and a billing on the same
// job, and company C has a billing on a different job — a wrong match flips the result.
describe('grandfathered company keeps billing when a contract adds its row (pre-061)', () => {
  const JR = 'job-r101'
  const LEAH = { id: 'leah', full_name: 'Leah', role: 'subcontractor', company_id: 'C', company_name: 'On Time Plumbing LLC', invite_email: 'leah@otp.test', job_access: 'company', can_bill: true }
  const ZED = { id: 'zed', full_name: 'Zed', role: 'subcontractor', company_id: 'Z', company_name: 'Zed Co', invite_email: 'z@zed.test', job_access: 'company', can_bill: true }
  const leahJob = async () => (await getSubAccess('leah', 'leah@otp.test')).jobs.find(j => j.id === JR)
  const cRowInserts = () => assignmentInserts().filter(c => c.payload.company_id === 'C')
  function seedLeah({ leahBilled = true } = {}) {
    seed({
      companies: [{ id: 'c1', name: 'Acme Electric' }, { id: 'C', name: 'On Time Plumbing LLC' }, { id: 'Z', name: 'Zed Co' }],
      profiles: [ME, MATE, LEAH, ZED],
      jobs: [{ id: J1, job_number: '100', project_name: 'Job One', status: 'active' }, { id: JR, job_number: 'R-101', project_name: 'NoLo', status: 'active' }],
      subcontracts: [
        { id: 'scR', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 29153.95, status: 'active' },
        { id: 'scZ', job_id: JR, company_id: 'Z', sub_id: null, vendor_name: 'Zed Co', contract_value: 100, status: 'active' },
      ],
      job_assignments: [{ id: 'jaZ', job_id: JR, company_id: 'Z', sub_id: 'zed', sub_email: 'z@zed.test', billing_enabled: false }],
      billing_submissions: [
        { id: 'bz', job_id: JR, sub_id: 'zed', status: 'approved' },
        { id: 'bc', job_id: J1, sub_id: 'leah', status: 'approved' },
        ...(leahBilled ? [{ id: 'bl', job_id: JR, sub_id: 'leah', status: 'approved' }] : []),
      ],
    })
    mockState.db.signing_requests = []
    asPM()
  }

  test('before: Leah bills via the grandfather rule; another company on the job does not leak in', async () => {
    seedLeah()
    expect(await leahJob()).toMatchObject({ billing_on: true, can_bill: true, access_via: 'company' })
    seedLeah({ leahBilled: false })
    expect(await leahJob()).toMatchObject({ billing_on: false, can_bill: false })
  })

  test('POST a 2nd active contract for the same company (residential addSub shape) → row billing ON, Leah still bills', async () => {
    seedLeah()
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: JR, vendor_name: 'On Time Plumbing LLC', contract_value: 500, status: 'active' }))
    const out = await res.json()
    expect(out.ok).toBe(true)
    expect(out.assignment_error).toBeUndefined()
    expect(assignmentInserts()).toHaveLength(1)
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload).toMatchObject({ job_id: JR, company_id: 'C', billing_enabled: true })
    expect(cRowInserts()[0].payload.billing_enabled_at).toBeTruthy()
    expect(await leahJob()).toMatchObject({ billing_on: true, can_bill: true })
    // Zed's own row is untouched
    expect(mockState.db.job_assignments.find(r => r.id === 'jaZ').billing_enabled).toBe(false)
  })

  test('PUT that sets sub_id on her active contract → row billing ON, Leah still bills', async () => {
    seedLeah()
    const res = await subcontracts.PUT(json('/api/subcontracts', 'PUT', { id: 'scR', sub_id: 'leah' }))
    expect((await res.json()).ok).toBe(true)
    expect(assignmentInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload).toMatchObject({ job_id: JR, company_id: 'C', billing_enabled: true })
    expect(await leahJob()).toMatchObject({ billing_on: true, can_bill: true })
  })

  test('never-billed company (only another company and another job have billings) → row billing OFF', async () => {
    seedLeah({ leahBilled: false })
    await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: JR, vendor_name: 'On Time Plumbing LLC', contract_value: 500, status: 'active' }))
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
    expect(cRowInserts()[0].payload.billing_enabled_at).toBeUndefined()
    expect((await leahJob()).billing_on).toBe(false)
  })

  test('billing_submissions read failure → row billing OFF (fails closed)', async () => {
    seedLeah()
    mockState.failSelect.billing_submissions = 'connection reset'
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: JR, vendor_name: 'On Time Plumbing LLC', contract_value: 500, status: 'active' }))
    expect((await res.json()).assignment_error).toBeUndefined()
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
    expect(console.error).toHaveBeenCalled()
  })

  test('person-only sub (no company) who billed here → person row billing ON', async () => {
    seedLeah()
    mockState.db.profiles.push({ id: 'solo', role: 'subcontractor', company_id: null, invite_email: 'solo@sub.test' })
    mockState.db.billing_submissions.push({ id: 'bs', job_id: JR, sub_id: 'solo', status: 'pending' })
    await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: JR, vendor_name: 'Nobody Known', sub_id: 'solo', contract_value: 1, status: 'active' }))
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ sub_id: 'solo', company_id: null, billing_enabled: true })
  })
})

// LOW-A (Jake / #7551 shape): a contract with sub_id and no company_id for a sub whose
// profile has a company (Bid Leveling, a PUT setting sub_id) adds NO row — a row for the
// sub or for the profile company would show the job to his teammates. As at HEAD, only
// Jake sees it through his own contract. Filter-sensitive: company Z has a row (billing
// ON), a company_id contract and a billing on the same job.
describe('LOW-A: sub_id-only contract for a sub with a profile company adds no row', () => {
  const J7 = 'job-7551'
  const JAKE = { id: 'jake', full_name: 'Jake Paladino', role: 'subcontractor', company_id: 'A2', company_name: 'Paladino Drywall', invite_email: 'Jake@A2.test', job_access: 'company', can_bill: true }
  const TM = { id: 'tm', full_name: 'Teammate', role: 'sub_pm', company_id: 'A2', company_name: 'Paladino Drywall', invite_email: 'tm@a2.test', job_access: 'company', can_bill: true }
  const ZED = { id: 'zed', full_name: 'Zed', role: 'subcontractor', company_id: 'Z', company_name: 'Zed Co', invite_email: 'z@zed.test', job_access: 'company', can_bill: true }
  const jakeJob = async () => (await getSubAccess('jake', 'jake@a2.test')).jobs.find(j => j.id === J7)
  const tmJob = async () => (await getSubAccess('tm', 'tm@a2.test')).jobs.find(j => j.id === J7)
  function seedJake({ jakeBilled = true } = {}) {
    seed({
      companies: [{ id: 'c1', name: 'Acme Electric' }, { id: 'A2', name: 'Paladino Drywall' }, { id: 'Z', name: 'Zed Co' }],
      profiles: [ME, MATE, JAKE, TM, ZED],
      jobs: [{ id: J1, job_number: '100', project_name: 'Job One', status: 'active' }, { id: J7, job_number: '7551', project_name: 'Seventy', status: 'active' }],
      subcontracts: [
        { id: 'scJ', job_id: J7, company_id: null, sub_id: 'jake', vendor_name: 'Paladino Drywall', contract_value: 900, status: 'active' },
        { id: 'scV', job_id: J7, company_id: null, sub_id: null, vendor_name: 'Paladino Drywall', contract_value: 50, status: 'active' },
        { id: 'scZ', job_id: J7, company_id: 'Z', sub_id: null, vendor_name: 'Zed Co', contract_value: 100, status: 'active' },
      ],
      job_assignments: [{ id: 'jaZ', job_id: J7, company_id: 'Z', sub_id: null, sub_email: null, billing_enabled: true }],
      billing_submissions: [
        { id: 'bz', job_id: J7, sub_id: 'zed', status: 'approved' },
        { id: 'bt', job_id: J1, sub_id: 'tm', status: 'approved' },
        ...(jakeBilled ? [{ id: 'bj', job_id: J7, sub_id: 'jake', status: 'approved' }] : []),
      ],
    })
    mockState.db.signing_requests = []
    asPM()
  }

  test('before: Jake bills; his teammate does not see #7551', async () => {
    seedJake()
    expect(await jakeJob()).toMatchObject({ billing_on: true, can_bill: true, access_via: 'person' })
    expect(await tmJob()).toBeUndefined()
  })

  test('POST a 2nd sub_id-only contract (Bid Leveling shape) → no row; Jake still bills; teammate still cannot see', async () => {
    seedJake()
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: J7, vendor_name: 'Paladino Drywall', sub_id: 'jake', contract_value: 10, status: 'active' }))
    const out = await res.json()
    expect(out.ok).toBe(true)
    expect(out.assignment_error).toBeUndefined()
    expect(assignmentWrites()).toHaveLength(0)
    expect(await jakeJob()).toMatchObject({ billing_on: true, can_bill: true })
    expect(await tmJob()).toBeUndefined()
  })

  test('PUT that sets sub_id on a vendor-name-only contract → no row; teammate still cannot see', async () => {
    seedJake()
    const res = await subcontracts.PUT(json('/api/subcontracts', 'PUT', { id: 'scV', sub_id: 'jake' }))
    expect((await res.json()).ok).toBe(true)
    expect(assignmentWrites()).toHaveLength(0)
    expect(await tmJob()).toBeUndefined()
    expect((await jakeJob()).can_bill).toBe(true)
  })

  test('never-billed sub, sub_id-only contract → no row, billing stays off', async () => {
    seedJake({ jakeBilled: false })
    await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: J7, vendor_name: 'Paladino Drywall', sub_id: 'jake', contract_value: 10, status: 'active' }))
    expect(assignmentWrites()).toHaveLength(0)
    expect(await jakeJob()).toMatchObject({ billing_on: false, can_bill: false })
    expect(await tmJob()).toBeUndefined()
  })

  test('direct call (bot client shape) → ok, nothing created', async () => {
    seedJake()
    const r = await ensureContractAssignment(require('./helpers/mock-db').supabaseModule.createClient(), { jobId: J7, subId: 'jake', vendorName: 'Paladino Drywall' })
    expect(r).toEqual({ ok: true, created: false, error: null })
    expect(assignmentWrites()).toHaveLength(0)
  })
})

// LOW-B: a new company-level row gets billing ON only when the company has a non-draft
// company_id contract on the job AND a member already billed there. A company the PM
// removed (rows and company_id contract gone) but with an old billing comes back OFF.
// Filter-sensitive: company Z has an active company_id contract and a billing on JR.
describe('LOW-B: re-added company with an old billing but no company_id contract', () => {
  const JR = 'job-r101'
  const LEAH = { id: 'leah', full_name: 'Leah', role: 'subcontractor', company_id: 'C', company_name: 'On Time Plumbing LLC', invite_email: 'leah@otp.test', job_access: 'company', can_bill: true }
  const ZED = { id: 'zed', full_name: 'Zed', role: 'subcontractor', company_id: 'Z', company_name: 'Zed Co', invite_email: 'z@zed.test', job_access: 'company', can_bill: true }
  const cRowInserts = () => assignmentInserts().filter(c => c.payload.company_id === 'C')
  const leahJob = async () => (await getSubAccess('leah', 'leah@otp.test')).jobs.find(j => j.id === JR)
  function seedRemoved({ cContract = null } = {}) {
    seed({
      companies: [{ id: 'c1', name: 'Acme Electric' }, { id: 'C', name: 'On Time Plumbing LLC' }, { id: 'Z', name: 'Zed Co' }],
      profiles: [ME, MATE, LEAH, ZED],
      jobs: [{ id: J1, job_number: '100', project_name: 'Job One', status: 'active' }, { id: JR, job_number: 'R-101', project_name: 'NoLo', status: 'active' }],
      subcontracts: [
        { id: 'scZ', job_id: JR, company_id: 'Z', sub_id: null, vendor_name: 'Zed Co', contract_value: 100, status: 'active' },
        // C's company_id contract on ANOTHER job — must not count for JR
        { id: 'scC1', job_id: J1, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 5, status: 'active' },
        ...(cContract ? [cContract] : []),
      ],
      job_assignments: [{ id: 'jaZ', job_id: JR, company_id: 'Z', sub_id: null, sub_email: null, billing_enabled: true }],
      billing_submissions: [
        { id: 'bz', job_id: JR, sub_id: 'zed', status: 'approved' },
        { id: 'bl', job_id: JR, sub_id: 'leah', status: 'approved' }, // old billing from before removal
      ],
    })
    mockState.db.signing_requests = []
    asPM()
  }

  test('add_company → C row billing OFF', async () => {
    seedRemoved()
    const res = await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: JR, company_id: 'C', action: 'add_company' }))
    expect(res.status).toBe(200)
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
    expect(cRowInserts()[0].payload.billing_enabled_at).toBeUndefined()
    expect(await leahJob()).toMatchObject({ billing_on: false, can_bill: false })
  })

  test('add_company with only a DRAFT company_id contract → OFF', async () => {
    seedRemoved({ cContract: { id: 'scD', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 1, status: 'draft' } })
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: JR, company_id: 'C', action: 'add_company' }))
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
  })

  test('add_company with an active company_id contract (status null) → ON (control)', async () => {
    seedRemoved({ cContract: { id: 'scN', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 1, status: null } })
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: JR, company_id: 'C', action: 'add_company' }))
    expect(cRowInserts()[0].payload).toMatchObject({ billing_enabled: true, billing_enabled_by: 'pm1' })
    expect(await leahJob()).toMatchObject({ billing_on: true, can_bill: true })
  })

  test('active vendor-name-only contract (residential addSub shape) → C row OFF', async () => {
    seedRemoved()
    const res = await subcontracts.POST(json('/api/subcontracts', 'POST', { job_id: JR, vendor_name: 'On Time Plumbing, LLC', contract_value: 500, status: 'active' }))
    expect((await res.json()).assignment_error).toBeUndefined()
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
    expect(await leahJob()).toMatchObject({ billing_on: false, can_bill: false })
  })

  test('subcontracts read failure → OFF (add_company and contract path)', async () => {
    seedRemoved({ cContract: { id: 'scA', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 1, status: 'active' } })
    mockState.failSelect.subcontracts = 'connection reset'
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: JR, company_id: 'C', action: 'add_company' }))
    expect(cRowInserts()).toHaveLength(1)
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
    expect(console.error).toHaveBeenCalled()

    seedRemoved({ cContract: { id: 'scA', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 1, status: 'active' } })
    mockState.failSelect.subcontracts = 'connection reset'
    const r = await ensureContractAssignment(require('./helpers/mock-db').supabaseModule.createClient(), { jobId: JR, companyId: 'C' })
    expect(r).toMatchObject({ ok: true, created: true })
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
  })

  test('billing_submissions read failure with an active company_id contract → OFF', async () => {
    seedRemoved({ cContract: { id: 'scA', job_id: JR, company_id: 'C', sub_id: null, vendor_name: 'On Time Plumbing LLC', contract_value: 1, status: 'active' } })
    mockState.failSelect.billing_submissions = 'connection reset'
    await companyJobAccess.POST(json('/api/company-job-access', 'POST', { job_id: JR, company_id: 'C', action: 'add_company' }))
    expect(cRowInserts()[0].payload.billing_enabled).toBe(false)
  })

  test('companyGrandfatheredOnJob: needs both the contract and a member billing on THIS job', async () => {
    const db = require('./helpers/mock-db').supabaseModule.createClient()
    seedRemoved()
    expect(await companyGrandfatheredOnJob(db, { jobId: JR, companyId: 'C', memberIds: ['leah'] })).toBe(false)
    expect(await companyGrandfatheredOnJob(db, { jobId: J1, companyId: 'C', memberIds: ['leah'] })).toBe(false) // contract, no billing on J1
    expect(await companyGrandfatheredOnJob(db, { jobId: JR, companyId: 'Z', memberIds: ['zed'] })).toBe(true)
    expect(await companyGrandfatheredOnJob(db, { jobId: JR, companyId: 'Z', memberIds: ['u1'] })).toBe(false) // contract, but no billing by these members
    expect(await companyGrandfatheredOnJob(db, { jobId: JR, companyId: 'C', memberIds: [] })).toBe(false)
  })

  test('both callers use the shared helper', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'app/api/company-job-access/route.js'), 'utf8')
    expect(route).toMatch(/companyGrandfatheredOnJob\(adminSupabase/)
    expect(route).not.toMatch(/jobsWithPriorBilling/)
  })
})

describe('Bot API subcontracts POST', () => {
  test("status 'active' → assignment with billing off (bot client)", async () => {
    seed({ subcontracts: [] })
    const res = await botSubcontracts.POST(json('/api/bot/v1/subcontracts', 'POST', { job_id: J1, company_id: 'c1', contract_value: 250, status: 'active' }))
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.assignment_error).toBeUndefined()
    expect(assignmentInserts()).toHaveLength(1)
    expect(assignmentInserts()[0].payload).toMatchObject({ job_id: J1, company_id: 'c1', billing_enabled: false })
  })
  test("status 'draft' → nothing assigned", async () => {
    seed({ subcontracts: [] })
    const res = await botSubcontracts.POST(json('/api/bot/v1/subcontracts', 'POST', { job_id: J1, company_id: 'c1', contract_value: 250, status: 'draft' }))
    expect(res.status).toBe(201)
    expect(assignmentWrites()).toHaveLength(0)
  })
  test('assignment failure → 201 with assignment_error', async () => {
    seed({ subcontracts: [] })
    mockState.failWrite.job_assignments = { insert: 'new row violates row-level security policy' }
    const res = await botSubcontracts.POST(json('/api/bot/v1/subcontracts', 'POST', { job_id: J1, company_id: 'c1', contract_value: 250, status: 'active' }))
    expect(res.status).toBe(201)
    expect((await res.json()).assignment_error).toMatch(/row-level security/)
  })
})

describe('client pages', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  test('dashboard saveSubcontract shows assignment_error', () => {
    const src = read('app/dashboard/page.js')
    const body = src.slice(src.indexOf('async function saveSubcontract('), src.indexOf('async function generateSubcontractPDF('))
    expect(body.match(/data\.assignment_error/g).length).toBeGreaterThanOrEqual(2)
    expect(body).toContain('Subcontract saved, but the sub was not added to the job: ')
    expect(body).not.toContain('company_id')
  })
  test('jobdetail addContract and activateContract show the server assignment_error', () => {
    const src = read('app/jobdetail/page.js')
    const add = src.slice(src.indexOf('async function addContract('), src.indexOf('async function activateContract('))
    expect(add).toMatch(/if \(scJson\.assignment_error\) \{ setErrMsg\('Subcontract saved, but the sub was not added to the job: ' \+ scJson\.assignment_error\)/)
    const act = src.slice(src.indexOf('async function activateContract('), src.indexOf('function isContractSigned('))
    expect(act).toMatch(/if \(actJson\.assignment_error\) \{ setErrMsg\('Subcontract activated, but the sub was not added to the job: ' \+ actJson\.assignment_error\)/)
    expect(act).toMatch(/if \(!res\.ok\) \{ setErrMsg\('Activate failed: ' \+ \(actJson\.error \|\| res\.status\)\)/)
  })
  test('jobdetail ensureAssignedForContract checks the responses', () => {
    const src = read('app/jobdetail/page.js')
    const start = src.indexOf('async function ensureAssignedForContract(')
    const body = src.slice(start, src.indexOf('\n  }\n', start))
    expect(body).toMatch(/res\.ok/)
    expect(body).toMatch(/json\.error/)
    expect(body).toMatch(/setErrMsg\(/)
    expect(body).toContain('billing_enabled: false')
    expect(body).toContain('if (!normalEmail && !companyId) return')
  })
})

describe('migration 061', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '061_backfill_contract_billing_assignments.sql'), 'utf8')
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('inserts only where NOT EXISTS, billing on, tagged with the fixed invited_at', () => {
    expect(body).toMatch(/INSERT INTO public\.job_assignments/)
    expect((body.match(/NOT EXISTS/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(body).toMatch(/status IS NULL OR sc\.status <> 'draft'/)
    expect(body).toMatch(/'2026-11-09 00:00:00-06'::timestamptz, true, now\(\), NULL::uuid/)
    expect(body).not.toMatch(/\bUPDATE\b|\bDELETE\b/i)
  })
  test('rollback deletes by the tag; header lists the expected rows and a preview', () => {
    expect(sql).toMatch(/ROLLBACK[\s\S]*DELETE FROM public\.job_assignments\s*\n--\s*WHERE invited_at = '2026-11-09 00:00:00-06'::timestamptz\s*\n--\s*AND billing_enabled_by IS NULL/)
    expect(sql).toMatch(/PREVIEW \(read-only\)/)
    for (const s of ['#115', '#117', '#121', '#7551', '#R-101', 'Jake Paladino', 'Leah Akutagawa-Fu']) expect(sql).toContain(s)
    expect(sql).toMatch(/— 5 rows:/)
    expect(sql).toMatch(/person rows \(0\):/)
    expect(sql).toMatch(/PREVIEW[\s\S]*AS person_row/)
  })
  test('person rows only for company-less subs (no row that leaks a job to a different profile company)', () => {
    const personInsert = body.slice(body.lastIndexOf('INSERT INTO public.job_assignments'))
    expect(personInsert).toMatch(/JOIN public\.profiles p ON p\.id = t\.sub_id/)
    expect(personInsert).toMatch(/AND p\.company_id IS NULL/)
    expect(personInsert).toMatch(/t\.job_id, NULL::uuid, p\.id, lower\(trim\(p\.invite_email\)\)/)
    expect(personInsert).not.toMatch(/t\.job_id, p\.company_id/)
  })
})
