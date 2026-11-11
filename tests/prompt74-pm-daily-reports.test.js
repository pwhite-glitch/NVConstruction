/**
 * Prompt 74 — PM / Owner create daily reports from the job page (commercial + residential).
 *   1. Pure: lib/daily-report-payload validate / buildDailyReportRow / buildDeliveriesFromMaterials.
 *   2. POST /api/daily-reports: requirePM + denyUnlessOnJob, super_id = caller, deliveries
 *      side-effect, duplicates allowed, no email.
 *   3. Source checks: job pages use the shared form + API; field app unchanged; no migration.
 * All DB access is the in-memory mock; nothing live, no migration applied.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: () => false,
    PM_ROLES: PM,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

const {
  WEATHER, emptyDailyForm, emptyCrewRow, validateDailyReportInput, buildDailyReportRow,
  buildDeliveriesFromMaterials, duplicateReportMessage, cleanPhotos,
} = require('../lib/daily-report-payload')

const base = (extra = {}) => ({ job_id: 'J1', report_date: '2026-11-09', work_performed: 'Framed walls', ...extra })

// ─────────────────────────────────────────────────────────────────────────────
describe('1) pure helpers', () => {
  test('WEATHER list and defaults match the field app', () => {
    expect(WEATHER).toEqual(['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Heavy Rain', 'Thunderstorm', 'Snow', 'Windy', 'Extreme Heat', 'Fog'])
    expect(emptyDailyForm('2026-11-09')).toEqual({ report_date: '2026-11-09', weather: '', weather_temp: '', weather_delay: false, crew_count: '', work_performed: '', issues: '', safety_observations: '', toolbox_talk: '' })
    expect(emptyCrewRow()).toEqual({ name: '', company: '', trade: '', hours: '' })
  })

  test('validate: requires job_id, report_date, non-blank work_performed', () => {
    expect(validateDailyReportInput(base())).toEqual({ ok: true })
    expect(validateDailyReportInput(base({ work_performed: '   ' })).ok).toBe(false)
    expect(validateDailyReportInput(base({ work_performed: undefined })).error).toMatch(/Work performed/)
    expect(validateDailyReportInput(base({ job_id: '' })).error).toMatch(/Project/)
    expect(validateDailyReportInput(base({ job_id: undefined })).ok).toBe(false)
    expect(validateDailyReportInput(base({ report_date: '' })).error).toMatch(/date/i)
    expect(validateDailyReportInput(base({ report_date: '2026-02-30' })).ok).toBe(false)
    expect(validateDailyReportInput(base({ report_date: '11/09/2026' })).ok).toBe(false)
    expect(validateDailyReportInput(null).ok).toBe(false)
    expect(validateDailyReportInput([]).ok).toBe(false)
  })

  test('validate: photos must be a list stored under this job', () => {
    expect(validateDailyReportInput(base({ photos: [{ path: 'J1/a.jpg' }] })).ok).toBe(true)
    expect(validateDailyReportInput(base({ photos: 'x' })).ok).toBe(false)
    expect(validateDailyReportInput(base({ photos: [{ path: 'J2/a.jpg' }] })).ok).toBe(false)
    expect(validateDailyReportInput(base({ photos: [{ path: 'J1/../J2/a.jpg' }] })).ok).toBe(false)
    expect(validateDailyReportInput(base({ photos: [{ caption: 'no path' }] })).ok).toBe(false)
  })

  test('buildDailyReportRow: super_id from auth, never body', () => {
    const row = buildDailyReportRow({ authUserId: 'pm1', body: base({ super_id: 'forged', created_by: 'forged' }) })
    expect(row.super_id).toBe('pm1')
    expect(row).not.toHaveProperty('created_by')
    expect(row).toMatchObject({ job_id: 'J1', report_date: '2026-11-09', work_performed: 'Framed walls', weather: null, weather_temp: null, weather_delay: false, issues: null, safety_observations: null, toolbox_talk: null, crew_log: null, equipment_log: null, materials_delivered: null, visitors: null, subcontractor_activity: null, photos: null, crew_count: null })
  })

  test('buildDailyReportRow: filters empty rows and keeps field shapes only', () => {
    const row = buildDailyReportRow({ authUserId: 'u', body: base({
      weather: 'Light Rain', weather_temp: '61', weather_delay: true, issues: 'Rain', toolbox_talk: 'Ladders', safety_observations: 'None',
      crew_log: [{ name: 'Al', company: '', trade: 'Framer', hours: '8', extra: 'x' }, { name: '', company: 'Acme', trade: '', hours: '' }, { name: '', company: '', trade: 'x', hours: '8' }, { name: '  ', company: '' }],
      equipment_log: [{ name: 'Lift', quantity: '1', hours: '4' }, { name: '', quantity: '2', hours: '' }],
      materials_delivered: [{ description: 'Studs', quantity: '200', supplier: 'Lowes' }, { description: '', quantity: '1', supplier: 'x' }],
      visitors: [{ name: 'Inspector', company: 'City', purpose: 'Framing' }, { name: '', company: 'x', purpose: 'y' }],
      subcontractor_activity: [{ subId: '', company: 'Sparky', trade: 'Elec', crew_count: '3', work_performed: 'Rough-in' }, { subId: 's9', company: 'Pipes', trade: 'Plb', crew_count: '2', work_performed: '' }, { company: '' }],
    }) })
    expect(row.crew_log).toEqual([{ name: 'Al', company: '', trade: 'Framer', hours: '8' }, { name: '', company: 'Acme', trade: '', hours: '' }])
    expect(row.equipment_log).toEqual([{ name: 'Lift', quantity: '1', hours: '4' }])
    expect(row.materials_delivered).toEqual([{ description: 'Studs', quantity: '200', supplier: 'Lowes' }])
    expect(row.visitors).toEqual([{ name: 'Inspector', company: 'City', purpose: 'Framing' }])
    expect(row.subcontractor_activity).toEqual([
      { company: 'Sparky', trade: 'Elec', crew_count: '3', work_performed: 'Rough-in' },
      { subId: 's9', company: 'Pipes', trade: 'Plb', crew_count: '2', work_performed: '' },
    ])
    expect(row).toMatchObject({ weather: 'Light Rain', weather_temp: '61', weather_delay: true, issues: 'Rain', toolbox_talk: 'Ladders', safety_observations: 'None' })
  })

  test('crew_count: typed value wins, else filled crew length, else null', () => {
    const crew = [{ name: 'A' }, { company: 'B' }, { name: '' }]
    expect(buildDailyReportRow({ authUserId: 'u', body: base({ crew_log: crew }) }).crew_count).toBe(2)
    expect(buildDailyReportRow({ authUserId: 'u', body: base({ crew_log: crew, crew_count: '7' }) }).crew_count).toBe(7)
    expect(buildDailyReportRow({ authUserId: 'u', body: base({ crew_log: crew, crew_count: '' }) }).crew_count).toBe(2)
    expect(buildDailyReportRow({ authUserId: 'u', body: base() }).crew_count).toBeNull()
  })

  test('photos pass through including internal_only true/false; missing stays missing', () => {
    const photos = [
      { path: 'J1/a.jpg', caption: '', name: 'a.jpg', internal_only: true },
      { path: 'J1/b.jpg', caption: 'b', name: 'b.jpg', internal_only: false },
      { path: 'J1/c.jpg', name: 'c.jpg', junk: 1 },
    ]
    const row = buildDailyReportRow({ authUserId: 'u', body: base({ photos }) })
    expect(row.photos).toEqual([
      { path: 'J1/a.jpg', caption: '', name: 'a.jpg', internal_only: true },
      { path: 'J1/b.jpg', caption: 'b', name: 'b.jpg', internal_only: false },
      { path: 'J1/c.jpg', name: 'c.jpg' },
    ])
    expect(cleanPhotos([{ path: 'J1/x.jpg', internal_only: 'yes' }])).toEqual([{ path: 'J1/x.jpg' }])
  })

  test('buildDeliveriesFromMaterials: field mapping', () => {
    expect(buildDeliveriesFromMaterials('J1', 'pm1', '2026-11-09', [
      { description: 'Studs', quantity: '200', supplier: 'Lowes' },
      { description: 'Nails', quantity: '', supplier: '' },
      { description: '', quantity: '5', supplier: 'x' },
    ])).toEqual([
      { job_id: 'J1', super_id: 'pm1', material: 'Studs', vendor: 'Lowes', quantity: '200', status: 'received', received_date: '2026-11-09', source: 'daily_report' },
      { job_id: 'J1', super_id: 'pm1', material: 'Nails', vendor: null, quantity: null, status: 'received', received_date: '2026-11-09', source: 'daily_report' },
    ])
    expect(buildDeliveriesFromMaterials('J1', 'u', '2026-11-09', undefined)).toEqual([])
  })

  test('duplicateReportMessage', () => {
    expect(duplicateReportMessage('2026-11-09', ['2026-11-08', '2026-11-09'])).toBe('A daily report already exists for 2026-11-09 on this job. Submit another anyway?')
    expect(duplicateReportMessage('2026-11-10', ['2026-11-09'])).toBeNull()
    expect(duplicateReportMessage('2026-11-10', undefined)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) POST /api/daily-reports', () => {
  const route = require('../app/api/daily-reports/route')
  const seed = (extra = {}) => resetMockState({
    jobs: [{ id: 'J1', pm_email: 'lead@x.com' }, { id: 'J2' }],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' }],
    daily_reports: [],
    deliveries: [],
    ...extra,
  })
  const post = body => call(route.POST, '/api/daily-reports', 'POST', body)
  const reports = () => mockState.db.daily_reports
  const writesTo = t => mockState.calls.filter(c => c.table === t)

  test('principal on any job → 200, row inserted with super_id = caller', async () => {
    seed(); as('principal')
    const r = await post(base({ job_id: 'J2' }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.report).toMatchObject({ job_id: 'J2', super_id: 'principal1', work_performed: 'Framed walls' })
    expect(reports()).toHaveLength(1)
    expect(reports()[0].super_id).toBe('principal1')
  })

  test('admin on any job → 200', async () => {
    seed(); as('admin')
    expect((await post(base({ job_id: 'J2' }))).status).toBe(200)
  })

  test('assigned pm → 200; pm via jobs.pm_email → 200', async () => {
    seed(); as('pm')
    expect((await post(base())).status).toBe(200)
    seed(); as('pm', 'pm7', 'lead@x.com')
    expect((await post(base())).status).toBe(200)
  })

  test('pm / apm NOT assigned → 403, nothing written', async () => {
    for (const [role, id] of [['pm', 'pm9'], ['apm', 'apm9']]) {
      seed(); as(role, id)
      const r = await post(base())
      expect([role, r.status]).toEqual([role, 403])
      expect(reports()).toHaveLength(0)
    }
  })

  test('assigned super → 200 (API allows; button is office-only); unassigned super → 403', async () => {
    seed(); as('super')
    expect((await post(base())).status).toBe(200)
    seed(); as('super', 'super9')
    expect((await post(base())).status).toBe(403)
  })

  test('subcontractor / owner / sub_pm → 403 via requirePM', async () => {
    for (const role of ['subcontractor', 'owner', 'sub_pm', 'metal_rep']) {
      seed(); as(role)
      const r = await post(base())
      expect([role, r.status]).toEqual([role, 403])
      expect(reports()).toHaveLength(0)
    }
  })

  test('missing work_performed / report_date / job_id → 400', async () => {
    seed(); as('principal')
    expect((await post(base({ work_performed: '  ' }))).status).toBe(400)
    expect((await post(base({ report_date: '' }))).status).toBe(400)
    expect((await post(base({ job_id: '' }))).status).toBe(400)
    expect((await post(base({ photos: [{ path: 'J2/x.jpg' }] }))).status).toBe(400)
    expect(reports()).toHaveLength(0)
  })

  test('forged body.super_id is ignored', async () => {
    seed(); as('pm')
    const r = await post(base({ super_id: 'someone-else', created_by: 'someone-else' }))
    expect(r.status).toBe(200)
    expect(reports()[0].super_id).toBe('pm1')
  })

  test('materials side-effect inserts received deliveries with source daily_report', async () => {
    seed(); as('pm')
    const r = await post(base({ materials_delivered: [{ description: 'Studs', quantity: '200', supplier: 'Lowes' }, { description: '', quantity: '1', supplier: '' }] }))
    expect(r.status).toBe(200)
    expect(mockState.db.deliveries).toHaveLength(1)
    expect(mockState.db.deliveries[0]).toMatchObject({ job_id: 'J1', super_id: 'pm1', material: 'Studs', vendor: 'Lowes', quantity: '200', status: 'received', received_date: '2026-11-09', source: 'daily_report' })
  })

  test('no materials → no deliveries write', async () => {
    seed(); as('pm')
    await post(base())
    expect(writesTo('deliveries')).toHaveLength(0)
  })

  test('deliveries failure does not undo the report (soft warning)', async () => {
    seed(); as('pm')
    mockState.failWrite = { deliveries: { insert: 'boom' } }
    const r = await post(base({ materials_delivered: [{ description: 'Studs', quantity: '1', supplier: '' }] }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.warning).toMatch(/boom/)
    expect(reports()).toHaveLength(1)
  })

  test('report insert failure → 500 with message, no deliveries', async () => {
    seed(); as('pm')
    mockState.failWrite = { daily_reports: { insert: 'db down' } }
    const r = await post(base({ materials_delivered: [{ description: 'Studs' }] }))
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/db down/)
    expect(writesTo('deliveries')).toHaveLength(0)
  })

  test('duplicate same job + date → still 200 (second row allowed)', async () => {
    seed({ daily_reports: [{ id: 'd0', job_id: 'J1', report_date: '2026-11-09', work_performed: 'earlier' }] }); as('pm')
    const r = await post(base())
    expect(r.status).toBe(200)
    expect(reports().filter(x => x.job_id === 'J1' && x.report_date === '2026-11-09')).toHaveLength(2)
  })

  test('photos with internal_only are stored on the jsonb elements; weather_delay stored', async () => {
    seed(); as('pm')
    const photos = [{ path: 'J1/1-0-abc.jpg', caption: '', name: 'a.jpg', internal_only: true }, { path: 'J1/1-1-def.jpg', caption: '', name: 'b.jpg' }]
    const r = await post(base({ photos, weather_delay: true }))
    expect(r.status).toBe(200)
    expect(reports()[0].photos).toEqual(photos)
    expect(reports()[0].weather_delay).toBe(true)
    expect(writesTo('job_photos')).toHaveLength(0)
  })

  test('invalid JSON → 400', async () => {
    seed(); as('pm')
    const res = await route.POST(new Request('http://x/api/daily-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))
    expect(res.status).toBe(400)
  })

  test('route sends no email / notify', () => {
    const src = read('app/api/daily-reports/route.js')
    expect(src).not.toMatch(/sendEmail|resend|notify\w*\(/i)
    expect(src).toMatch(/requirePM/)
    expect(src).toMatch(/denyUnlessOnJob/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) source checks', () => {
  const jd = read('app/jobdetail/page.js')
  const res = read('app/residentialjobdetail/page.js')
  const field = read('app/field/page.js')
  const form = read('app/jobdetail/DailyReportForm.js')

  test('commercial jobdetail uses the shared form for office roles', () => {
    expect(jd).toMatch(/import DailyReportForm from '\.\/DailyReportForm'/)
    expect(jd).toMatch(/New daily report/)
    expect(jd).toMatch(/<DailyReportForm[\s\S]*?existingDates=\{fieldDailyReports\.map\(r => r\.report_date\)\}/)
    expect(jd).toMatch(/\['principal', 'admin', 'pm', 'apm'\]\.includes\(userRole\)[\s\S]{0,900}New daily report/)
  })

  test('form posts to /api/daily-reports (no browser insert) and confirms duplicates', () => {
    expect(form).toMatch(/authFetch\('\/api\/daily-reports'/)
    expect(form).not.toMatch(/from\('daily_reports'\)/)
    expect(form).toMatch(/duplicateReportMessage/)
    expect(form).toMatch(/window\.confirm/)
    expect(form).toMatch(/daily-report-photos/)
    expect(form).toMatch(/internal_only/)
    expect(form).toMatch(/Internal only/)
  })

  test('residential jobdetail uses the shared form for isOffice', () => {
    expect(res).toMatch(/import DailyReportForm from '\.\.\/jobdetail\/DailyReportForm'/)
    expect(res).toMatch(/import \{ authFetch \} from '\.\.\/\.\.\/lib\/client-fetch'/)
    expect(res).toMatch(/New daily report/)
    expect(res).toMatch(/isOffice && showNewDailyReport && \(\s*<DailyReportForm/)
    expect(res).not.toMatch(/Supers file them in the field app/)
  })

  test('field app unchanged: browser insert, no new API, gate still super|apm', () => {
    expect(field).toMatch(/async function submitDailyReport[\s\S]*?supabase\.from\('daily_reports'\)\.insert\(/)
    expect(field).not.toMatch(/\/api\/daily-reports/)
    expect(field).not.toMatch(/DailyReportForm/)
    expect(field).toMatch(/prof\.role !== 'super' && prof\.role !== 'apm'/)
  })

  test('no new migration for this package', () => {
    const files = fs.readdirSync(path.join(root, 'migrations'))
    // Prompt 78 later added the only 071 (sales-docs bucket cap removal, unapplied).
    expect(files.filter(f => /^071_/.test(f))).toEqual(['071_remove_sales_docs_file_cap.sql'])
  })
})
