/**
 * Office RFI actions (/api/rfi-actions) + RFI notify helpers.
 *
 * Incidents covered:
 *  - Answering a sub-submitted RFI sent nothing: email + bell only fired for
 *    super_id. Now both super and sub are notified; email comes from auth.users.
 *  - Respond save errors left the button stuck on "Saving..."; the route now
 *    returns the real error so the page can show it.
 *  - New-RFI email only went to jobs.pm_email; now also the assigned PMs, de-duped.
 *  - PM dashboard Open RFIs selected a non-existent `question` column.
 */

let db
let mockAuth
let mockEmails
let mockUpdateError
let mockSelects
let mockAuthUsers

function mockQuery(table) {
  const filters = []
  let pendingUpdate = null
  let pendingInsert = null
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (pendingInsert) {
      const row = { id: `${table}-${(db[table] || []).length + 1}`, ...pendingInsert }
      db[table] = [...(db[table] || []), row]
      return { data: row, error: null }
    }
    if (pendingUpdate) {
      if (table === 'rfis' && mockUpdateError) return { data: null, error: mockUpdateError }
      const hit = rows()
      hit.forEach(r => Object.assign(r, pendingUpdate))
      return { data: hit, error: null }
    }
    return { data: rows(), error: null }
  }
  const q = {
    select: cols => { mockSelects.push({ table, cols }); return q },
    order: () => q,
    limit: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    lte: () => q,
    neq: () => q,
    ilike: (c, v) => { filters.push(r => (r[c] || '').toLowerCase() === String(v).toLowerCase()); return q },
    update: patch => { pendingUpdate = patch; return q },
    insert: row => { pendingInsert = row; return q },
    single: () => Promise.resolve((({ data, error }) => ({ data: Array.isArray(data) ? data[0] ?? null : data, error }))(run())),
    maybeSingle: () => Promise.resolve((({ data, error }) => ({ data: Array.isArray(data) ? data[0] ?? null : data, error }))(run())),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockQuery(table),
    auth: {
      admin: {
        getUserById: async id => {
          const u = mockAuthUsers.find(x => x.id === id)
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'User not found' } }
        },
        listUsers: async () => ({ data: { users: mockAuthUsers }, error: null }),
      },
    },
  }),
}))
jest.mock('resend', () => ({
  Resend: function () { this.emails = { send: async msg => { mockEmails.push(msg); return { data: { id: 'e1' }, error: null } } } },
}))
jest.mock('../lib/server-auth', () => {
  const PM_ROLES = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbidden = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    PM_ROLES,
    requireAuth: async () => mockAuth,
    requirePM: async () => (PM_ROLES.has(mockAuth.role) ? mockAuth : forbidden()),
  }
})

const route = require('../app/api/rfi-actions/route')
const { dedupeEmails, rfiSubmitterLabel, notifyRfiSubmitted } = require('../lib/rfi-notify')

function seed() {
  mockAuth = { userId: 'pm1', email: 'pm@nv.test', role: 'pm', error: null }
  mockEmails = []
  mockUpdateError = null
  mockSelects = []
  mockAuthUsers = [
    { id: 'pm1', email: 'pm@nv.test' },
    { id: 'pm2', email: 'PM@nv.test' }, // same address, different case → de-duped
    { id: 'apm1', email: 'apm@nv.test' },
    { id: 'sup1', email: 'super@nv.test' },
    { id: 'sub1', email: 'sam@acme.test' },
  ]
  db = {
    jobs: [
      { id: 'J1', job_number: '101', project_name: 'Mine', pm_email: 'pm@nv.test' },
      { id: 'J2', job_number: '202', project_name: 'Not mine', pm_email: 'other@nv.test' },
    ],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'pm1' },
      { id: 'a2', job_id: 'J1', user_id: 'pm2' },
      { id: 'a3', job_id: 'J1', user_id: 'apm1' },
      { id: 'a4', job_id: 'J1', user_id: 'sup1' }, // super: not a PM recipient
    ],
    profiles: [
      { id: 'pm1', role: 'pm', full_name: 'Pat PM' },
      { id: 'pm2', role: 'pm', full_name: 'Pam PM' },
      { id: 'apm1', role: 'apm', full_name: 'Al APM' },
      { id: 'sup1', role: 'super', full_name: 'Sue Super' },
      { id: 'sub1', role: 'subcontractor', full_name: 'Sam Sub', company_id: 'c1', company_name: 'Old Name' },
    ],
    companies: [{ id: 'c1', name: 'Acme Electric' }],
    rfis: [
      { id: 'r-sub', job_id: 'J1', sub_id: 'sub1', super_id: null, title: 'Spec <A3>', status: 'open', created_at: '2026-11-01' },
      { id: 'r-sup', job_id: 'J1', sub_id: null, super_id: 'sup1', title: 'Footing', status: 'open', created_at: '2026-11-02' },
      { id: 'r-other', job_id: 'J2', sub_id: 'sub1', title: 'Elsewhere', status: 'open', created_at: '2026-11-03' },
    ],
    notifications: [],
  }
}

