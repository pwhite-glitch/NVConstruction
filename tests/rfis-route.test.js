/**
 * Sub portal RFIs (/api/rfis).
 *
 * Incident: app/submit inserted into rfis with a "question" column that does
 * not exist and swallowed the error, so no sub RFI ever saved. Now the insert
 * is server-side: sub must see the job, text goes to description, number is
 * max + 1 per job with a retry on unique violation, and the PM is emailed.
 */

let db
let mockAuth
let mockInsertHook
let mockEmails

function mockQuery(table) {
  const filters = []
  let orderBy = null
  let lim = null
  let pendingInsert = null
  const rows = () => {
    let out = (db[table] || []).filter(r => filters.every(f => f(r)))
    if (orderBy) out = [...out].sort((a, b) => (orderBy.asc ? 1 : -1) * ((a[orderBy.col] ?? 0) - (b[orderBy.col] ?? 0)))
    if (lim != null) out = out.slice(0, lim)
    return out
  }
  const doInsert = () => {
    const hooked = mockInsertHook?.(table, pendingInsert)
    if (hooked) return hooked
    if (table === 'rfis' && pendingInsert.number != null &&
        (db.rfis || []).some(r => r.job_id === pendingInsert.job_id && r.number === pendingInsert.number)) {
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "rfis_job_number_unique"' } }
    }
    const row = { id: `rfi-${(db[table] || []).length + 1}`, ...pendingInsert }
    db[table] = [...(db[table] || []), row]
    return { data: row, error: null }
  }
  const q = {
    select: () => q,
    order: (col, opts = {}) => { orderBy = { col, asc: opts.ascending !== false }; return q },
    limit: n => { lim = n; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    not: (c, op, v) => { filters.push(r => !(op === 'is' && v === null && r[c] == null)); return q },
    ilike: (c, v) => { filters.push(r => (r[c] || '').toLowerCase() === String(v).toLowerCase()); return q },
    or: expr => {
      const parts = expr.split(/,(?![^(]*\))/).map(part => {
        const [col, op, ...rest] = part.split('.')
        const val = rest.join('.')
        if (op === 'eq') return r => String(r[col]) === val
        if (op === 'ilike') return r => (r[col] || '').toLowerCase() === val.toLowerCase()
        if (op === 'is') return r => r[col] == null
        if (op === 'neq') return r => String(r[col]) !== val
        if (op === 'in') {
          const vals = val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, ''))
          return r => vals.includes(String(r[col]))
        }
        throw new Error(`unsupported or() op ${op}`)
      })
      filters.push(r => parts.some(p => p(r)))
      return q
    },
    insert: row => { pendingInsert = row; return q },
    single: () => Promise.resolve(pendingInsert ? doInsert() : { data: rows()[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))
jest.mock('resend', () => ({
  Resend: function () { this.emails = { send: async msg => { mockEmails.push(msg); return { data: { id: 'e1' }, error: null } } } },
}))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => mockAuth,
  isSub: role => ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'].includes(role),
}))

const route = require('../app/api/rfis/route')

function seed() {
  mockAuth = { userId: 'u1', email: 'me@acme.test', role: 'subcontractor', companyId: 'c1', error: null }
  mockInsertHook = null
  mockEmails = []
  db = {
    companies: [{ id: 'c1', name: 'Acme Electric' }],
    profiles: [{ id: 'u1', full_name: 'Sam Sub', role: 'subcontractor', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'me@acme.test', job_access: 'company', can_bill: true }],
    jobs: [
      { id: 'J1', status: 'active', job_number: '101', project_name: 'Mine', pm_email: 'pm@nv.test' },
      { id: 'J2', status: 'active', job_number: '202', project_name: 'Not mine', pm_email: 'pm2@nv.test' },
    ],
    job_assignments: [{ id: 'a1', job_id: 'J1', company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: true }],
    subcontracts: [],
    rfis: [],
  }
}

