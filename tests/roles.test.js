/**
 * Owner role ('principal', UI "Owner") and per-job limiting for PM/APM.
 * lib/roles.js is the one place for labels, role predicates and "which jobs can this user see".
 */

let db
let mockAuth

function mockQuery(table) {
  const filters = []
  let lim = null
  let pendingUpsert = null
  const match = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (pendingUpsert) { (db[table] = db[table] || []).push(pendingUpsert); return { data: null, error: null } }
    let out = match()
    if (lim != null) out = out.slice(0, lim)
    return { data: out, error: null }
  }
  const q = {
    select: () => q,
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
    upsert: row => { pendingUpsert = row; return q },
    maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))
jest.mock('../lib/server-auth', () => {
  const PM_ROLES = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockAuth,
    requirePM: async () => (PM_ROLES.has(mockAuth.role) ? mockAuth : forbid()),
    isPM: role => PM_ROLES.has(role),
  }
})

const roles = require('../lib/roles')
const { PM_ROLES } = jest.requireActual('../lib/server-auth')
const { DC_APPROVER_ROLES } = require('../lib/direct-cost-queue')
const { JOB_LINK_ROLES } = require('../lib/estimate-to-job')
const changeLog = require('../app/api/change-log/route')
const rolePerms = require('../app/api/role-permissions/route')

function seed() {
  db = {
    jobs: [
      { id: 'J1', pm_email: null },
      { id: 'J2', pm_email: 'Landon.Moore@NVIM.co' },
      { id: 'J3', pm_email: 'someone@nvim.co' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'apm1' }],
    change_log: [{ id: 'l1', job_id: 'J3', created_at: '2026-11-01' }],
    role_permissions: [],
  }
}
beforeEach(seed)

const user = (role, userId, email = null) => ({ role, userId, email, error: null })

describe('role predicates and labels', () => {
  test('principal shows as "Owner" with its own pill color; client owner stays separate', () => {
    expect(roles.roleLabel('principal')).toBe('Owner')
    expect(roles.roleLabel('owner')).toBe('Client Owner')
    expect(roles.roleLabel('pm')).toBe('PM')
    const pills = Object.keys(roles.ROLE_PILL_COLORS).filter(r => r !== 'principal').map(r => roles.rolePill(r).color)
    expect(pills).not.toContain(roles.rolePill('principal').color)
    expect(roles.rolePill('nobody')).toEqual(roles.rolePill('admin')) // default pill
  })

  test('isPrincipal / atLeastPM / seesAllJobs / isJobLimited', () => {
    expect(['principal', 'pm', 'apm', 'admin', 'super', 'owner'].filter(roles.isPrincipal)).toEqual(['principal'])
    expect(['principal', 'pm', 'apm', 'admin', 'super', 'owner'].filter(roles.atLeastPM)).toEqual(['principal', 'pm'])
    expect(['principal', 'pm', 'apm', 'admin', 'super', 'owner'].filter(roles.seesAllJobs)).toEqual(['principal', 'admin'])
    expect(['principal', 'pm', 'apm', 'admin', 'super', 'owner'].filter(roles.isJobLimited)).toEqual(['pm', 'apm'])
  })

  test('principal goes where pm goes; the client owner still goes to /owner', () => {
    expect(roles.homePathForRole('principal')).toBe(roles.homePathForRole('pm'))
    expect(roles.homePathForRole('principal')).toBe('/dashboard')
    expect(roles.homePathForRole('owner')).toBe('/owner')
  })

  test('principal is in PM_ROLES, DC_APPROVER_ROLES and JOB_LINK_ROLES', () => {
    expect(PM_ROLES.has('principal')).toBe(true)
    expect(DC_APPROVER_ROLES.has('principal')).toBe(true)
    expect(JOB_LINK_ROLES.has('principal')).toBe(true)
    expect(PM_ROLES.has('owner')).toBe(false) // client owner is not staff
  })
})

