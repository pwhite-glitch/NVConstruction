/**
 * Budget line guards on direct cost approval (/api/dc-review) and edits (PUT /api/direct-costs).
 *
 * Incident: the dashboard "Costs to Approve" queue could not approve most costs because they
 * had no budget line and there was no way to pick one there. Approve now takes an optional
 * budget_item_id, which must be on the cost's own job, from a user assigned to that job, and
 * is saved with the approval in one update conditioned on status = pending.
 */

let db
let mockAuth
let mockBeforeUpdate

function mockQuery(table) {
  const filters = []
  let pendingUpdate = null
  let wantRows = false
  let lim = null
  const match = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (pendingUpdate) {
      mockBeforeUpdate?.(table)
      const hit = match()
      hit.forEach(r => Object.assign(r, pendingUpdate))
      return { data: wantRows ? hit.map(r => ({ id: r.id })) : null, error: null }
    }
    let out = match()
    if (lim != null) out = out.slice(0, lim)
    return { data: out, error: null }
  }
  const q = {
    select: () => { if (pendingUpdate) wantRows = true; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    ilike: (c, pat) => {
      const re = new RegExp('^' + pat.replace(/\\(.)|[%_]|[^\\%_]+/g, (m, esc) =>
        esc != null ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : m === '%' ? '.*' : m === '_' ? '.' : m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + '$', 'i')
      filters.push(r => r[c] != null && re.test(r[c]))
      return q
    },
    limit: n => { lim = n; return q },
    order: () => q,
    update: u => { pendingUpdate = u; return q },
    maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))
jest.mock('resend', () => ({
  Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } },
}))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => mockAuth,
  requirePM: async () => mockAuth,
}))

const review = require('../app/api/dc-review/route')
const directCosts = require('../app/api/direct-costs/route')

function seed() {
  mockAuth = { userId: 'pm1', role: 'pm', error: null }
  mockBeforeUpdate = null
  db = {
    jobs: [
      { id: 'J1', job_number: '101', project_name: 'Main St' },
      { id: 'J2', job_number: '202', project_name: 'Elm St' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }],
    budget_items: [
      { id: 'L1', job_id: 'J1', cost_code: '03-300', description: 'Concrete' },
      { id: 'L2', job_id: 'J1', cost_code: '06-100', description: 'Rough carpentry' },
      { id: 'X1', job_id: 'J2', cost_code: '03-300', description: 'Concrete' },
    ],
    direct_costs: [
      { id: 'c1', job_id: 'J1', status: 'pending', budget_item_id: null, description: 'Ready mix', amount: 500, created_at: '2026-10-01T00:00:00Z' },
      { id: 'c2', job_id: 'J2', status: 'pending', budget_item_id: null, description: 'Lumber', amount: 200, created_at: '2026-10-02T00:00:00Z' },
    ],
    profiles: [],
  }
}

