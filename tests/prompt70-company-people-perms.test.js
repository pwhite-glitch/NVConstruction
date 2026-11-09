/**
 * Prompt 70: Company people panel permissions.
 * - Writes to /api/company-people (job_access / can_bill, contact add/edit/remove) need
 *   canManageCompanyPeople: Owner/admin any company; PM/APM/super only a company on one
 *   of their jobs (pm_job_assignments / pm_email + job_assignments.company_id).
 * - Successful writes go to change_log via logChange; refused writes write nothing.
 * - GET returns can_manage; SubCompanyPeople gates its controls on it.
 * DB/auth are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  return {
    requirePM: async () => {
      if (!mockState.auth) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
      if (!PM.has(mockState.auth.role)) return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
      return mockState.auth
    },
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})

const { GET, POST, PATCH, DELETE } = require('../app/api/company-people/route')
const { canManageCompanyPeople } = require('../lib/company-people-access')
const { mockState: db } = require('./helpers/mock-db')

const CO_A = 'co-a' // on job-1
const CO_B = 'co-b' // on job-2 only
const req = (method, body) => new Request('http://x/api/company-people', {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body),
})
const getReq = qs => new Request(`http://x/api/company-people?${qs}`, { headers: { Authorization: 'Bearer t' } })

const OWNER = { userId: 'u-owner', email: 'owner@nv.test', role: 'principal', error: null }
const ADMIN = { userId: 'u-admin', email: 'admin@nv.test', role: 'admin', error: null }
const PM_ON = { userId: 'u-pm', email: 'pm@nv.test', role: 'pm', error: null }
const PM_OFF = { userId: 'u-pm2', email: 'pm2@nv.test', role: 'pm', error: null }
const SUPER_NONE = { userId: 'u-super', email: 'super@nv.test', role: 'super', error: null }

function seed() {
  resetMockState({
    companies: [{ id: CO_A, name: 'Acme Drywall' }, { id: CO_B, name: 'Bolt Electric' }],
    jobs: [{ id: 'job-1', pm_email: 'someone@nv.test' }, { id: 'job-2', pm_email: 'other@nv.test' }, { id: 'job-3', pm_email: null }],
    pm_job_assignments: [
      { id: 'pja-1', job_id: 'job-1', user_id: PM_ON.userId },
      { id: 'pja-2', job_id: 'job-3', user_id: PM_OFF.userId },
    ],
    job_assignments: [
      { id: 'ja-1', job_id: 'job-1', company_id: CO_A },
      { id: 'ja-2', job_id: 'job-2', company_id: CO_B },
    ],
    profiles: [
      { id: OWNER.userId, role: 'principal', full_name: 'Olive Owner' },
      { id: PM_ON.userId, role: 'pm', full_name: 'Pat PM' },
      { id: 'sub-a1', role: 'subcontractor', company_id: CO_A, job_access: 'company', can_bill: true, full_name: 'Al Sub', invite_email: 'al@acme.test' },
      { id: 'sub-b1', role: 'sub_pm', company_id: CO_B, job_access: 'company', can_bill: true, full_name: 'Bo Sub', invite_email: 'bo@bolt.test' },
      { id: 'sub-loose', role: 'subcontractor', company_id: null, job_access: 'company', can_bill: true },
    ],
    company_contacts: [
      { id: 'cc-a1', company_id: CO_A, full_name: 'Amy Contact', email: 'amy@acme.test', phone: null, title: null },
      { id: 'cc-b1', company_id: CO_B, full_name: 'Ben Contact', email: 'ben@bolt.test', phone: null, title: 'Foreman' },
    ],
    sub_directory: [],
  })
}

const writes = table => db.calls.filter(c => c.table === table)
const logs = () => writes('change_log').map(c => c.payload)

beforeEach(() => { seed(); db.auth = OWNER })

describe('canManageCompanyPeople', () => {
  const { mockState } = require('./helpers/mock-db')
  const client = require('@supabase/supabase-js').createClient()

  test('no company → 400', async () => {
    expect(await canManageCompanyPeople(client, OWNER, null)).toEqual({ ok: false, status: 400, error: 'company_id required' })
  })
  test('Owner and admin → any company', async () => {
    expect((await canManageCompanyPeople(client, OWNER, CO_B)).ok).toBe(true)
    expect((await canManageCompanyPeople(client, ADMIN, CO_B)).ok).toBe(true)
  })
  test('PM: only companies on their jobs', async () => {
    expect((await canManageCompanyPeople(client, PM_ON, CO_A)).ok).toBe(true)
    const r = await canManageCompanyPeople(client, PM_ON, CO_B)
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(r.error).toMatch(/companies on your jobs/)
  })
  test('PM via jobs.pm_email counts as on the job', async () => {
    const pmByEmail = { userId: 'u-x', email: 'Other@NV.test', role: 'apm' }
    expect((await canManageCompanyPeople(client, pmByEmail, CO_B)).ok).toBe(true)
  })
  test('super with no assignments → 403; with an assignment → ok', async () => {
    expect(await canManageCompanyPeople(client, SUPER_NONE, CO_A)).toMatchObject({ ok: false, status: 403 })
    mockState.db.pm_job_assignments.push({ id: 'pja-s', job_id: 'job-1', user_id: SUPER_NONE.userId })
    expect((await canManageCompanyPeople(client, SUPER_NONE, CO_A)).ok).toBe(true)
  })
  test('non-staff role → 403 Forbidden', async () => {
    expect(await canManageCompanyPeople(client, { userId: 's', role: 'subcontractor' }, CO_A)).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })
  test('read errors fail closed (500)', async () => {
    mockState.failSelect = { pm_job_assignments: 'boom' }
    expect(await canManageCompanyPeople(client, PM_ON, CO_A)).toMatchObject({ ok: false, status: 500 })
    mockState.failSelect = { job_assignments: 'boom2' }
    expect(await canManageCompanyPeople(client, PM_ON, CO_A)).toMatchObject({ ok: false, status: 500, error: 'boom2' })
  })
})

describe('1) Owner / admin', () => {
  test('Owner PATCH job_access on any company → 200 + change_log', async () => {
    const res = await PATCH(req('PATCH', { user_id: 'sub-b1', job_access: 'assigned' }))
    expect(res.status).toBe(200)
    expect(db.db.profiles.find(p => p.id === 'sub-b1').job_access).toBe('assigned')
    expect(logs()).toEqual([expect.objectContaining({
      job_id: null, entity_type: 'profile', entity_id: 'sub-b1', field_name: 'job_access',
      old_value: 'company', new_value: 'assigned', changed_by: OWNER.userId, changed_by_name: 'Olive Owner',
    })])
    expect(logs()[0].note).toMatch(/Bolt Electric/)
  })
  test('admin PATCH both fields → two log rows', async () => {
    db.auth = ADMIN
    const res = await PATCH(req('PATCH', { user_id: 'sub-a1', job_access: 'assigned', can_bill: false }))
    expect(res.status).toBe(200)
    expect(logs().map(l => [l.field_name, l.old_value, l.new_value])).toEqual([
      ['job_access', 'company', 'assigned'],
      ['can_bill', 'true', 'false'],
    ])
  })
  test('no-op PATCH writes no log row', async () => {
    const res = await PATCH(req('PATCH', { user_id: 'sub-a1', can_bill: true }))
    expect(res.status).toBe(200)
    expect(logs()).toHaveLength(0)
  })
  test('user not linked to a company → 400, nothing written', async () => {
    const res = await PATCH(req('PATCH', { user_id: 'sub-loose', can_bill: false }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('That user is not linked to a company.')
    expect(writes('profiles')).toHaveLength(0)
  })
  test('non-sub user still refused', async () => {
    const res = await PATCH(req('PATCH', { user_id: PM_ON.userId, can_bill: false }))
    expect(res.status).toBe(400)
    expect(writes('profiles')).toHaveLength(0)
  })
})

describe('2) PM with the company on an assigned job', () => {
  beforeEach(() => { db.auth = PM_ON })
  test('PATCH can_bill → 200 + log', async () => {
    const res = await PATCH(req('PATCH', { user_id: 'sub-a1', can_bill: false }))
    expect(res.status).toBe(200)
    expect(db.db.profiles.find(p => p.id === 'sub-a1').can_bill).toBe(false)
    expect(logs()).toEqual([expect.objectContaining({ entity_type: 'profile', field_name: 'can_bill', old_value: 'true', new_value: 'false', changed_by: PM_ON.userId })])
  })
  test('POST contact → 200 + log', async () => {
    const res = await POST(req('POST', { company_id: CO_A, full_name: ' Nina New ', email: 'Nina@Acme.test' }))
    expect(res.status).toBe(200)
    const { contact } = await res.json()
    expect(writes('company_contacts')).toHaveLength(1)
    expect(logs()).toEqual([expect.objectContaining({
      entity_type: 'company_contact', entity_id: contact.id, field_name: 'contact',
      old_value: null, new_value: 'Nina New <nina@acme.test>', note: 'Contact added — Acme Drywall',
    })])
  })
  test('PATCH contact → one log row per changed field', async () => {
    const res = await PATCH(req('PATCH', { contact_id: 'cc-a1', full_name: 'Amy Contact', phone: '555-1234', title: 'PM' }))
    expect(res.status).toBe(200)
    expect(logs().map(l => [l.entity_type, l.entity_id, l.field_name, l.old_value, l.new_value])).toEqual([
      ['company_contact', 'cc-a1', 'phone', null, '555-1234'],
      ['company_contact', 'cc-a1', 'title', null, 'PM'],
    ])
  })
  test('DELETE contact → 200 + log with old value', async () => {
    const res = await DELETE(req('DELETE', { contact_id: 'cc-a1' }))
    expect(res.status).toBe(200)
    expect(db.db.company_contacts.find(c => c.id === 'cc-a1')).toBeUndefined()
    expect(logs()).toEqual([expect.objectContaining({
      entity_type: 'company_contact', entity_id: 'cc-a1', field_name: 'contact',
      old_value: 'Amy Contact <amy@acme.test>', new_value: null, note: 'Contact removed — Acme Drywall',
    })])
  })
})

describe('3) PM whose jobs do not include the company', () => {
  beforeEach(() => { db.auth = PM_OFF })
  test('PATCH job_access → 403, nothing written, no log', async () => {
    const res = await PATCH(req('PATCH', { user_id: 'sub-a1', job_access: 'assigned' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/companies on your jobs/)
    expect(db.db.profiles.find(p => p.id === 'sub-a1').job_access).toBe('company')
    expect(writes('profiles')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
  test('PM_ON is also refused for a company only on someone else\'s job', async () => {
    db.auth = PM_ON
    const res = await PATCH(req('PATCH', { user_id: 'sub-b1', can_bill: false }))
    expect(res.status).toBe(403)
    expect(writes('profiles')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
})

describe('4) Super with no pm_job_assignments', () => {
  test('PATCH → 403 even though requirePM passes', async () => {
    db.auth = SUPER_NONE
    const res = await PATCH(req('PATCH', { user_id: 'sub-a1', can_bill: false }))
    expect(res.status).toBe(403)
    expect(writes('profiles')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
})

describe('5) Contact PATCH / DELETE', () => {
  beforeEach(() => { db.auth = PM_ON })
  test('contact of an unmanaged company → 403, untouched', async () => {
    const p = await PATCH(req('PATCH', { contact_id: 'cc-b1', title: 'Boss' }))
    expect(p.status).toBe(403)
    const d = await DELETE(req('DELETE', { contact_id: 'cc-b1' }))
    expect(d.status).toBe(403)
    expect(db.db.company_contacts.find(c => c.id === 'cc-b1')).toMatchObject({ title: 'Foreman' })
    expect(writes('company_contacts')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
  test('unknown contact_id → 404', async () => {
    expect((await PATCH(req('PATCH', { contact_id: 'nope', title: 'X' }))).status).toBe(404)
    expect((await DELETE(req('DELETE', { contact_id: 'nope' }))).status).toBe(404)
    expect(writes('company_contacts')).toHaveLength(0)
  })
  test('contact read error fails closed', async () => {
    db.failSelect = { company_contacts: 'down' }
    expect((await DELETE(req('DELETE', { contact_id: 'cc-a1' }))).status).toBe(500)
    expect(writes('company_contacts')).toHaveLength(0)
  })
})

describe('6) POST without manage rights', () => {
  test('→ 403, no insert, no log', async () => {
    db.auth = SUPER_NONE
    const res = await POST(req('POST', { company_id: CO_A, full_name: 'Zed' }))
    expect(res.status).toBe(403)
    expect(writes('company_contacts')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
  test('assignment read error → 500, no insert', async () => {
    db.auth = PM_ON
    db.failSelect = { job_assignments: 'down' }
    const res = await POST(req('POST', { company_id: CO_A, full_name: 'Zed' }))
    expect(res.status).toBe(500)
    expect(writes('company_contacts')).toHaveLength(0)
  })
})

describe('7) GET can_manage', () => {
  test('Owner → true', async () => {
    const res = await GET(getReq(`company_id=${CO_B}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.company.id).toBe(CO_B)
    expect(body.can_manage).toBe(true)
  })
  test('limited PM → false for an off-job company, true for their own; still readable', async () => {
    db.auth = PM_ON
    const off = await (await GET(getReq(`company_id=${CO_B}`))).json()
    expect(off.can_manage).toBe(false)
    expect(off.people.length).toBeGreaterThan(0)
    const on = await (await GET(getReq(`company_id=${CO_A}`))).json()
    expect(on.can_manage).toBe(true)
  })
  test('unresolved company → false', async () => {
    const body = await (await GET(getReq('company_name=Nobody%20Inc'))).json()
    expect(body.can_manage).toBe(false)
  })
})

describe('8) Source checks', () => {
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  test('SubCompanyPeople gates canEdit on data.can_manage', () => {
    expect(read('app/components/SubCompanyPeople.js')).toMatch(/const canEdit = !!company\?\.id && !!data\.can_manage/)
  })
  test('route imports logChange and canManageCompanyPeople', () => {
    const src = read('app/api/company-people/route.js')
    expect(src).toMatch(/import \{ logChange \} from '..\/..\/..\/lib\/change-log'/)
    expect(src).toMatch(/import \{ canManageCompanyPeople \} from '..\/..\/..\/lib\/company-people-access'/)
  })
})

// Review follow-up (MEDIUM): "company is on my job" uses the same rule as lib/sub-access.js
// (getCompanyPeople's job.on_job): company_id row, a row for one of its people, or a
// non-draft subcontract — not only job_assignments.company_id.
describe('9) Company on the job by the sub-access rule', () => {
  const CO_C = 'co-c' // no company_id row anywhere
  const addCoC = () => {
    db.db.companies.push({ id: CO_C, name: 'Cobalt Roofing' })
    db.db.profiles.push({ id: 'sub-c1', role: 'subcontractor', company_id: CO_C, job_access: 'company', can_bill: true, full_name: 'Cy Sub', invite_email: 'cy@cobalt.test' })
    db.db.subcontracts = db.db.subcontracts || []
  }
  const canPm = async () => (await (await GET(getReq(`company_id=${CO_C}&job_id=job-1`))).json())
  beforeEach(() => { addCoC() })

  test('subcontract-only company: assigned PM can_manage=true and can PATCH; PM not on the job → 403', async () => {
    db.db.subcontracts.push({ id: 'sc-c', job_id: 'job-1', company_id: CO_C, status: 'active', contract_value: 1000 })
    db.auth = PM_ON
    const g = await canPm()
    expect(g.job.on_job).toBe(true)
    expect(g.can_manage).toBe(true)
    expect((await PATCH(req('PATCH', { user_id: 'sub-c1', can_bill: false }))).status).toBe(200)
    db.auth = PM_OFF
    const r = await PATCH(req('PATCH', { user_id: 'sub-c1', can_bill: true }))
    expect(r.status).toBe(403)
    expect((await GET(getReq(`company_id=${CO_C}`))).status).toBe(200)
    expect((await (await GET(getReq(`company_id=${CO_C}`))).json()).can_manage).toBe(false)
  })
  test('subcontract with null status counts; draft-only does not', async () => {
    db.db.subcontracts.push({ id: 'sc-d', job_id: 'job-1', company_id: CO_C, status: 'draft' })
    expect(await canManageCompanyPeople(require('@supabase/supabase-js').createClient(), PM_ON, CO_C)).toMatchObject({ ok: false, status: 403 })
    db.db.subcontracts.push({ id: 'sc-n', job_id: 'job-1', company_id: CO_C, status: null })
    expect((await canManageCompanyPeople(require('@supabase/supabase-js').createClient(), PM_ON, CO_C)).ok).toBe(true)
  })
  test('legacy person-only row (sub_id, company_id null): assigned PM can_manage=true; PM not on the job → 403', async () => {
    db.db.job_assignments.push({ id: 'ja-c', job_id: 'job-1', sub_id: 'sub-c1', sub_email: null, company_id: null })
    db.auth = PM_ON
    const g = await canPm()
    expect(g.job.on_job).toBe(true)
    expect(g.can_manage).toBe(true)
    const post = await POST(req('POST', { company_id: CO_C, full_name: 'New Person' }))
    expect(post.status).toBe(200)
    db.auth = PM_OFF
    expect((await POST(req('POST', { company_id: CO_C, full_name: 'Nope' }))).status).toBe(403)
    expect((await PATCH(req('PATCH', { user_id: 'sub-c1', job_access: 'assigned' }))).status).toBe(403)
  })
  test('legacy row by sub_email only (matches a member invite_email)', async () => {
    db.db.job_assignments.push({ id: 'ja-e', job_id: 'job-1', sub_id: null, sub_email: 'cy@cobalt.test', company_id: null })
    const client = require('@supabase/supabase-js').createClient()
    expect((await canManageCompanyPeople(client, PM_ON, CO_C)).ok).toBe(true)
    expect(await canManageCompanyPeople(client, PM_OFF, CO_C)).toMatchObject({ ok: false, status: 403 })
  })
  test('rows/contracts on someone else\'s job do not count', async () => {
    db.db.subcontracts.push({ id: 'sc-x', job_id: 'job-2', company_id: CO_C, status: 'active' })
    db.db.job_assignments.push({ id: 'ja-x', job_id: 'job-2', sub_id: 'sub-c1', company_id: null })
    expect(await canManageCompanyPeople(require('@supabase/supabase-js').createClient(), PM_ON, CO_C)).toMatchObject({ ok: false, status: 403 })
  })
  test('subcontracts / profiles read errors fail closed (500, no write)', async () => {
    db.db.job_assignments.push({ id: 'ja-c', job_id: 'job-1', sub_id: 'sub-c1', company_id: null })
    db.auth = PM_ON
    db.failSelect = { subcontracts: 'sc boom' }
    let r = await POST(req('POST', { company_id: CO_C, full_name: 'X' }))
    expect(r.status).toBe(500)
    db.failSelect = { profiles: 'prof boom' }
    r = await canManageCompanyPeople(require('@supabase/supabase-js').createClient(), PM_ON, CO_C)
    expect(r).toMatchObject({ ok: false, status: 500, error: 'prof boom' })
    expect(writes('company_contacts')).toHaveLength(0)
    expect(logs()).toHaveLength(0)
  })
})

// Review follow-up (LOW): PATCH user_id authorizes before saying whether the id is a sub user.
describe('10) PATCH user_id authorizes before role / company messages', () => {
  test('out-of-scope PM gets 403 (not "Not a subcontractor user") for a non-sub profile with a company', async () => {
    db.db.profiles.push({ id: 'staff-b', role: 'pm', company_id: CO_B })
    db.auth = PM_ON
    const r = await PATCH(req('PATCH', { user_id: 'staff-b', can_bill: false }))
    expect(r.status).toBe(403)
    db.auth = OWNER
    const o = await PATCH(req('PATCH', { user_id: 'staff-b', can_bill: false }))
    expect(o.status).toBe(400)
    expect((await o.json()).error).toBe('Not a subcontractor user')
    expect(writes('profiles')).toHaveLength(0)
  })
})