describe('job access helper', () => {
  const client = { from: table => mockQuery(table) }

  test('principal and admin get every job, with no assignment', async () => {
    for (const role of ['principal', 'admin']) {
      expect(await roles.accessibleJobIds(client, user(role, 'x'))).toEqual({ ids: null })
      for (const j of ['J1', 'J2', 'J3']) expect(await roles.isOnJob(client, user(role, 'x'), j)).toEqual({ ok: true })
      expect(await roles.jobAccessError(client, user(role, 'x'), 'J3')).toBeNull()
    }
  })

  test('pm: assignment OR pm_email in any letter case; nothing else', async () => {
    const pm = user('pm', 'pm1', 'landon.moore@nvim.CO')
    const { ids } = await roles.accessibleJobIds(client, pm)
    expect([...ids].sort()).toEqual(['J1', 'J2'])
    expect((await roles.isOnJob(client, pm, 'J1')).ok).toBe(true) // assignment
    expect((await roles.isOnJob(client, pm, 'J2')).ok).toBe(true) // pm_email, different case
    expect((await roles.isOnJob(client, pm, 'J3')).ok).toBe(false)
    expect(await roles.jobAccessError(client, pm, 'J3')).toEqual({ status: 403, error: roles.NOT_ASSIGNED_MESSAGE })
  })

  test('a pm with neither an assignment nor pm_email is denied everywhere', async () => {
    const pm = user('pm', 'pm9', 'nobody@nvim.co')
    expect([...(await roles.accessibleJobIds(client, pm)).ids]).toEqual([])
    for (const j of ['J1', 'J2', 'J3']) expect((await roles.jobAccessError(client, pm, j))?.status).toBe(403)
  })

  test('apm is limited the same way', async () => {
    const apm = user('apm', 'apm1', 'LANDON.MOORE@nvim.co')
    expect([...(await roles.accessibleJobIds(client, apm)).ids].sort()).toEqual(['J1', 'J2'])
    expect((await roles.jobAccessError(client, apm, 'J3'))?.status).toBe(403)
    const lonely = user('apm', 'apm9', 'x@nvim.co')
    expect((await roles.jobAccessError(client, lonely, 'J1'))?.status).toBe(403)
  })

  test('pm_email match is exact (LIKE wildcards in the email do not match)', async () => {
    db.jobs.push({ id: 'J4', pm_email: 'peytonx@nvim.co' })
    const pm = user('pm', 'pm9', 'peyton_@nvim.co')
    expect((await roles.isOnJob(client, pm, 'J4')).ok).toBe(false)
    expect((await roles.accessibleJobIds(client, pm)).ids.has('J4')).toBe(false)
  })

  test('the generic guard only limits pm/apm (super keeps its current behaviour)', async () => {
    expect(await roles.jobAccessError(client, user('super', 's1'), 'J3')).toBeNull()
  })

  test('denyJobs requires every job; denyJobOf looks up the row\'s job', async () => {
    const pm = user('pm', 'pm1', 'landon.moore@nvim.co')
    expect(await roles.denyJobs(client, pm, ['J1', 'J2'])).toBeNull()
    expect((await roles.denyJobs(client, pm, ['J1', 'J3'])).status).toBe(403)
    expect((await roles.denyJobOf(client, pm, 'change_log', 'l1')).status).toBe(403)
    expect((await roles.denyJobOf(client, pm, 'change_log', 'missing')).status).toBe(404)
    expect(await roles.denyJobOf(client, user('principal', 'o1'), 'change_log', 'l1')).toBeNull()
  })
})

describe('a guarded route: GET /api/change-log', () => {
  const get = jobId => changeLog.GET(new Request(`http://x/api/change-log?job_id=${jobId}`))

  test('403 for a pm who is not on the job', async () => {
    mockAuth = user('pm', 'pm1', 'landon.moore@nvim.co')
    const res = await get('J3')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(roles.NOT_ASSIGNED_MESSAGE)
  })

  test('200 for a principal with no assignment', async () => {
    mockAuth = user('principal', 'owner1', 'owner@nvim.co')
    const res = await get('J3')
    expect(res.status).toBe(200)
    expect((await res.json()).log.map(l => l.id)).toEqual(['l1'])
  })

  test('200 for the pm on the job (pm_email)', async () => {
    db.change_log.push({ id: 'l2', job_id: 'J2' })
    mockAuth = user('pm', 'pm1', 'landon.moore@nvim.co')
    expect((await get('J2')).status).toBe(200)
  })
})

describe('owner-only: /api/role-permissions edits', () => {
  const patch = () => rolePerms.PATCH(new Request('http://x/api/role-permissions', {
    method: 'PATCH', body: JSON.stringify({ role: 'apm', feature_key: 'tab.bd', enabled: true }),
  }))

  test.each(['pm', 'apm', 'admin', 'super'])('%s cannot edit permissions', async role => {
    mockAuth = user(role, 'u1')
    const res = await patch()
    expect(res.status).toBe(403)
    expect(db.role_permissions).toEqual([])
  })

  test('principal can edit permissions', async () => {
    mockAuth = user('principal', 'owner1')
    const res = await patch()
    expect(res.status).toBe(200)
    expect(db.role_permissions).toEqual([expect.objectContaining({ role: 'apm', feature_key: 'tab.bd', enabled: true, updated_by: 'owner1' })])
  })

  test('principal can read its own feature list (no rows needed)', async () => {
    mockAuth = user('principal', 'owner1')
    const res = await rolePerms.GET(new Request('http://x/api/role-permissions?role=principal'))
    expect(res.status).toBe(200)
  })
})
