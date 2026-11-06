/**
 * Role gates on the Owner-only money / team routes and Ask AI.
 * Business Dev, job profit, employees, employee allocations (writes and pay
 * fields), NV team admin and fix-profile are principal-only. Ask AI is office
 * roles only, and PM/APM/super must be on the job. Drawings signed-url checks
 * the job (subs must see it).
 */

let db
let mockAuth
let selects
let updates
let mockSubCanSee

function mockQuery(table) {
  const filters = []
  let op = 'select'
  let head = false
  let payload = null
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'update') { updates.push({ table, payload }); return { data: rows().map(r => ({ id: r.id })), error: null } }
    if (op === 'delete') { const gone = rows(); db[table] = (db[table] || []).filter(r => !gone.includes(r)); return { data: null, error: null } }
    if (op === 'insert') return { data: { id: 'new', ...payload }, error: null }
    const data = rows()
    return head ? { data: null, count: data.length, error: null } : { data, error: null }
  }
  const q = {
    select: (cols, opts) => { selects.push({ table, cols }); if (opts?.head) head = true; return q },
    order: () => q, limit: () => q, range: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    neq: (c, v) => { filters.push(r => r[c] !== v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    ilike: (c, v) => { filters.push(r => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase()); return q },
    or: () => q,
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    insert: p => { op = 'insert'; payload = p; return q },
    upsert: () => q,
    single: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: t => mockQuery(t),
    auth: { admin: { generateLink: async () => ({ data: { user: { id: 'n1' }, properties: { action_link: 'https://link' } }, error: null }), updateUserById: async () => ({ error: null }), deleteUser: async () => ({ error: null }), listUsers: async () => ({ data: { users: [] }, error: null }) } },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed' }, error: null }) }) },
  }),
}))
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: async () => ({ error: null }) } } } }))
jest.mock('../lib/server-auth', () => {
  const actual = jest.requireActual('../lib/server-auth')
  return { ...actual, requireAuth: async () => mockAuth, requirePM: async () => (actual.isPM(mockAuth.role) ? mockAuth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }) }
})
jest.mock('../lib/sub-access', () => ({ subCanSeeJob: async () => mockSubCanSee }))

const bd = require('../app/api/bd/route')
const jobProfit = require('../app/api/job-profit/route')
const employees = require('../app/api/employees/route')
const allocs = require('../app/api/employee-allocations/route')
const inviteTeam = require('../app/api/invite-team/route')
const fixProfile = require('../app/api/fix-profile/route')
const askAi = require('../app/api/ask-ai/route')
const drawings = require('../app/api/drawings/route')

const JOB = '8ae26b84-c4df-4a75-a466-48ee7bed9f0c'
const OTHER_JOB = '11111111-2222-3333-4444-555555555555'
const req = (method, body, url = 'http://x/api') => new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockAuth = { userId: 'u1', email: 'me@nv.co', role, error: null, ...extra } }

beforeEach(() => {
  selects = []
  updates = []
  mockSubCanSee = false
  db = {
    jobs: [{ id: JOB, pm_email: 'pm@nv.co' }, { id: OTHER_JOB, pm_email: null }],
    pm_job_assignments: [{ id: 'a1', job_id: JOB, user_id: 'u1' }],
    profiles: [{ id: 'p1', role: 'principal' }, { id: 'p2', role: 'pm' }],
    bd_opportunities: [], bd_goals: [], employees: [], employee_job_allocations: [{ id: 'al1', job_id: JOB }],
    budget_items: [], direct_costs: [], change_orders: [], billing_submissions: [], billing_sov_lines: [], subcontracts: [], subcontracts_summary: [],
    drawings: [{ id: 'dr1', job_id: OTHER_JOB, storage_path: `${OTHER_JOB}/1-a.pdf` }],
  }
})

const NON_OWNERS = ['pm', 'apm', 'super', 'admin']

describe('Owner-only routes: pm/apm/super/admin get 403', () => {
  test.each(NON_OWNERS)('%s', async role => {
    as(role)
    const calls = [
      bd.GET(req('GET')), bd.POST(req('POST', { project_name: 'X' })), bd.PATCH(req('PATCH', { id: 'o1', notes: 'x' })), bd.DELETE(req('DELETE', { id: 'o1' })),
      jobProfit.POST(req('POST', { job_ids: [JOB] })),
      employees.GET(req('GET')), employees.POST(req('POST', { name: 'A' })), employees.PATCH(req('PATCH', { id: 'e1', name: 'B' })), employees.PUT(req('PUT', { id: 'e1' })), employees.DELETE(req('DELETE', null, 'http://x/api?id=e1')),
      allocs.POST(req('POST', { job_id: JOB, employee_id: 'e1' })), allocs.PUT(req('PUT', { id: 'al1' })), allocs.DELETE(req('DELETE', null, 'http://x/api?id=al1')),
      allocs.GET(req('GET', null, 'http://x/api?employee_id=e1')), allocs.GET(req('GET', null, 'http://x/api')),
      inviteTeam.POST(req('POST', { email: 'a@b.c', role: 'apm' })), inviteTeam.PATCH(req('PATCH', { user_id: 'p1', email: 'x@y.z' })), inviteTeam.DELETE(req('DELETE', { user_id: 'p1' })),
      fixProfile.POST(req('POST', { email: 'a@b.c', role: 'pm' })),
    ]
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403)
    expect(updates).toEqual([])
  })

  test('principal passes', async () => {
    as('principal')
    expect((await bd.GET(req('GET'))).status).toBe(200)
    expect((await employees.GET(req('GET'))).status).toBe(200)
    expect((await jobProfit.POST(req('POST', { job_ids: [] }))).status).toBe(200)
  })

  test('bd PATCH writes only whitelisted fields', async () => {
    as('principal')
    await bd.PATCH(req('PATCH', { id: 'o1', notes: 'n', created_at: 'hack', id_owner: 'x', stage: 'won' }))
    expect(updates).toEqual([{ table: 'bd_opportunities', payload: { notes: 'n', stage: 'won' } }])
  })

  test('employees PATCH writes only whitelisted fields', async () => {
    as('principal')
    db.employees = [{ id: 'e1' }]
    await employees.PATCH(req('PATCH', { id: 'e1', weekly_salary: '1000', is_admin: true }))
    expect(updates).toEqual([{ table: 'employees', payload: { weekly_salary: 1000 } }])
  })
})

