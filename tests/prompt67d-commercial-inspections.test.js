/**
 * Prompt 67D #9 — commercial inspection log. In-memory DB only (tests/helpers/mock-db.js):
 * nothing real is read, written or migrated. lib/roles runs for real against the mock DB
 * (pm_job_assignments), like tests/prompt61-residential.test.js.
 *  - /api/res-inspections works on commercial jobs with the same role / job checks
 *  - lookahead_activity_id must be an activity on the same job; a linked inspection with a
 *    scheduled date marks the activity inspection_scheduled
 *  - before migration 064 (agency / lookahead_activity_id missing) everything still works
 *  - lib: inspectionTypesFor, agency trimming; page wiring (field + commercial job page)
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
    requireAuth: async () => mockState.auth,
    requirePM: async () => (mockState.auth.error ? mockState.auth : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const route = require('../app/api/res-inspections/route')
const lib = require('../lib/res-inspections')

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const req = (method, url, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.test`, role, error: null } }
const call = (m, url, body) => route[m](req(m, url, body))
const json = async r => ({ status: r.status, body: await r.json() })
const URL_ = '/api/res-inspections'

function seed() {
  resetMockState({
    jobs: [
      { id: 'CJ', job_type: 'commercial', pm_email: null },
      { id: 'CJ2', job_type: 'commercial', pm_email: null },
      { id: 'RJ', job_type: 'residential', pm_email: null },
    ],
    pm_job_assignments: [
      { id: 'a1', job_id: 'CJ', user_id: 'u-pm' },
      { id: 'a2', job_id: 'CJ', user_id: 'u-super' },
      { id: 'a3', job_id: 'RJ', user_id: 'u-pm' },
    ],
    res_inspections: [
      { id: 'c1', job_id: 'CJ', inspection_type: 'Fire Alarm', scheduled_date: '2026-11-20', result: 'pending', inspector_name: null, notes: null, actual_date: null, agency: 'Fire Marshal', lookahead_activity_id: null },
      { id: 'c2', job_id: 'CJ2', inspection_type: 'Framing', scheduled_date: null, result: 'pending' },
      { id: 'r1', job_id: 'RJ', inspection_type: 'Framing', scheduled_date: '2026-11-10', result: 'pending' },
    ],
    lookaheads: [{ id: 'la1', job_id: 'CJ' }, { id: 'la2', job_id: 'CJ2' }],
    lookahead_activities: [
      { id: 'act1', lookahead_id: 'la1', description: 'Pour slab', inspection_required: true, inspection_scheduled: false },
      { id: 'act2', lookahead_id: 'la2', description: 'Other job', inspection_required: true, inspection_scheduled: false },
    ],
  })
}
beforeEach(seed)

describe('route: commercial jobs', () => {
  test('PM on the job: GET / POST / PATCH 200 on a commercial job', async () => {
    as('pm')
    const list = await json(await call('GET', `${URL_}?job_id=CJ`))
    expect(list.status).toBe(200)
    expect(list.body.inspections.map(i => i.id)).toEqual(['c1'])
    expect(list.body.inspections[0].agency).toBe('Fire Marshal')
    expect(list.body.has064).toBe(true)
    const created = await json(await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Hood / Suppression', scheduled_date: '2026-11-25', agency: '  Health Dept  ' }))
    expect(created.status).toBe(200)
    expect(created.body.inspection).toMatchObject({ job_id: 'CJ', inspection_type: 'Hood / Suppression', result: 'pending', agency: 'Health Dept' })
    const patched = await call('PATCH', URL_, { id: 'c1', result: 'failed', actual_date: '2026-11-20' })
    expect(patched.status).toBe(200)
    expect(mockState.db.res_inspections.find(i => i.id === 'c1')).toMatchObject({ result: 'failed', actual_date: '2026-11-20' })
  })

  test.each(['subcontractor', 'sub_pm', 'owner', 'owner_rep'])('%s still 403 on a commercial job, nothing written', async role => {
    as(role)
    expect((await call('GET', `${URL_}?job_id=CJ`)).status).toBe(403)
    expect((await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Framing' })).status).toBe(403)
    expect((await call('PATCH', URL_, { id: 'c1', result: 'passed' })).status).toBe(403)
    expect((await call('DELETE', URL_, { id: 'c1' })).status).toBe(403)
    expect(mockState.calls.filter(c => c.table === 'res_inspections')).toHaveLength(0)
  })

  test('PM not on the job: 403 (read and write)', async () => {
    as('pm')
    expect((await call('GET', `${URL_}?job_id=CJ2`)).status).toBe(403)
    expect((await call('POST', URL_, { job_id: 'CJ2', inspection_type: 'Framing' })).status).toBe(403)
    expect((await call('PATCH', URL_, { id: 'c2', result: 'passed' })).status).toBe(403)
    expect(mockState.db.res_inspections.find(i => i.id === 'c2').result).toBe('pending')
  })

  test('super still needs an assignment', async () => {
    as('super')
    expect((await call('GET', `${URL_}?job_id=CJ`)).status).toBe(200)
    expect((await call('GET', `${URL_}?job_id=CJ2`)).status).toBe(403)
    expect((await call('POST', URL_, { job_id: 'CJ2', inspection_type: 'Framing' })).status).toBe(403)
    expect((await call('DELETE', URL_, { id: 'c1' })).status).toBe(403) // delete: Owner / PM only
  })

  test('residential unchanged: assigned PM 200, unknown job 404, delete by PM on the job', async () => {
    as('pm')
    expect((await call('GET', `${URL_}?job_id=RJ`)).status).toBe(200)
    expect((await call('GET', `${URL_}?job_id=NOPE`)).status).toBe(403)
    as('principal')
    expect((await call('GET', `${URL_}?job_id=NOPE`)).status).toBe(404)
    as('pm')
    expect((await call('DELETE', URL_, { id: 'r1' })).status).toBe(200)
    expect(mockState.db.res_inspections.map(i => i.id)).not.toContain('r1')
  })
})

describe('route: lookahead link', () => {
  test('activity from another job → 400, nothing written', async () => {
    as('pm')
    const r = await json(await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Footing / Slab', lookahead_activity_id: 'act2', scheduled_date: '2026-11-21' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/not on this job/)
    expect((await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Footing / Slab', lookahead_activity_id: 'missing' })).status).toBe(400)
    expect((await call('PATCH', URL_, { id: 'c1', lookahead_activity_id: 'act2' })).status).toBe(400)
    expect(mockState.calls.filter(c => c.table === 'res_inspections' || c.table === 'lookahead_activities')).toHaveLength(0)
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act2').inspection_scheduled).toBe(false)
  })

  test('linked inspection with a scheduled date sets inspection_scheduled (same job)', async () => {
    as('pm')
    const r = await json(await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Footing / Slab', lookahead_activity_id: 'act1', scheduled_date: '2026-11-21' }))
    expect(r.status).toBe(200)
    expect(r.body.inspection.lookahead_activity_id).toBe('act1')
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act1').inspection_scheduled).toBe(true)
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act2').inspection_scheduled).toBe(false)
  })

  test('linked without a date: not marked; PATCH adding a date marks it; never cleared', async () => {
    as('pm')
    const r = await json(await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Footing / Slab', lookahead_activity_id: 'act1' }))
    expect(r.status).toBe(200)
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act1').inspection_scheduled).toBe(false)
    expect((await call('PATCH', URL_, { id: r.body.inspection.id, scheduled_date: '2026-11-22' })).status).toBe(200)
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act1').inspection_scheduled).toBe(true)
    expect((await call('PATCH', URL_, { id: r.body.inspection.id, scheduled_date: null })).status).toBe(200)
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act1').inspection_scheduled).toBe(true)
  })

  test('stored row linked to another job\'s activity (written outside the API): PATCH with a date does not flip it', async () => {
    as('pm')
    mockState.db.res_inspections.push({ id: 'cx', job_id: 'CJ', inspection_type: 'Framing', scheduled_date: null, result: 'pending', agency: null, lookahead_activity_id: 'act2' })
    const r = await json(await call('PATCH', URL_, { id: 'cx', scheduled_date: '2026-11-23' }))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    expect(r.body.inspection.scheduled_date).toBe('2026-11-23')
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act2').inspection_scheduled).toBe(false)
    expect(mockState.calls.filter(c => c.table === 'lookahead_activities' && c.op === 'update')).toHaveLength(0)
  })
})

describe('route: before migration 064', () => {
  beforeEach(() => {
    for (const row of mockState.db.res_inspections) { delete row.agency; delete row.lookahead_activity_id }
    mockState.missingCols = { res_inspections: ['agency', 'lookahead_activity_id'] }
    mockState.missingSelectCols = { res_inspections: ['agency', 'lookahead_activity_id'] }
  })

  test('GET / POST / PATCH still work without the new columns (has064 false, no 500)', async () => {
    as('pm')
    const list = await json(await call('GET', `${URL_}?job_id=CJ`))
    expect(list.status).toBe(200)
    expect(list.body.has064).toBe(false)
    expect(list.body.inspections[0]).toMatchObject({ id: 'c1', agency: null })
    const created = await json(await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Fire Sprinkler', agency: 'City', lookahead_activity_id: 'act1', scheduled_date: '2026-11-21' }))
    expect(created.status).toBe(200)
    expect(created.body.has064).toBe(false)
    const ins = mockState.calls.filter(c => c.table === 'res_inspections' && c.op === 'insert')
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).not.toHaveProperty('agency')
    expect(ins[0].payload).not.toHaveProperty('lookahead_activity_id')
    expect(mockState.db.lookahead_activities.find(a => a.id === 'act1').inspection_scheduled).toBe(false)
    expect((await call('PATCH', URL_, { id: 'c1', result: 'passed', actual_date: '2026-11-20', agency: 'X' })).status).toBe(200)
    expect(mockState.db.res_inspections.find(i => i.id === 'c1')).toMatchObject({ result: 'passed' })
    expect(mockState.db.res_inspections.find(i => i.id === 'c1')).not.toHaveProperty('agency')
    // only a 064 field → nothing to write, still not a 500
    expect((await call('PATCH', URL_, { id: 'c1', agency: 'X' })).status).toBe(200)
  })

  test('only missing on write (select ok) → insert retried without the 064 fields', async () => {
    mockState.missingSelectCols = {}
    as('pm')
    const r = await call('POST', URL_, { job_id: 'CJ', inspection_type: 'Fire Sprinkler', agency: 'City' })
    expect(r.status).toBe(200)
  })
})

describe('lib/res-inspections', () => {
  test('inspectionTypesFor: residential keeps the house list, anything else commercial', () => {
    expect(lib.inspectionTypesFor({ job_type: 'Residential ' })).toBe(lib.INSPECTION_TYPES)
    expect(lib.inspectionTypesFor('residential')).toBe(lib.INSPECTION_TYPES)
    expect(lib.inspectionTypesFor({ job_type: 'commercial' })).toBe(lib.COMMERCIAL_INSPECTION_TYPES)
    expect(lib.inspectionTypesFor(null)).toBe(lib.COMMERCIAL_INSPECTION_TYPES)
    expect(lib.COMMERCIAL_INSPECTION_TYPES).toEqual(['Underground Plumbing', 'Footing / Slab', 'Framing', 'Above-Ceiling / MEP Rough', 'Fire Sprinkler', 'Fire Alarm', 'Hood / Suppression', 'Health Department', 'Fire Marshal Final', 'Building Final / CO'])
    expect(lib.INSPECTION_TYPES[0]).toBe('Foundation')
  })
  test('agency is trimmed, capped at 200, blank → null; link validated', () => {
    expect(lib.inspectionFields({ agency: '  City of Baton Rouge  ' }).fields.agency).toBe('City of Baton Rouge')
    expect(lib.inspectionFields({ agency: 'x'.repeat(250) }).fields.agency).toHaveLength(200)
    expect(lib.inspectionFields({ agency: '   ' }).fields.agency).toBeNull()
    expect(lib.inspectionFields({ lookahead_activity_id: '' }).fields.lookahead_activity_id).toBeNull()
    expect(lib.inspectionFields({ lookahead_activity_id: "x'; drop" }).error).toBeTruthy()
    expect(lib.INSPECTION_SELECT).toContain('agency')
    expect(lib.INSPECTION_SELECT_PRE064).not.toContain('agency')
  })
  test('isMissing064Column only for the 064 columns', () => {
    expect(lib.isMissing064Column({ code: '42703', message: 'column res_inspections.agency does not exist' })).toBe(true)
    expect(lib.isMissing064Column({ code: 'PGRST204', message: "Could not find the 'lookahead_activity_id' column of 'res_inspections' in the schema cache" })).toBe(true)
    expect(lib.isMissing064Column({ code: '42703', message: 'column res_inspections.notes does not exist' })).toBe(false)
    expect(lib.isMissing064Column(null)).toBe(false)
  })
})

describe('page wiring (source)', () => {
  test('field app: tile and tab no longer gated by isResidentialJob; job type passed', () => {
    const field = read('app/field/page.js')
    expect(field).not.toMatch(/isResidentialJob\(selectedJob\) \? \[\{ key: 'inspections'/)
    expect(field).not.toMatch(/activeTab === 'inspections' && isResidentialJob/)
    expect(field).toMatch(/\{ key: 'inspections', icon: IC\.punch, label: 'Inspections'/)
    expect(field).toMatch(/<FieldInspections jobId=\{selectedJobId\} jobType=\{selectedJob\?\.job_type\}/)
    const comp = read('app/field/FieldInspections.js')
    expect(comp).toContain('inspectionTypesFor(jobType)')
    expect(comp).toMatch(/Other…/)
    expect(comp).toMatch(/\{has064 && \(/) // Agency only when 064 is applied
    expect(comp).toMatch(/call\('\/api\/punch-list', 'POST'/)
  })
  test('commercial job page: Inspections tab in the list, shared component, lookahead link', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).toMatch(/\{ key: 'inspections', label: 'Inspections', badge: jobInspections\.filter\(i => \(i\.result \|\| 'pending'\) === 'pending'\)\.length \|\| null \}/)
    expect(page).toContain("import FieldInspections from '../field/FieldInspections'")
    expect(page).toMatch(/activeTab === 'inspections' && \(/)
    expect(page).toContain('canDelete={atLeastPM(userRole)}')
    expect(page).toMatch(/act\.inspection_required && inspections064 && <button onClick=\{\(\) => logInspectionForActivity\(act\)\}/)
    const fn = page.slice(page.indexOf('function logInspectionForActivity'), page.indexOf('function logInspectionForActivity') + 400)
    expect(fn).toContain('lookahead_activity_id: act.id')
    expect(fn).toContain('act.description')
    const { COMMERCIAL_TABS, mapJobTab } = require('../lib/job-links')
    expect(COMMERCIAL_TABS).toContain('inspections')
    expect(mapJobTab('inspections', true)).toBe('inspections')
  })
  test('migration 064 is idempotent and only adds the two columns + indexes', () => {
    const sql = read('migrations/064_job_inspections_commercial.sql')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS agency text/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lookahead_activity_id uuid\s+REFERENCES public\.lookahead_activities\(id\) ON DELETE SET NULL/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS res_inspections_job_scheduled_idx\s+ON public\.res_inspections \(job_id, scheduled_date\)/)
    expect(sql).toMatch(/COMMENT ON TABLE public\.res_inspections/)
    expect(sql).toMatch(/-- ROLLBACK/)
    expect(sql).not.toMatch(/^\s*(DROP|CREATE) POLICY/m)
  })
})