const cost = id => db.direct_costs.find(c => c.id === id)
const post = body => review.POST(new Request('http://x/api/dc-review', { method: 'POST', body: JSON.stringify(body) }))
const put = body => directCosts.PUT(new Request('http://x/api/direct-costs', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(seed)

describe('POST /api/dc-review approve with a budget line', () => {
  test('saves the line and the approval together', async () => {
    const res = await post({ action: 'approve', id: 'c1', budget_item_id: 'L2' })
    expect(res.status).toBe(200)
    expect(cost('c1')).toMatchObject({ status: 'approved', budget_item_id: 'L2', reviewed_by: 'pm1', job_id: 'J1' })
  })

  test('approves with the line already on the cost when none is sent', async () => {
    cost('c1').budget_item_id = 'L1'
    const res = await post({ action: 'approve', id: 'c1' })
    expect(res.status).toBe(200)
    expect(cost('c1')).toMatchObject({ status: 'approved', budget_item_id: 'L1' })
  })

  test('still requires a line when none is sent or stored', async () => {
    const res = await post({ action: 'approve', id: 'c1' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/budget line must be assigned/)
    expect(cost('c1').status).toBe('pending')
  })

  test('rejects a line from another job with 422 and does not move the cost', async () => {
    const res = await post({ action: 'approve', id: 'c1', budget_item_id: 'X1' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/different job/)
    expect(cost('c1')).toMatchObject({ status: 'pending', budget_item_id: null, job_id: 'J1' })
  })

  test('rejects a stored line that is on another job', async () => {
    cost('c1').budget_item_id = 'X1'
    const res = await post({ action: 'approve', id: 'c1' })
    expect(res.status).toBe(422)
    expect(cost('c1').status).toBe('pending')
  })

  test('refuses a PM who is not assigned to the job', async () => {
    db.direct_costs.push({ id: 'c3', job_id: 'J2', status: 'pending', budget_item_id: null })
    const res = await post({ action: 'approve', id: 'c3', budget_item_id: 'X1' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not assigned/)
    expect(cost('c3')).toMatchObject({ status: 'pending', budget_item_id: null })
  })

  test('refuses an unassigned APM too, but lets an admin through', async () => {
    mockAuth = { userId: 'apm9', role: 'apm', error: null }
    expect((await post({ action: 'approve', id: 'c2', budget_item_id: 'X1' })).status).toBe(403)
    mockAuth = { userId: 'admin1', role: 'admin', error: null }
    expect((await post({ action: 'approve', id: 'c2', budget_item_id: 'X1' })).status).toBe(200)
    expect(cost('c2')).toMatchObject({ status: 'approved', budget_item_id: 'X1' })
  })

  test('refuses roles outside PM/APM/admin', async () => {
    mockAuth = { userId: 'pm1', role: 'super', error: null }
    expect((await post({ action: 'approve', id: 'c1', budget_item_id: 'L1' })).status).toBe(403)
  })

  test('reports already handled when the cost is no longer pending', async () => {
    cost('c1').status = 'approved'
    const res = await post({ action: 'approve', id: 'c1', budget_item_id: 'L1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already handled.*approved/)
    expect(cost('c1').budget_item_id).toBeNull()
  })

  test('reports already handled when someone else approves or rejects it first', async () => {
    mockBeforeUpdate = table => { if (table === 'direct_costs') cost('c1').status = 'rejected' }
    const res = await post({ action: 'approve', id: 'c1', budget_item_id: 'L1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already handled.*rejected/)
    expect(cost('c1')).toMatchObject({ status: 'rejected', budget_item_id: null })
  })
})

describe('jobs.pm_email counts as on the job (no pm_job_assignments row)', () => {
  beforeEach(() => {
    mockAuth = { userId: 'pm2', email: 'Peyton@NVIM.co', role: 'pm', error: null }
    db.jobs.find(j => j.id === 'J2').pm_email = 'peyton@nvim.co'
    db.jobs.find(j => j.id === 'J1').pm_email = 'someone.else@nvim.co'
  })

  test('a PM who is pm_email on the job (any case) can approve, edit, and PUT', async () => {
    expect((await post({ action: 'approve', id: 'c2', budget_item_id: 'X1' })).status).toBe(200)
    expect(cost('c2')).toMatchObject({ status: 'approved', budget_item_id: 'X1', reviewed_by: 'pm2' })
    db.direct_costs.push({ id: 'c4', job_id: 'J2', status: 'pending', budget_item_id: null, description: 'Nails' })
    expect((await post({ action: 'edit', id: 'c4', description: 'Nails 16d' })).status).toBe(200)
    expect((await put({ id: 'c4', budget_item_id: 'X1' })).status).toBe(200)
    expect(cost('c4')).toMatchObject({ description: 'Nails 16d', budget_item_id: 'X1' })
  })

  test('an APM who is pm_email on the job counts too', async () => {
    mockAuth = { ...mockAuth, userId: 'apm2', role: 'apm' }
    expect((await post({ action: 'approve', id: 'c2', budget_item_id: 'X1' })).status).toBe(200)
  })

  test('still refuses jobs where they are neither assigned nor pm_email', async () => {
    const res = await post({ action: 'approve', id: 'c1', budget_item_id: 'L1' })
    expect(res.status).toBe(403)
    expect(cost('c1').status).toBe('pending')
  })

  test('the fallback is for PM/APM only, and needs an email', async () => {
    mockAuth = { ...mockAuth, role: 'super' }
    expect((await put({ id: 'c2', budget_item_id: 'X1' })).status).toBe(403)
    mockAuth = { userId: 'pm2', email: null, role: 'pm', error: null }
    expect((await put({ id: 'c2', budget_item_id: 'X1' })).status).toBe(403)
    expect(cost('c2').budget_item_id).toBeNull()
  })

  test('LIKE wildcards in the email do not match other addresses', async () => {
    db.jobs.find(j => j.id === 'J2').pm_email = 'peytonx@nvim.co'
    mockAuth = { userId: 'pm2', email: 'peyton_@nvim.co', role: 'pm', error: null }
    expect((await put({ id: 'c2', budget_item_id: 'X1' })).status).toBe(403)
    const json = await (await directCosts.GET(new Request('http://x/api/direct-costs?status=pending'))).json()
    // PMs are limited to their jobs, so the other job's cost is not listed at all
    expect(json.data.find(c => c.id === 'c2')).toBeUndefined()
  })

  test('the pending queue marks pm_email jobs approvable, and an APM sees them', async () => {
    let json = await (await directCosts.GET(new Request('http://x/api/direct-costs?status=pending'))).json()
    let byId = Object.fromEntries(json.data.map(c => [c.id, c]))
    expect(byId.c2).toMatchObject({ can_approve: true })
    expect(byId.c1).toBeUndefined() // PM limited to their jobs: J1 is not theirs
    mockAuth = { ...mockAuth, userId: 'apm2', role: 'apm' }
    json = await (await directCosts.GET(new Request('http://x/api/direct-costs?status=pending'))).json()
    expect(json.data.map(c => c.id)).toEqual(['c2'])
  })
})

describe('POST /api/dc-review edit', () => {
  test('rejects a line from another job', async () => {
    const res = await post({ action: 'edit', id: 'c1', budget_item_id: 'X1' })
    expect(res.status).toBe(422)
    expect(cost('c1').budget_item_id).toBeNull()
  })

  test('refuses an unassigned PM', async () => {
    const res = await post({ action: 'edit', id: 'c2', description: 'x' })
    expect(res.status).toBe(403)
    expect(cost('c2').description).toBe('Lumber')
  })

  test('saves a line from the same job', async () => {
    const res = await post({ action: 'edit', id: 'c1', budget_item_id: 'L1' })
    expect(res.status).toBe(200)
    expect(cost('c1').budget_item_id).toBe('L1')
  })
})

describe('PUT /api/direct-costs', () => {
  test('assigns a line from the same job', async () => {
    const res = await put({ id: 'c1', budget_item_id: 'L2' })
    expect(res.status).toBe(200)
    expect(cost('c1').budget_item_id).toBe('L2')
  })

  test('rejects a line from another job', async () => {
    const res = await put({ id: 'c1', budget_item_id: 'X1' })
    expect(res.status).toBe(422)
    expect(cost('c1').budget_item_id).toBeNull()
  })

  test('refuses a user not assigned to the job', async () => {
    const res = await put({ id: 'c2', budget_item_id: 'X1' })
    expect(res.status).toBe(403)
    expect(cost('c2').budget_item_id).toBeNull()
  })

  test('a job move needs access to the target job and must clear the old line', async () => {
    cost('c1').budget_item_id = 'L1'
    expect((await put({ id: 'c1', job_id: 'J2', budget_item_id: null })).status).toBe(403)
    db.pm_job_assignments.push({ id: 'a2', job_id: 'J2', user_id: 'pm1' })
    expect((await put({ id: 'c1', job_id: 'J2' })).status).toBe(422)
    expect((await put({ id: 'c1', job_id: 'J2', budget_item_id: 'L1' })).status).toBe(422)
    expect(cost('c1').job_id).toBe('J1')
    expect((await put({ id: 'c1', job_id: 'J2', budget_item_id: null })).status).toBe(200)
    expect(cost('c1')).toMatchObject({ job_id: 'J2', budget_item_id: null })
  })
})

describe('GET /api/direct-costs?status=pending', () => {
  test("returns each job's budget lines sorted by code, and which costs the user can approve", async () => {
    db.budget_items.push({ id: 'L0', job_id: 'J1', cost_code: '01-500', description: 'Temp facilities' })
    const res = await directCosts.GET(new Request('http://x/api/direct-costs?status=pending'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.budget_lines.J1.map(b => b.id)).toEqual(['L0', 'L1', 'L2'])
    // PM is limited to their jobs: J2 (not theirs) is not in the queue or the line picker
    expect(json.budget_lines.J2).toBeUndefined()
    expect(json.budget_lines.J1[0]).toEqual({ id: 'L0', cost_code: '01-500', description: 'Temp facilities' })
    const byId = Object.fromEntries(json.data.map(c => [c.id, c]))
    expect(byId.c1).toMatchObject({ can_approve: true, has_budget_line: false })
    expect(byId.c2).toBeUndefined()
  })

  test('a principal (Owner) sees every job and can approve all of them, with no assignment', async () => {
    mockAuth = { userId: 'owner1', email: 'owner@nvim.co', role: 'principal', error: null }
    const json = await (await directCosts.GET(new Request('http://x/api/direct-costs?status=pending'))).json()
    const byId = Object.fromEntries(json.data.map(c => [c.id, c]))
    expect(byId.c1).toMatchObject({ can_approve: true })
    expect(byId.c2).toMatchObject({ can_approve: true })
    expect(json.budget_lines.J2.map(b => b.id)).toEqual(['X1'])
  })
})