const post = body => route.POST(new Request('http://x/api/rfis', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(seed)

describe('POST /api/rfis', () => {
  test('refuses a job the sub is not assigned to, and saves nothing', async () => {
    const res = await post({ job_id: 'J2', title: 'Spec', description: 'Which spec?' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/access/)
    expect(db.rfis).toHaveLength(0)
    expect(mockEmails).toHaveLength(0)
  })

  test('refuses non-sub roles', async () => {
    mockAuth = { ...mockAuth, role: 'pm' }
    const res = await post({ job_id: 'J1', title: 'Spec', description: 'Which spec?' })
    expect(res.status).toBe(403)
    expect(db.rfis).toHaveLength(0)
  })

  test('requires title and description', async () => {
    const res = await post({ job_id: 'J1', title: 'Spec', question: 'old field name' })
    expect(res.status).toBe(400)
    expect(db.rfis).toHaveLength(0)
  })

  test('saves the text to description, uses the session user as sub_id, and emails the PM', async () => {
    const res = await post({ job_id: 'J1', sub_id: 'someone-else', title: '  Spec at A3 ', description: 'Which <b>concrete</b>?' })
    expect(res.status).toBe(200)
    expect(db.rfis).toHaveLength(1)
    const saved = db.rfis[0]
    expect(saved).toMatchObject({ job_id: 'J1', sub_id: 'u1', title: 'Spec at A3', description: 'Which <b>concrete</b>?', status: 'open', number: 1 })
    expect(saved).not.toHaveProperty('question')
    expect(Object.keys(saved).sort()).toEqual(['description', 'id', 'job_id', 'number', 'status', 'sub_id', 'title'])

    expect(mockEmails).toHaveLength(1)
    expect(mockEmails[0].to).toBe('pm@nv.test')
    expect(mockEmails[0].subject).toContain('Spec at A3')
    expect(mockEmails[0].html).toContain('Sam Sub (Acme Electric)')
    expect(mockEmails[0].html).toContain('&lt;b&gt;concrete&lt;/b&gt;')
  })

  test('numbers per job as max + 1, ignoring other jobs and un-numbered rows', async () => {
    db.rfis = [
      { id: 'r1', job_id: 'J1', number: 3 },
      { id: 'r2', job_id: 'J1', number: null },
      { id: 'r3', job_id: 'J2', number: 9 },
    ]
    const res = await post({ job_id: 'J1', title: 'A', description: 'B' })
    expect(res.status).toBe(200)
    expect((await res.json()).rfi.number).toBe(4)
  })

  test('retries with a fresh number when a concurrent insert takes it (23505)', async () => {
    db.rfis = [{ id: 'r1', job_id: 'J1', number: 1 }]
    let raced = false
    mockInsertHook = (table, row) => {
      if (table !== 'rfis' || raced) return null
      raced = true
      db.rfis.push({ id: 'other', job_id: 'J1', number: row.number }) // someone else got #2 first
      return { data: null, error: { code: '23505', message: 'duplicate key' } }
    }
    const res = await post({ job_id: 'J1', title: 'A', description: 'B' })
    expect(res.status).toBe(200)
    expect((await res.json()).rfi.number).toBe(3)
    expect(db.rfis.filter(r => r.job_id === 'J1').map(r => r.number).sort()).toEqual([1, 2, 3])
  })

  test('returns the real database error to the caller', async () => {
    mockInsertHook = table => table === 'rfis' ? { data: null, error: { code: '42703', message: 'column "foo" does not exist' } } : null
    const res = await post({ job_id: 'J1', title: 'A', description: 'B' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('column "foo" does not exist')
    expect(mockEmails).toHaveLength(0)
  })
})

describe('GET /api/rfis', () => {
  test("returns only the caller's RFIs", async () => {
    db.rfis = [{ id: 'r1', job_id: 'J1', sub_id: 'u1' }, { id: 'r2', job_id: 'J1', sub_id: 'u9' }]
    const res = await route.GET(new Request('http://x/api/rfis'))
    expect((await res.json()).data.map(r => r.id)).toEqual(['r1'])
  })
})