describe('employee allocations job read without pay', () => {
  test('super on the job gets hours only, no salary columns', async () => {
    as('super')
    const res = await allocs.GET(req('GET', null, `http://x/api?job_id=${JOB}`))
    expect(res.status).toBe(200)
    const sel = selects.find(s => s.table === 'employee_job_allocations').cols
    expect(sel).not.toMatch(/weekly_|\*/)
  })
  test('super not on the job is refused', async () => {
    as('super')
    expect((await allocs.GET(req('GET', null, `http://x/api?job_id=${OTHER_JOB}`))).status).toBe(403)
  })
  test('principal gets pay columns', async () => {
    as('principal')
    await allocs.GET(req('GET', null, `http://x/api?job_id=${JOB}`))
    expect(selects.find(s => s.table === 'employee_job_allocations').cols).toMatch(/weekly_salary/)
  })
})

describe('NV team: last Owner', () => {
  test('cannot delete the last Owner', async () => {
    as('principal', { userId: 'other' })
    db.profiles = [{ id: 'p1', role: 'principal' }]
    const res = await inviteTeam.DELETE(req('DELETE', { user_id: 'p1' }))
    expect(res.status).toBe(409)
  })
  test('cannot delete own account', async () => {
    as('principal', { userId: 'p1' })
    expect((await inviteTeam.DELETE(req('DELETE', { user_id: 'p1' }))).status).toBe(409)
  })
})

describe('Ask AI access', () => {
  const body = { job_id: JOB, messages: [{ role: 'user', content: 'hi' }] }
  test.each(['subcontractor', 'sub_pm', 'owner', 'roofing_rep', 'metal_rep', null])('%s gets 403', async role => {
    as(role)
    expect((await askAi.POST(req('POST', body))).status).toBe(403)
    expect(selects.filter(s => ['budget_items', 'direct_costs', 'billing_submissions', 'subcontracts'].includes(s.table))).toEqual([])
  })
  test('super / apm not on the job get 403', async () => {
    for (const role of ['super', 'apm']) {
      as(role, { userId: 'nobody', email: 'x@nv.co' })
      expect((await askAi.POST(req('POST', body))).status).toBe(403)
    }
  })
  test('super listed as the job PM passes the gate', async () => {
    as('super', { userId: 'nobody', email: 'PM@nv.co' })
    delete process.env.GEMINI_API_KEY
    expect((await askAi.POST(req('POST', body))).status).toBe(503) // reached the model step
  })
  test('only a system message is refused (400)', async () => {
    as('principal')
    expect((await askAi.POST(req('POST', { job_id: JOB, messages: [{ role: 'system', content: 'x' }] }))).status).toBe(400)
  })
})

describe('drawings signed-url checks the job', () => {
  const path = `${OTHER_JOB}/1-a.pdf`
  test('sub who cannot see the job: 403', async () => {
    as('subcontractor')
    expect((await drawings.POST(req('POST', { action: 'signed-url', path }))).status).toBe(403)
  })
  test('sub who can see the job: ok', async () => {
    as('subcontractor'); mockSubCanSee = true
    expect((await drawings.POST(req('POST', { action: 'signed-url', path }))).status).toBe(200)
  })
  test('client owner / sales rep: 403', async () => {
    for (const role of ['owner', 'roofing_rep']) {
      as(role)
      expect((await drawings.POST(req('POST', { action: 'signed-url', path }))).status).toBe(403)
    }
  })
  test('PM not on the job: 403; on the job: ok', async () => {
    as('pm', { email: 'nobody@nv.co' })
    expect((await drawings.POST(req('POST', { action: 'signed-url', path }))).status).toBe(403)
    expect((await drawings.POST(req('POST', { action: 'signed-url', path: `${JOB}/x.pdf` }))).status).toBe(200)
  })
  test('super delete on another job: 403', async () => {
    as('super', { userId: 'nobody' })
    expect((await drawings.POST(req('POST', { action: 'delete', drawing_id: 'dr1' }))).status).toBe(403)
  })
})