const post = body => route.POST(new Request('http://x/api/rfi-actions', { method: 'POST', body: JSON.stringify(body) }))
const get = jobId => route.GET(new Request(`http://x/api/rfi-actions?job_id=${jobId}`))

beforeEach(seed)

describe('POST respond', () => {
  test('sub-submitted RFI: saves the answer, emails the sub (auth.users) and adds a bell notification', async () => {
    const res = await post({ rfi_id: 'r-sub', action: 'respond', response: '  Use <b>4000 psi</b>  ' })
    expect(res.status).toBe(200)
    const saved = db.rfis.find(r => r.id === 'r-sub')
    expect(saved).toMatchObject({ status: 'answered', response: 'Use <b>4000 psi</b>', responded_by: 'pm1' })

    expect(mockEmails).toHaveLength(1)
    expect(mockEmails[0].to).toBe('sam@acme.test')
    expect(mockEmails[0].html).toContain('/submit')
    expect(mockEmails[0].html).toContain('&lt;b&gt;4000 psi&lt;/b&gt;')
    expect(mockEmails[0].html).toContain('Spec &lt;A3&gt;')

    expect(db.notifications).toHaveLength(1)
    expect(db.notifications[0]).toMatchObject({ recipient_id: 'sub1', type: 'rfi_answered', entity_id: 'r-sub', job_id: 'J1' })
    expect((await res.json()).notified.ok).toBe(true)
  })

  test('super-submitted RFI still notifies the super, linking to the field portal', async () => {
    const res = await post({ rfi_id: 'r-sup', action: 'respond', response: 'Yes' })
    expect(res.status).toBe(200)
    expect(mockEmails.map(m => m.to)).toEqual(['super@nv.test'])
    expect(mockEmails[0].html).toContain('/field')
    expect(db.notifications.map(n => n.recipient_id)).toEqual(['sup1'])
  })

  test('a save error is returned to the caller and nobody is notified', async () => {
    mockUpdateError = { message: 'permission denied for table rfis' }
    const res = await post({ rfi_id: 'r-sub', action: 'respond', response: 'Yes' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('permission denied for table rfis')
    expect(mockEmails).toHaveLength(0)
    expect(db.notifications).toHaveLength(0)
  })

  test('requires a response', async () => {
    const res = await post({ rfi_id: 'r-sub', action: 'respond', response: '   ' })
    expect(res.status).toBe(400)
    expect(db.rfis.find(r => r.id === 'r-sub').status).toBe('open')
  })

  test('PM cannot answer an RFI on a job they are not on', async () => {
    const res = await post({ rfi_id: 'r-other', action: 'respond', response: 'Yes' })
    expect(res.status).toBe(403)
    expect(db.rfis.find(r => r.id === 'r-other').status).toBe('open')
    expect(mockEmails).toHaveLength(0)
  })

  test('sub roles are refused', async () => {
    mockAuth = { ...mockAuth, userId: 'sub1', role: 'subcontractor' }
    const res = await post({ rfi_id: 'r-sub', action: 'respond', response: 'Yes' })
    expect(res.status).toBe(403)
  })

  test('unknown RFI → 404', async () => {
    const res = await post({ rfi_id: 'nope', action: 'respond', response: 'Yes' })
    expect(res.status).toBe(404)
  })
})

describe('POST close', () => {
  test('PM on the job can close', async () => {
    const res = await post({ rfi_id: 'r-sub', action: 'close' })
    expect(res.status).toBe(200)
    expect(db.rfis.find(r => r.id === 'r-sub').status).toBe('closed')
    expect(mockEmails).toHaveLength(0)
  })

  test('principal can close on any job', async () => {
    mockAuth = { userId: 'boss', email: 'boss@nv.test', role: 'principal', error: null }
    const res = await post({ rfi_id: 'r-other', action: 'close' })
    expect(res.status).toBe(200)
    expect(db.rfis.find(r => r.id === 'r-other').status).toBe('closed')
  })

  test('PM cannot close on a job they are not on', async () => {
    const res = await post({ rfi_id: 'r-other', action: 'close' })
    expect(res.status).toBe(403)
    expect(db.rfis.find(r => r.id === 'r-other').status).toBe('open')
  })

  test.each(['apm', 'super', 'admin'])('%s cannot close (PM-level only)', async role => {
    mockAuth = { userId: role === 'apm' ? 'apm1' : 'sup1', email: 'x@nv.test', role, error: null }
    const res = await post({ rfi_id: 'r-sub', action: 'close' })
    expect(res.status).toBe(403)
    expect(db.rfis.find(r => r.id === 'r-sub').status).toBe('open')
  })

  test('close errors are returned', async () => {
    mockUpdateError = { message: 'boom' }
    const res = await post({ rfi_id: 'r-sub', action: 'close' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('boom')
  })

  test('unknown action → 400', async () => {
    const res = await post({ rfi_id: 'r-sub', action: 'delete' })
    expect(res.status).toBe(400)
  })
})

describe('GET (job RFI list)', () => {
  test('labels each RFI with who submitted it', async () => {
    const res = await get('J1')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    const byId = Object.fromEntries(data.map(r => [r.id, r.submitter_label]))
    expect(byId['r-sub']).toBe('Sam Sub (Acme Electric)')
    expect(byId['r-sup']).toBe('Sue Super (Super)')
    expect(data.some(r => r.id === 'r-other')).toBe(false)
  })

  test('PM cannot list another job', async () => {
    const res = await get('J2')
    expect(res.status).toBe(403)
  })
})

describe('notifyRfiSubmitted', () => {
  test("emails jobs.pm_email plus the job's assigned PMs/APMs, de-duplicated, not supers", async () => {
    const r = await notifyRfiSubmitted({ job_id: 'J1', title: 'Spec', description: 'Q', submitter_name: 'Sam' })
    expect(r.ok).toBe(true)
    expect(mockEmails.map(m => m.to).sort()).toEqual(['apm@nv.test', 'pm@nv.test'])
  })

  test('still emails assigned PMs when the job has no pm_email', async () => {
    db.jobs[0].pm_email = null
    const r = await notifyRfiSubmitted({ job_id: 'J1', title: 'Spec', description: 'Q', submitter_name: 'Sam' })
    expect(r.ok).toBe(true)
    expect(mockEmails.map(m => m.to).sort()).toEqual(['apm@nv.test', 'pm@nv.test'])
  })

  test('no recipients → not ok, nothing sent', async () => {
    db.jobs[1].pm_email = null
    const r = await notifyRfiSubmitted({ job_id: 'J2', title: 'Spec', description: 'Q', submitter_name: 'Sam' })
    expect(r.ok).toBe(false)
    expect(mockEmails).toHaveLength(0)
  })
})

describe('helpers', () => {
  test('dedupeEmails trims, drops blanks, and ignores case', () => {
    expect(dedupeEmails([' a@x.test ', 'A@X.test', '', null, 'b@x.test'])).toEqual(['a@x.test', 'b@x.test'])
  })

  test('rfiSubmitterLabel', () => {
    const profiles = { s: { full_name: 'Sam', company_id: 'c1' }, u: { full_name: 'Sue' }, n: { full_name: 'Ned', company_name: 'Ned Co' } }
    const companies = { c1: 'Acme' }
    expect(rfiSubmitterLabel({ sub_id: 's' }, profiles, companies)).toBe('Sam (Acme)')
    expect(rfiSubmitterLabel({ sub_id: 'n' }, profiles, companies)).toBe('Ned (Ned Co)')
    expect(rfiSubmitterLabel({ sub_id: 'gone' }, profiles, companies)).toBe('Subcontractor')
    expect(rfiSubmitterLabel({ super_id: 'u' }, profiles, companies)).toBe('Sue (Super)')
    expect(rfiSubmitterLabel({}, profiles, companies)).toBeNull()
  })
})

describe('GET /api/my-work Open RFIs', () => {
  test('selects real rfis columns (no `question`) and returns open RFIs on my jobs', async () => {
    const myWork = require('../app/api/my-work/route')
    db.sales_order_tasks = []
    db.billing_submissions = []
    db.meeting_action_items = []
    db.milestones = []
    const res = await myWork.GET(new Request('http://x/api/my-work'))
    expect(res.status).toBe(200)
    const rfiSelect = mockSelects.find(s => s.table === 'rfis')
    expect(rfiSelect.cols).not.toMatch(/\bquestion\b/)
    expect(rfiSelect.cols).toMatch(/\btitle\b/)
    expect(rfiSelect.cols).toMatch(/\bdescription\b/)
    const { rfis } = await res.json()
    expect(rfis.map(r => r.id).sort()).toEqual(['r-sub', 'r-sup'])
  })
})
