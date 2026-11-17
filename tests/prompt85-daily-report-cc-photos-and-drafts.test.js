/**
 * Prompt 85 — Daily reports: pick existing job photos (CompanyCam + gallery) and drafts
 * until "Finalize – 100% complete". Peyton's decisions (11/16) apply:
 *   1. Drafts visible to author + Owner / admin / PM; excluded from owner portal, owner
 *      photos, weather-day counts / log.   2. Owner / admin / PM can reopen a final report
 *      (prompt 89: a Super too, on an assigned job, only a report they wrote).
 *   3. Office reports use the same Save draft / Finalize flow.   4. Picker lists ALL job
 *      photos with a CompanyCam filter; attach by reference; unlink never deletes files.
 * All DB access is the in-memory mock; nothing live; migration 075 is NOT applied.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState, supabaseModule } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (mockState.auth.error ? mockState.auth : PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: () => false,
    PM_ROLES: PM,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const asAnon = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const jreq = (url, method, body, headers = {}) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body, headers) => {
  const res = await handler(jreq(url, method, body, headers))
  return { status: res.status, body: await res.json() }
}

const P = require('../lib/daily-report-payload')
const { weatherDelayCount, weatherDelayRows } = require('../lib/contract-time')
const { ownerPhotoList } = require('../lib/owner-photos')
const { pickerList, parsePickerParams, referenceElement } = require('../lib/job-photo-picker')
const { saveDailyReport, FINALIZE_LABEL } = require('../lib/daily-report-client')

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const base = (extra = {}) => ({ job_id: 'J1', report_date: '2026-11-09', work_performed: 'Framed walls', ...extra })
const studs = [{ description: 'Studs', quantity: '200', supplier: 'Lowes' }]

const seed = (extra = {}) => resetMockState({
  jobs: [{ id: 'J1', pm_email: 'lead@x.com', owner_email: 'client@x.test' }, { id: 'J2' }],
  pm_job_assignments: [
    { id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' },
    { id: 'a3', job_id: 'J1', user_id: 'super2' }, { id: 'a4', job_id: 'J1', user_id: 'apm1' },
  ],
  profiles: [{ id: 'super1', role: 'super' }, { id: 'super2', role: 'super' }, { id: 'pm1', role: 'pm' }, { id: 'apm1', role: 'apm' }, { id: 'admin1', role: 'admin' }, { id: 'owner1', role: 'owner' }],
  daily_reports: [],
  deliveries: [],
  job_photos: [],
  ...extra,
})
const reports = () => mockState.db.daily_reports
const deliveries = () => mockState.db.deliveries || []

// ─────────────────────────────────────────────────────────────────────────────
describe('1) pure helpers', () => {
  test('cleanPhotos keeps job_photo_id + source:job_photos; drops a non-uuid id', () => {
    expect(P.cleanPhotos([{ path: 'J1/gallery/cc-9.jpg', name: 'cc-9.jpg', caption: '', internal_only: true, job_photo_id: U1, source: 'job_photos', junk: 1 }]))
      .toEqual([{ path: 'J1/gallery/cc-9.jpg', name: 'cc-9.jpg', caption: '', internal_only: true, job_photo_id: U1, source: 'job_photos' }])
    expect(P.cleanPhotos([{ path: 'J1/a.jpg', job_photo_id: 'not-a-uuid' }])).toEqual([{ path: 'J1/a.jpg' }])
    expect(P.cleanPhotos([{ path: 'J1/a.jpg', job_photo_id: U1 }])).toEqual([{ path: 'J1/a.jpg', job_photo_id: U1, source: 'job_photos' }])
    expect(P.cleanPhotos([{ path: 'J1/a.jpg', source: 'other' }])).toEqual([{ path: 'J1/a.jpg' }])
  })

  test('photoPathOk accepts {jobId}/gallery/cc-…jpg; validate rejects a path outside the job', () => {
    expect(P.photoPathOk('J1', 'J1/gallery/cc-abc.jpg')).toBe(true)
    expect(P.photoPathOk('J1', 'J2/gallery/cc-abc.jpg')).toBe(false)
    expect(P.photoPathOk('J1', 'J1/../J2/x.jpg')).toBe(false)
    expect(P.validateDailyReportInput(base({ photos: [{ path: 'J1/gallery/cc-abc.jpg', job_photo_id: U1, source: 'job_photos' }] }))).toEqual({ ok: true })
    expect(P.validateDailyReportInput(base({ photos: [{ path: 'J2/gallery/cc-abc.jpg', job_photo_id: U1, source: 'job_photos' }] })).ok).toBe(false)
  })

  test('draft flag: work_performed optional on a draft, required otherwise', () => {
    expect(P.validateDailyReportInput(base({ work_performed: '' }), { draft: true })).toEqual({ ok: true })
    expect(P.validateDailyReportInput(base({ work_performed: undefined }), { draft: true })).toEqual({ ok: true })
    expect(P.validateDailyReportInput(base({ work_performed: '' })).error).toMatch(/Work performed/)
    expect(P.validateDailyReportInput(base({ report_date: '2026-02-30' }), { draft: true }).ok).toBe(false)
    expect(P.buildDailyReportRow({ authUserId: 'u', body: base({ work_performed: undefined }), draft: true }).work_performed).toBe('')
  })

  test('status helpers: missing status = final; visibleReports by role', () => {
    const rows = [
      { id: 'f', status: 'final' }, { id: 'legacy' }, { id: 'nul', status: null },
      { id: 'mine', status: 'draft', super_id: 'super1' }, { id: 'theirs', status: 'draft', super_id: 'super2' },
    ]
    expect(P.publishedReports(rows).map(r => r.id)).toEqual(['f', 'legacy', 'nul'])
    expect(P.isFinalReport({})).toBe(true)
    expect(P.isDraftReport({ status: 'draft' })).toBe(true)
    expect(P.visibleReports(rows, { role: 'super', userId: 'super1' }).map(r => r.id)).toEqual(['f', 'legacy', 'nul', 'mine'])
    expect(P.visibleReports(rows, { role: 'apm', userId: 'apm1' }).map(r => r.id)).toEqual(['f', 'legacy', 'nul'])
    for (const role of ['principal', 'admin', 'pm']) expect(P.visibleReports(rows, { role, userId: 'x' })).toHaveLength(5)
    expect(P.visibleReports(rows, { role: 'owner', userId: 'o' }).map(r => r.id)).toEqual(['f', 'legacy', 'nul'])
    expect(P.canReopenReport('pm')).toBe(true)
    expect(P.canReopenReport('super')).toBe(true) // prompt 89
    expect(P.canReopenReport('apm')).toBe(false)
    expect(P.canEditDraft({ role: 'super', userId: 'super2' }, rows[3])).toBe(false)
    expect(P.canEditDraft({ role: 'pm', userId: 'pm1' }, rows[3])).toBe(true)
    expect(P.canEditDraft({ role: 'super', userId: 'super1' }, rows[0])).toBe(false)
  })

  test('duplicate check only counts FINAL reports on that date', () => {
    const rows = [{ id: 'd', report_date: '2026-11-09', status: 'draft' }, { id: 'f', report_date: '2026-11-08', status: 'final' }, { id: 'old', report_date: '2026-11-07' }]
    const dates = P.finalReportDates(rows)
    expect(dates).toEqual(['2026-11-08', '2026-11-07'])
    expect(P.duplicateReportMessage('2026-11-09', dates)).toBeNull()
    expect(P.duplicateReportMessage('2026-11-08', dates)).toMatch(/already exists/)
    expect(P.finalReportDates(rows, { excludeId: 'f' })).toEqual(['2026-11-07'])
  })

  test('weatherDelayCount / weatherDelayRows ignore drafts; missing status counts', () => {
    const rows = [
      { report_date: '2026-11-01', weather_delay: true, status: 'final' },
      { report_date: '2026-11-02', weather_delay: true },
      { report_date: '2026-11-03', weather_delay: true, status: 'draft' },
      { report_date: '2026-11-04', weather_delay: false, status: 'final' },
    ]
    expect(weatherDelayCount(rows)).toBe(2)
    expect(weatherDelayRows(rows).map(r => r.report_date)).toEqual(['2026-11-01', '2026-11-02'])
    const html = require('../lib/weather-day-log-print').buildWeatherDayLogHtml({ job: { name: 'X' }, reports: rows })
    expect(html).not.toMatch(/Nov 3|2026-11-03|11\/3\/2026/)
  })

  test('ownerPhotoList drops draft reports (missing status = final)', () => {
    const list = ownerPhotoList({
      jobId: 'J1',
      jobPhotos: [],
      reports: [
        { report_date: '2026-11-06', status: 'draft', photos: [{ path: 'J1/draft.jpg' }] },
        { report_date: '2026-11-05', status: 'final', photos: [{ path: 'J1/final.jpg' }] },
        { report_date: '2026-11-04', photos: [{ path: 'J1/legacy.jpg' }] },
      ],
    })
    expect(list.map(p => p.path)).toEqual(['J1/final.jpg', 'J1/legacy.jpg'])
  })

  test('picker list: all job photos newest first, CompanyCam filter, Central date, internal flagged', () => {
    const rows = [
      { id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg', file_name: 'cc-1.jpg', companycam_photo_id: '1', companycam_creator_name: 'Landon', companycam_tags: ['framing'], internal_only: true, taken_at: '2026-11-10T03:30:00Z' }, // Nov 9 9:30pm CST
      { id: U2, job_id: 'J1', storage_path: 'J1/gallery/123.jpg', file_name: 'up.jpg', taken_at: '2026-11-09T15:00:00Z' },
      { id: 'x3', job_id: 'J1', storage_path: 'J1/gallery/cc-2.jpg', companycam_photo_id: '2', taken_at: '2026-11-08T15:00:00Z' },
      { id: 'x4', job_id: 'J1', storage_path: 'J1/gallery/cc-1_thumb.jpg', companycam_photo_id: '3' },
      { id: 'x5', job_id: 'J1', storage_path: 'J2/elsewhere.jpg' },
    ]
    const all = pickerList(rows, { jobId: 'J1', all: true })
    expect(all.map(p => p.id)).toEqual([U1, U2, 'x3'])
    expect(all[0]).toMatchObject({ companycam: true, internal_only: true, creator: 'Landon', tags: ['framing'], date: '2026-11-09' })
    expect(all[1]).toMatchObject({ companycam: false, internal_only: false })
    expect(pickerList(rows, { jobId: 'J1', all: false, date: '2026-11-09' }).map(p => p.id)).toEqual([U1, U2])
    expect(pickerList(rows, { jobId: 'J1', all: true, source: 'companycam' }).map(p => p.id)).toEqual([U1, 'x3'])
    expect(parsePickerParams(new URLSearchParams('job_id=J1&date=2026-11-09'))).toMatchObject({ jobId: 'J1', date: '2026-11-09', all: false, source: 'all', limit: 40, offset: 0 })
    expect(parsePickerParams(new URLSearchParams('job_id=J1&date=bad&limit=999&offset=-3&source=companycam'))).toMatchObject({ all: true, limit: 100, offset: 0, source: 'companycam' })
    // Reference element: inherit internal_only, carry job_photo_id + source
    expect(referenceElement(all[0])).toEqual({ path: 'J1/gallery/cc-1.jpg', name: 'cc-1.jpg', caption: '', internal_only: true, job_photo_id: U1, source: 'job_photos' })
    expect(referenceElement(all[1]).internal_only).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) POST / PATCH /api/daily-reports', () => {
  const route = require('../app/api/daily-reports/route')
  const post = body => call(route.POST, '/api/daily-reports', 'POST', body)
  const patch = body => call(route.PATCH, '/api/daily-reports', 'PATCH', body)

  test('POST draft: blank work_performed allowed, status draft, no deliveries', async () => {
    seed(); as('super')
    const r = await post(base({ work_performed: '', materials_delivered: studs }))
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'draft', finalized_at: null, finalized_by: null, super_id: 'super1', work_performed: '' })
    expect(deliveries()).toHaveLength(0)
  })

  test('POST finalize / status=final: work_performed required; deliveries inserted once; stamped', async () => {
    seed(); as('super')
    expect((await post(base({ work_performed: ' ', finalize: true }))).status).toBe(400)
    expect(reports()).toHaveLength(0)
    const r = await post(base({ status: 'final', materials_delivered: studs }))
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'final', finalized_by: 'super1' })
    expect(r.body.report.finalized_at).toBeTruthy()
    expect(deliveries()).toHaveLength(1)
    expect(reports()[0].deliveries_created_at).toBeTruthy()
  })

  test('POST keeps referenced photos (job_photo_id + source) on the jsonb', async () => {
    seed(); as('super')
    const photos = [{ path: 'J1/gallery/cc-9.jpg', name: 'cc-9.jpg', caption: '', internal_only: true, job_photo_id: U1, source: 'job_photos' }, { path: 'J1/1-0-a.jpg', name: 'a.jpg', caption: '' }]
    const r = await post(base({ photos }))
    expect(r.status).toBe(200)
    expect(reports()[0].photos).toEqual(photos)
    expect(mockState.calls.filter(c => c.table === 'job_photos')).toHaveLength(0)
  })

  test('before migration 075: a draft → 503 (nothing saved); finalize → pre-075 insert', async () => {
    seed(); as('super')
    mockState.missingCols = { daily_reports: ['status'] }
    const d = await post(base())
    expect(d.status).toBe(503)
    expect(d.body.migration_required).toBe('075')
    expect(reports()).toHaveLength(0)
    const f = await post(base({ finalize: true, materials_delivered: studs }))
    expect(f.status).toBe(200)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).not.toHaveProperty('status')
    expect(deliveries()).toHaveLength(1) // pre-075: no marker column, same as today
  })

  test('PATCH: author edits own draft; another super 403; PM may edit; final 409; missing 404; job mismatch 403', async () => {
    seed({ daily_reports: [
      { id: 'd1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: '', status: 'draft' },
      { id: 'f1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-08', work_performed: 'x', status: 'final', finalized_at: '2026-11-08T20:00:00Z' },
    ] })
    as('super', 'super1')
    let r = await patch({ id: 'd1', work_performed: 'Poured slab', weather: 'Clear', materials_delivered: studs })
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ id: 'd1', status: 'draft', work_performed: 'Poured slab', weather: 'Clear', super_id: 'super1' })
    expect(deliveries()).toHaveLength(0)

    as('super', 'super2')
    expect((await patch({ id: 'd1', work_performed: 'hijack' })).status).toBe(403)
    as('apm', 'apm1')
    expect((await patch({ id: 'd1', work_performed: 'hijack' })).status).toBe(403)
    expect(reports().find(x => x.id === 'd1').work_performed).toBe('Poured slab')

    as('pm', 'pm1')
    r = await patch({ id: 'd1', work_performed: 'PM tidy-up' })
    expect(r.status).toBe(200)
    expect(reports().find(x => x.id === 'd1').super_id).toBe('super1') // author unchanged

    as('super', 'super1')
    r = await patch({ id: 'f1', work_performed: 'change' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('This report is finalized and cannot be edited.')
    expect((await patch({ id: 'nope' })).status).toBe(404)
    expect((await patch({ id: 'd1', job_id: 'J2' })).status).toBe(403)
    as('super', 'super9') // not on the job
    expect((await patch({ id: 'd1', work_performed: 'x' })).status).toBe(403)
  })

  test('POST: owner client / sub → 403; unassigned super → 403', async () => {
    for (const role of ['owner', 'subcontractor']) { seed(); as(role); expect((await post(base())).status).toBe(403) }
    seed(); as('super', 'super9')
    expect((await post(base())).status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) finalize + reopen', () => {
  const finalize = require('../app/api/daily-reports/finalize/route')
  const reopen = require('../app/api/daily-reports/reopen/route')
  const fin = id => call(finalize.POST, '/api/daily-reports/finalize', 'POST', { id })
  const reo = id => call(reopen.POST, '/api/daily-reports/reopen', 'POST', { id })
  const draft = (extra = {}) => ({ id: 'd1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed', status: 'draft', finalized_at: null, finalized_by: null, materials_delivered: studs, revision_count: 0 /* post-076 row (prompt 86) */, ...extra })

  test('author finalizes: stamped, deliveries once; repeat → already_final, no duplicate deliveries', async () => {
    seed({ daily_reports: [draft()] }); as('super', 'super1')
    let r = await fin('d1')
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'final', finalized_by: 'super1' })
    expect(deliveries()).toHaveLength(1)
    expect(deliveries()[0]).toMatchObject({ job_id: 'J1', super_id: 'super1', material: 'Studs', source: 'daily_report', received_date: '2026-11-09' })
    r = await fin('d1')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, already_final: true })
    expect(deliveries()).toHaveLength(1)
  })

  test('finalize: another super 403; PM may finalize; blank work_performed 400; not on job 403', async () => {
    seed({ daily_reports: [draft({ work_performed: '  ' })] })
    as('super', 'super2')
    expect((await fin('d1')).status).toBe(403)
    as('super', 'super1')
    const blank = await fin('d1')
    expect(blank.status).toBe(400)
    expect(blank.body.error).toMatch(/Work performed/)
    reports()[0].work_performed = 'Done'
    as('pm', 'pm9')
    expect((await fin('d1')).status).toBe(403)
    as('pm', 'pm1')
    const r = await fin('d1')
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'final', finalized_by: 'pm1' })
    expect(deliveries()[0].super_id).toBe('super1') // the report's author logged them
  })

  test('reopen: Owner / admin / PM (super only own — prompt 89); clears finalize stamps, records reopen; re-finalize does not duplicate deliveries', async () => {
    seed({ daily_reports: [draft()] }); as('super', 'super1')
    await fin('d1')
    expect(deliveries()).toHaveLength(1)
    as('super', 'super2') // prompt 89: a super on the job, but not the author
    expect((await reo('d1')).status).toBe(403)
    as('apm', 'apm1')
    expect((await reo('d1')).status).toBe(403)
    as('pm', 'pm1')
    const r = await reo('d1')
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'draft', finalized_at: null, finalized_by: null, reopened_by: 'pm1' })
    expect(r.body.report.reopened_at).toBeTruthy()
    expect((await reo('d1')).status).toBe(409) // already a draft
    // super edits and finalizes again
    as('super', 'super1')
    const patched = await call(require('../app/api/daily-reports/route').PATCH, '/api/daily-reports', 'PATCH', { id: 'd1', work_performed: 'Corrected', materials_delivered: studs })
    expect(patched.status).toBe(200)
    expect((await fin('d1')).status).toBe(200)
    expect(reports()[0]).toMatchObject({ status: 'final', work_performed: 'Corrected' })
    expect(deliveries()).toHaveLength(1)
  })

  test('reopen: principal and admin any job; pm not on the job 403; missing 404', async () => {
    for (const [role, id] of [['principal', 'p1'], ['admin', 'admin1']]) {
      seed({ daily_reports: [draft({ status: 'final', finalized_at: '2026-11-09T20:00:00Z', finalized_by: 'super1' })] }); as(role, id)
      expect((await reo('d1')).status).toBe(200)
    }
    seed({ daily_reports: [draft({ status: 'final', finalized_at: '2026-11-09T20:00:00Z' })] }); as('pm', 'pm9')
    expect((await reo('d1')).status).toBe(403)
    as('pm', 'pm1')
    expect((await reo('zzz')).status).toBe(404)
  })

  test('routes send no email / notify', () => {
    for (const f of ['app/api/daily-reports/route.js', 'app/api/daily-reports/finalize/route.js', 'app/api/daily-reports/reopen/route.js']) {
      expect([f, /sendEmail|resend|notify\w*\(/i.test(read(f))]).toEqual([f, false])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4) client helper', () => {
  const fakeFetch = () => {
    const calls = []
    const fn = async (url, init) => { calls.push({ url, method: init.method, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, report: { id: 'r1' } }) } }
    return { calls, fn }
  }
  test('new → POST (finalize flag); existing → PATCH then /finalize', async () => {
    let f = fakeFetch()
    await saveDailyReport(f.fn, { payload: base(), finalize: false })
    expect(f.calls).toEqual([{ url: '/api/daily-reports', method: 'POST', body: { ...base(), finalize: false } }])
    f = fakeFetch()
    await saveDailyReport(f.fn, { id: 'r1', payload: base(), finalize: true })
    expect(f.calls.map(c => [c.url, c.method])).toEqual([['/api/daily-reports', 'PATCH'], ['/api/daily-reports/finalize', 'POST']])
    expect(f.calls[0].body.id).toBe('r1')
    expect(FINALIZE_LABEL).toBe('Finalize – 100% complete')
  })
  test('server error message is thrown', async () => {
    const fn = async () => ({ ok: false, status: 409, json: async () => ({ error: 'This report is finalized and cannot be edited.' }) })
    await expect(saveDailyReport(fn, { id: 'x', payload: base() })).rejects.toThrow(/finalized/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) GET /api/daily-reports/job-photos', () => {
  const route = require('../app/api/daily-reports/job-photos/route')
  const get = q => call(route.GET, `/api/daily-reports/job-photos?${q}`, 'GET')
  const photos = () => [
    { id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg', file_name: 'cc-1.jpg', companycam_photo_id: '1', companycam_creator_name: 'Landon', companycam_tags: ['framing'], internal_only: true, taken_at: '2026-11-10T03:30:00Z' },
    { id: U2, job_id: 'J1', storage_path: 'J1/gallery/55.jpg', file_name: 'up.jpg', internal_only: false, taken_at: '2026-11-09T14:00:00Z' },
    ...Array.from({ length: 45 }, (_, i) => ({ id: `cc${i}`, job_id: 'J1', storage_path: `J1/gallery/cc-x${i}.jpg`, companycam_photo_id: `x${i}`, internal_only: true, taken_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:00Z` })),
    { id: 'other', job_id: 'J2', storage_path: 'J2/gallery/cc-z.jpg', companycam_photo_id: 'z' },
  ]

  test('401 / 403 (owner client, sub, unassigned) / 400 without job_id', async () => {
    seed({ job_photos: photos() })
    asAnon(); expect((await get('job_id=J1')).status).toBe(401)
    as('owner', 'owner1'); expect((await get('job_id=J1')).status).toBe(403)
    as('subcontractor'); expect((await get('job_id=J1')).status).toBe(403)
    as('super', 'super9'); expect((await get('job_id=J1')).status).toBe(403)
    as('pm', 'pm9'); expect((await get('job_id=J1')).status).toBe(403)
    as('super', 'super1'); expect((await get('')).status).toBe(400)
  })

  test('date filter uses Central dates; includes gallery + CompanyCam; internal_only included; thumb falls back', async () => {
    seed({ job_photos: photos() }); as('apm', 'apm1')
    mockState.signedUrlResults = { 'daily-report-photos': p => (p === 'J1/gallery/cc-1_thumb.jpg' ? { signedUrl: null, error: 'Object not found' } : null) }
    const r = await get('job_id=J1&date=2026-11-09')
    expect(r.status).toBe(200)
    expect(r.body.photos.map(p => p.id)).toEqual([U1, U2])
    expect(r.body.photos[0]).toMatchObject({ companycam: true, internal_only: true, creator: 'Landon', tags: ['framing'], url: 'https://signed/daily-report-photos/J1/gallery/cc-1.jpg', thumb_url: 'https://signed/daily-report-photos/J1/gallery/cc-1.jpg' })
    expect(r.body.photos[1]).toMatchObject({ companycam: false, internal_only: false, thumb_url: 'https://signed/daily-report-photos/J1/gallery/55_thumb.jpg' })
  })

  test('all=1 pages 40 at a time newest first; source=companycam narrows; other jobs never leak', async () => {
    seed({ job_photos: photos() }); as('super', 'super1')
    const p1 = await get('job_id=J1&all=1')
    expect(p1.body).toMatchObject({ total: 47, limit: 40, offset: 0, has_more: true, companycam_total: 46 })
    expect(p1.body.photos).toHaveLength(40)
    expect(p1.body.photos[0].id).toBe(U1)
    const p2 = await get('job_id=J1&all=1&offset=40')
    expect(p2.body.photos).toHaveLength(7)
    expect(p2.body.has_more).toBe(false)
    const cc = await get('job_id=J1&all=1&source=companycam&limit=100')
    expect(cc.body.total).toBe(46)
    expect(cc.body.photos.every(p => p.companycam)).toBe(true)
    expect([...p1.body.photos, ...p2.body.photos].some(p => p.path.startsWith('J2/'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('6) unlink never deletes shared files; drafts protected', () => {
  const del = require('../app/api/delete-photo/route')
  const vis = require('../app/api/photo-visibility/route')
  const client = supabaseModule.createClient()
  beforeAll(() => { client.auth.getUser = async token => ({ data: { user: token ? { id: token, email: `${token}@x.com` } : null }, error: null }) })
  afterAll(() => { delete client.auth.getUser })
  const delAs = (userId, body) => call(del.POST, '/api/delete-photo', 'POST', body, { Authorization: `Bearer ${userId}` })
  const removes = () => mockState.calls.filter(c => c.op === 'remove')

  test('report element with job_photo_id: element dropped, file + job_photos row kept', async () => {
    seed({
      job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg' }],
      daily_reports: [{ id: 'f1', job_id: 'J1', super_id: 'super1', status: 'final', photos: [{ path: 'J1/gallery/cc-1.jpg', job_photo_id: U1, source: 'job_photos' }, { path: 'J1/keep.jpg', internal_only: true }] }],
    })
    // FINAL report: only Owner / admin / PM may change its photos (prompt 85 leftover M3)
    const r = await delAs('pm1', { jobId: 'J1', path: 'J1/gallery/cc-1.jpg', fromReport: true, reportId: 'f1' })
    expect(r.status).toBe(200)
    expect(r.body.file_removed).toBe(false)
    expect(reports()[0].photos).toEqual([{ path: 'J1/keep.jpg', internal_only: true }])
    expect(removes()).toHaveLength(0)
    expect(mockState.db.job_photos).toHaveLength(1)
  })

  test('element without the flag but a job_photos row owns the path → file kept', async () => {
    seed({
      job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg' }],
      daily_reports: [{ id: 'f1', job_id: 'J1', status: 'final', photos: [{ path: 'J1/gallery/cc-1.jpg' }] }],
    })
    const r = await delAs('pm1', { jobId: 'J1', path: 'J1/gallery/cc-1.jpg', fromReport: true, reportId: 'f1' })
    expect(r.status).toBe(200)
    expect(removes()).toHaveLength(0)
    expect(reports()[0].photos).toBeNull()
  })

  test('report-only upload → storage removed after the DB write (apm author of a draft allowed)', async () => {
    seed({ daily_reports: [{ id: 'f1', job_id: 'J1', super_id: 'apm1', status: 'draft', photos: [{ path: 'J1/1-0-a.jpg' }] }] })
    const r = await delAs('apm1', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })
    expect(r.status).toBe(200)
    expect(removes()).toEqual([expect.objectContaining({ payload: ['J1/1-0-a.jpg', 'J1/1-0-a_thumb.jpg'] })])
  })

  test('gallery delete keeps the file while a daily report references the path', async () => {
    seed({
      job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg' }],
      daily_reports: [{ id: 'f1', job_id: 'J1', status: 'final', photos: [{ path: 'J1/gallery/cc-1.jpg', job_photo_id: U1, source: 'job_photos' }] }],
    })
    const r = await delAs('pm1', { jobId: 'J1', path: 'J1/gallery/cc-1.jpg' })
    expect(r.status).toBe(200)
    expect(mockState.db.job_photos).toHaveLength(0)
    expect(removes()).toHaveLength(0)
    expect(reports()[0].photos).toHaveLength(1)
    // not referenced → removed
    seed({ job_photos: [{ id: U2, job_id: 'J1', storage_path: 'J1/gallery/9.jpg' }] })
    await delAs('pm1', { jobId: 'J1', path: 'J1/gallery/9.jpg' })
    expect(removes()).toHaveLength(1)
  })

  test('draft report: another super cannot unlink / toggle (403); the author and a PM can', async () => {
    const d = () => ({ id: 'd1', job_id: 'J1', super_id: 'super1', status: 'draft', photos: [{ path: 'J1/1-0-a.jpg' }] })
    seed({ daily_reports: [d()] })
    expect((await delAs('super2', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'd1' })).status).toBe(403)
    as('super', 'super2')
    expect((await call(vis.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/1-0-a.jpg', internal_only: true, fromReport: true, reportId: 'd1' })).status).toBe(403)
    as('pm', 'pm1')
    expect((await call(vis.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/1-0-a.jpg', internal_only: true, fromReport: true, reportId: 'd1' })).status).toBe(200)
    as('super', 'super1')
    expect((await call(vis.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/1-0-a.jpg', internal_only: false, fromReport: true, reportId: 'd1' })).status).toBe(200)
    expect((await delAs('super1', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'd1' })).status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('7) owner portal photos exclude drafts', () => {
  const route = require('../app/api/owner-photos/route')
  test('a draft report photo never reaches the owner', async () => {
    seed({ daily_reports: [
      { id: 'd1', job_id: 'J1', report_date: '2026-11-09', status: 'draft', photos: [{ path: 'J1/draft.jpg' }] },
      { id: 'f1', job_id: 'J1', report_date: '2026-11-08', status: 'final', photos: [{ path: 'J1/final.jpg' }] },
      { id: 'old', job_id: 'J1', report_date: '2026-11-07', photos: [{ path: 'J1/legacy.jpg' }] },
    ] })
    as('owner', 'owner1', 'client@x.test')
    const r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.photos.map(p => p.path)).toEqual(['J1/final.jpg', 'J1/legacy.jpg'])
    expect(r.body.total).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('8) migration 075', () => {
  const sql = read('migrations/075_daily_report_drafts.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  test('wrapped in BEGIN / COMMIT; columns; backfill to final; default draft; checks; index', () => {
    expect(code).toMatch(/^\s*BEGIN;/m)
    expect(code.trim()).toMatch(/COMMIT;$/)
    for (const c of ['status text', 'finalized_at timestamptz', 'finalized_by uuid REFERENCES public.profiles\\(id\\)', 'reopened_at timestamptz', 'reopened_by uuid', 'deliveries_created_at timestamptz']) {
      expect(code).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}`))
    }
    expect(code).toMatch(/SET status = 'final',\s*finalized_at = COALESCE\(d\.created_at, now\(\)\)/)
    expect(code).toMatch(/WHERE d\.status IS NULL;/)
    // backfill runs before NOT NULL / default draft
    expect(code.indexOf("SET status = 'final'")).toBeLessThan(code.indexOf("SET DEFAULT 'draft'"))
    expect(code).toMatch(/ALTER COLUMN status SET NOT NULL/)
    expect(code).toMatch(/CHECK \(status IN \('draft', 'final'\)\)/)
    expect(code).toMatch(/status = 'draft' AND finalized_at IS NULL AND finalized_by IS NULL/)
    expect(code).toMatch(/status = 'final' AND finalized_at IS NOT NULL/)
    expect(code).toMatch(/ON public\.daily_reports \(job_id, status, report_date DESC\)/)
  })

  test('RLS: open policies dropped; drafts readable by author or Owner/admin/PM only; writes limited to own drafts', () => {
    expect(code).toMatch(/FROM pg_policies[\s\S]*tablename = 'daily_reports'[\s\S]*DROP POLICY/)
    expect(code).not.toMatch(/USING \(true\)/i)
    expect(code).not.toMatch(/WITH CHECK \(true\)/i)
    expect(code).toMatch(/FOR SELECT TO authenticated\s+USING \(\s*status = 'final'\s+OR super_id = auth\.uid\(\)\s+OR public\.daily_report_draft_access\(job_id::text\)/)
    expect(code).toMatch(/get_my_role\(\) IN \('principal', 'admin'\) THEN true/)
    expect(code).toMatch(/get_my_role\(\) = 'pm' THEN/)
    expect(code).not.toMatch(/'apm'/)
    expect(code).toMatch(/FOR INSERT TO authenticated\s+WITH CHECK \(super_id = auth\.uid\(\) AND status = 'draft'/)
    expect(code).toMatch(/FOR UPDATE TO authenticated\s+USING \(status = 'draft' AND super_id = auth\.uid\(\)\)\s+WITH CHECK \(status = 'draft' AND super_id = auth\.uid\(\)/)
    expect(code).toMatch(/FOR DELETE TO authenticated\s+USING \(status = 'draft' AND super_id = auth\.uid\(\)\)/)
    expect(sql).toMatch(/Rollback/)
    expect(sql).toMatch(/NOT applied/)
    expect(code).not.toMatch(/job_photos|storage\.objects/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('9) source checks', () => {
  const field = read('app/field/page.js')
  const form = read('app/jobdetail/DailyReportForm.js')
  const picker = read('app/jobdetail/JobPhotoPicker.js')
  const jd = read('app/jobdetail/page.js')
  const res = read('app/residentialjobdetail/page.js')

  test('field: no browser insert/update of daily_reports; API save; Save draft + Finalize + picker + Draft badge + Edit', () => {
    expect(field).not.toMatch(/from\('daily_reports'\)\.(insert|update)\(/)
    expect(field).toMatch(/saveDailyReport\(authFetch, \{ id: editingReportId \|\| savedReportIdRef\.current, payload, finalize \}\)/)
    expect(field).toMatch(/submitDailyReport\(false\)[\s\S]{0,400}Save draft/)
    expect(field).toMatch(/submitDailyReport\(true\)[\s\S]{0,400}FINALIZE_LABEL/)
    expect(field).toMatch(/FINALIZE_CONFIRM/)
    expect(field).toMatch(/Choose from CompanyCam/)
    expect(field).toMatch(/<JobPhotoPicker/)
    expect(field).toMatch(/<span style=\{DRAFT_BADGE\}>Draft<\/span>/)
    expect(field).toMatch(/startEditDraft\(r\)/)
    expect(field).toMatch(/Draft – not finalized/)
    // file input still library-friendly (no capture)
    expect(field).toMatch(/<input type="file" accept="image\/\*" multiple style=\{\{ display: 'none' \}\} disabled=\{uploadingPhoto\}/)
    const step4 = field.slice(field.indexOf('{wizardStep === 4 && ('), field.indexOf('{dailyReports.length > 0 && ('))
    expect(step4).toMatch(/Add Photos/)
    expect(step4).not.toMatch(/capture=/)
    // checkTodayReport no longer maybeSingle
    const today = field.slice(field.indexOf('async function checkTodayReport'), field.indexOf('async function loadDailyReports'))
    expect(today).not.toMatch(/maybeSingle/)
    expect(today).toMatch(/isFinalReport/)
  })

  test('office DailyReportForm: same Save draft / Finalize flow (no auto-publish), picker, edit-draft mode', () => {
    expect(form).toMatch(/saveDailyReport\(authFetch,/)
    expect(form).toMatch(/onClick=\{\(\) => save\(false\)\}[\s\S]{0,200}Save draft/)
    expect(form).toMatch(/onClick=\{\(\) => save\(true\)\}[\s\S]{0,200}FINALIZE_LABEL/)
    expect(form).not.toMatch(/Submit daily report/)
    expect(form).toMatch(/function submit\(e\)[\s\S]{0,300}save\(false\)/) // Enter never publishes
    expect(form).toMatch(/Choose from CompanyCam/)
    expect(form).toMatch(/initialReport/)
    expect(form).not.toMatch(/from\('daily_reports'\)/)
  })

  test('picker: iPhone-usable sheet, 3-column grid, Attach selected / Cancel / Load more, badges, API route', () => {
    expect(picker).toMatch(/position: 'fixed'/)
    expect(picker).toMatch(/gridTemplateColumns: 'repeat\(3, 1fr\)'/)
    expect(picker).toMatch(/const TAP = 44/)
    expect(picker).toMatch(/Attach selected/)
    expect(picker).toMatch(/>Cancel</)
    expect(picker).toMatch(/Load more/)
    expect(picker).toMatch(/This day&apos;s photos/)
    expect(picker).toMatch(/CompanyCam only/)
    expect(picker).toMatch(/>Internal</)
    expect(picker).toMatch(/\/api\/daily-reports\/job-photos/)
    expect(picker).toMatch(/safe-area-inset-bottom/)
    expect(picker).not.toMatch(/:hover|onMouseEnter/)
  })

  test('job pages: drafts labeled, Edit draft / Reopen, Site Photos final-only, duplicate dates final-only', () => {
    for (const src of [jd, res]) {
      expect(src).toMatch(/visibleReports\(/)
      expect(src).toMatch(/style=\{DRAFT_BADGE\}[^>]*>Draft</)
      expect(src).toMatch(/Edit draft/)
      expect(src).toMatch(/reopenDailyReport\(authFetch, r\.id\)/)
      expect(src).toMatch(/canReopenReport\(userRole\)/)
      expect(src).toMatch(/publishedReports\(reports \|\| \[\]\)/)
      expect(src).toMatch(/finalReportDates\(/)
    }
  })

  test('owner-photos route filters drafts in code (service role)', () => {
    expect(read('app/api/owner-photos/route.js')).toMatch(/publishedReports\(rep\.data/)
    expect(read('lib/owner-photos.js')).toMatch(/publishedReports\(allReports\)/)
  })
})
