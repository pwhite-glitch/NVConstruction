/**
 * Prompt 85 leftover fixes (review: /workspace/portal-fixes/prompt85-review.txt).
 *   M1  deploy-order note on 075; finalize never double-creates deliveries that old code made
 *   M2  picked job photos follow the CURRENT job_photos.internal_only (owner portal + Site Photos)
 *   M3  delete-photo: a FINAL report's photos only by Owner / admin / PM
 *   L1  PATCH is partial — omitted fields keep their stored values
 *   L4  reopen before 075 → clean 409 JSON "needs migration 075"
 *   L7  re-finalize after a reopen adds deliveries only for materials that have none
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
const jreq = (url, method, body, headers = {}) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body, headers) => {
  const res = await handler(jreq(url, method, body, headers))
  return { status: res.status, body: await res.json() }
}

const { ownerPhotoList } = require('../lib/owner-photos')
const { reportPhotoInternal } = require('../lib/report-photo-links')
const { createDeliveriesOnce, missingDeliveries } = require('../lib/daily-report-server')
const route = require('../app/api/daily-reports/route')
const finalize = require('../app/api/daily-reports/finalize/route')
const reopen = require('../app/api/daily-reports/reopen/route')
const del = require('../app/api/delete-photo/route')
const vis = require('../app/api/photo-visibility/route')
const ownerPhotos = require('../app/api/owner-photos/route')

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const studs = { description: 'Studs', quantity: '200', supplier: 'Lowes' }
const drywall = { description: 'Drywall', quantity: '40', supplier: 'HD' }

const seed = (extra = {}) => resetMockState({
  jobs: [{ id: 'J1', pm_email: 'lead@x.com', owner_email: 'client@x.test' }, { id: 'J2' }],
  pm_job_assignments: [
    { id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' },
    { id: 'a3', job_id: 'J1', user_id: 'super2' }, { id: 'a4', job_id: 'J1', user_id: 'apm1' },
  ],
  profiles: [{ id: 'super1', role: 'super' }, { id: 'super2', role: 'super' }, { id: 'pm1', role: 'pm' }, { id: 'apm1', role: 'apm' }, { id: 'admin1', role: 'admin' }, { id: 'p1', role: 'principal' }, { id: 'owner1', role: 'owner' }],
  daily_reports: [],
  deliveries: [],
  job_photos: [],
  ...extra,
})
const reports = () => mockState.db.daily_reports
const deliveries = () => mockState.db.deliveries || []
const fin = id => call(finalize.POST, '/api/daily-reports/finalize', 'POST', { id })
const reo = id => call(reopen.POST, '/api/daily-reports/reopen', 'POST', { id })
const patch = body => call(route.PATCH, '/api/daily-reports', 'PATCH', body)
const draft = (extra = {}) => ({ id: 'd1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed', status: 'draft', finalized_at: null, finalized_by: null, deliveries_created_at: null, materials_delivered: [studs], revision_count: 0 /* post-076 row (prompt 86) */, ...extra })
// What the pre-075 field insert / office POST wrote (no daily_report_id).
const legacyDelivery = (m, extra = {}) => ({ id: `old-${m.description}`, job_id: 'J1', super_id: 'super1', material: m.description, vendor: m.supplier, quantity: m.quantity, status: 'received', received_date: '2026-11-09', source: 'daily_report', ...extra })

// ─────────────────────────────────────────────────────────────────────────────
describe('M1) deploy order + no double deliveries from old-code rows', () => {
  test('075 header says to deploy the code before applying it', () => {
    const sql = read('migrations/075_daily_report_drafts.sql')
    const header = sql.split('\n').slice(0, 10).join('\n')
    expect(header).toMatch(/DEPLOY THE CODE BEFORE APPLYING 075\./)
  })

  test('draft written by old code (marker NULL, deliveries already exist) → finalize inserts nothing', async () => {
    seed({ daily_reports: [draft({ materials_delivered: [studs, drywall] })], deliveries: [legacyDelivery(studs), legacyDelivery(drywall)] })
    as('super', 'super1')
    const r = await fin('d1')
    expect(r.status).toBe(200)
    expect(r.body.report.status).toBe('final')
    expect(deliveries()).toHaveLength(2)
    expect(reports()[0].deliveries_created_at).toBeTruthy() // claimed, so a later finalize never re-checks blindly
  })

  test('deliveries already tagged with the report id count too; other reports / jobs / dates do not', async () => {
    seed({
      daily_reports: [draft()],
      deliveries: [
        legacyDelivery(studs, { id: 'x1', received_date: '2026-11-08' }), // other date
        legacyDelivery(studs, { id: 'x2', job_id: 'J2' }), // other job
        legacyDelivery(studs, { id: 'x3', daily_report_id: 'other' }), // another report's row
      ],
    })
    as('pm', 'pm1')
    expect((await fin('d1')).status).toBe(200)
    expect(deliveries()).toHaveLength(4)
    expect(deliveries()[3]).toMatchObject({ material: 'Studs', daily_report_id: 'd1' })
    // a second finalize path (e.g. retried request) never duplicates
    reports()[0].status = 'draft'; reports()[0].finalized_at = null
    await fin('d1')
    expect(deliveries()).toHaveLength(4)
  })

  test('could not read existing deliveries → inserts nothing, releases the claim, returns a warning', async () => {
    seed({ daily_reports: [draft({ status: 'final' })] })
    mockState.failSelect = { deliveries: 'boom' }
    const out = await createDeliveriesOnce(supabaseModule.createClient(), reports()[0], 'super1')
    expect(out.inserted).toBe(0)
    expect(out.warning).toMatch(/boom/)
    expect(deliveries()).toHaveLength(0)
    expect(reports()[0].deliveries_created_at).toBeNull()
  })

  test('missingDeliveries is a multiset (two identical lines need two rows)', () => {
    const want = [{ material: 'Studs', vendor: 'Lowes', quantity: '200' }, { material: 'Studs', vendor: 'Lowes', quantity: '200' }]
    expect(missingDeliveries(want, [{ material: ' studs ', vendor: 'LOWES', quantity: '200' }])).toHaveLength(1)
    expect(missingDeliveries(want, [])).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('M2) picked job photos follow the current job_photos.internal_only', () => {
  const ref = (extra = {}) => ({ path: 'J1/gallery/cc-1.jpg', job_photo_id: U1, source: 'job_photos', internal_only: true, ...extra })

  test('reportPhotoInternal: reference uses the live row; report-only uses its own flag; fail safe', () => {
    expect(reportPhotoInternal(ref(), [{ id: U1, storage_path: 'J1/gallery/cc-1.jpg', internal_only: false }])).toBe(false)
    expect(reportPhotoInternal(ref({ internal_only: false }), [{ id: U1, storage_path: 'J1/gallery/cc-1.jpg', internal_only: true }])).toBe(true)
    // matched by path when the id is absent
    expect(reportPhotoInternal({ path: 'J1/a.jpg', source: 'job_photos', internal_only: true }, [{ id: U2, storage_path: 'J1/a.jpg', internal_only: false }])).toBe(false)
    // row gone / rows not loaded → internal
    expect(reportPhotoInternal(ref({ internal_only: false }), [])).toBe(true)
    expect(reportPhotoInternal(ref({ internal_only: false }), null)).toBe(true)
    // report-only upload
    expect(reportPhotoInternal({ path: 'J1/u.jpg', internal_only: true }, null)).toBe(true)
    expect(reportPhotoInternal({ path: 'J1/u.jpg' }, null)).toBe(false)
  })

  test('ownerPhotoList: un-hiding the gallery row shows the photo even though the element said internal', () => {
    const reportsList = [{ id: 'f1', status: 'final', report_date: '2026-11-09', photos: [ref()] }]
    const shown = ownerPhotoList({ jobId: 'J1', jobPhotos: [{ id: U1, storage_path: 'J1/gallery/cc-1.jpg', internal_only: false }], reports: reportsList })
    expect(shown.map(p => p.path)).toEqual(['J1/gallery/cc-1.jpg'])
    const hidden = ownerPhotoList({ jobId: 'J1', jobPhotos: [{ id: U1, storage_path: 'J1/gallery/cc-1.jpg', internal_only: true }], reports: [{ ...reportsList[0], photos: [ref({ internal_only: false })] }] })
    expect(hidden).toEqual([])
    // gallery row deleted → the dangling reference stays hidden
    expect(ownerPhotoList({ jobId: 'J1', jobPhotos: [], reports: [{ ...reportsList[0], photos: [ref({ internal_only: false })] }] })).toEqual([])
    // jobPhotos not loaded → hidden
    expect(ownerPhotoList({ jobId: 'J1', jobPhotos: null, reports: [{ ...reportsList[0], photos: [ref({ internal_only: false })] }] })).toEqual([])
  })

  test('owner-photos route: CompanyCam photo un-hidden in Site Photos reaches the owner', async () => {
    seed({
      job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg', internal_only: false, taken_at: '2026-11-09T15:00:00Z' }],
      daily_reports: [{ id: 'f1', job_id: 'J1', report_date: '2026-11-09', status: 'final', photos: [ref()] }],
    })
    as('owner', 'owner1', 'client@x.test')
    const r = await call(ownerPhotos.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.photos.map(p => p.path)).toEqual(['J1/gallery/cc-1.jpg'])
  })

  test('photo-visibility on a referenced report element toggles the job_photos row', async () => {
    seed({
      job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/cc-1.jpg', internal_only: true }],
      daily_reports: [{ id: 'f1', job_id: 'J1', status: 'final', photos: [ref()] }],
    })
    as('pm', 'pm1')
    const r = await call(vis.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/gallery/cc-1.jpg', internal_only: false, fromReport: true, reportId: 'f1' })
    expect(r.status).toBe(200)
    expect(mockState.db.job_photos[0].internal_only).toBe(false)
    expect(reports()[0].photos[0]).toEqual(ref()) // element untouched; its copied flag is ignored
  })

  test('photo-visibility on a dangling reference turns it into a report-only photo with its own flag', async () => {
    seed({ daily_reports: [{ id: 'f1', job_id: 'J1', status: 'final', report_date: '2026-11-09', photos: [ref()] }] })
    as('pm', 'pm1')
    const r = await call(vis.POST, '/api/photo-visibility', 'POST', { jobId: 'J1', path: 'J1/gallery/cc-1.jpg', internal_only: false, fromReport: true, reportId: 'f1' })
    expect(r.status).toBe(200)
    expect(reports()[0].photos[0]).toEqual({ path: 'J1/gallery/cc-1.jpg' })
    expect(ownerPhotoList({ jobId: 'J1', jobPhotos: [], reports: reports() }).map(p => p.path)).toEqual(['J1/gallery/cc-1.jpg'])
  })

  test('Site Photos (commercial / residential / field) read report photos through reportPhotoInternal', () => {
    for (const f of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js', 'app/field/page.js']) {
      expect([f, /fromReport: true, reportId: r\.id, internal_only: reportPhotoInternal\(p, (standalone|standalonePhotos)\)/.test(read(f))]).toEqual([f, true])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('M3) delete-photo: a FINAL report is locked to Owner / admin / PM', () => {
  const client = supabaseModule.createClient()
  beforeAll(() => { client.auth.getUser = async token => ({ data: { user: token ? { id: token, email: `${token}@x.com` } : null }, error: null }) })
  afterAll(() => { delete client.auth.getUser })
  const delAs = (userId, body) => call(del.POST, '/api/delete-photo', 'POST', body, { Authorization: `Bearer ${userId}` })
  const removes = () => mockState.calls.filter(c => c.op === 'remove')
  const final = () => ({ id: 'f1', job_id: 'J1', super_id: 'super1', status: 'final', photos: [{ path: 'J1/1-0-a.jpg' }, { path: 'J1/1-0-b.jpg' }] })

  test('super (even the author) and APM → 403, nothing changed, no storage removed', async () => {
    for (const who of ['super1', 'super2', 'apm1']) {
      seed({ daily_reports: [final()] })
      const r = await delAs(who, { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })
      expect([who, r.status]).toEqual([who, 403])
      expect(r.body.error).toMatch(/finalized/)
      expect(reports()[0].photos).toHaveLength(2)
      expect(removes()).toHaveLength(0)
    }
  })

  test('legacy row with no status counts as final → super 403', async () => {
    seed({ daily_reports: [{ ...final(), status: undefined }] })
    expect((await delAs('super1', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })).status).toBe(403)
  })

  test('PM on the job, admin and principal may change a final report', async () => {
    for (const who of ['pm1', 'admin1', 'p1']) {
      seed({ daily_reports: [final()] })
      const r = await delAs(who, { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })
      expect([who, r.status]).toEqual([who, 200])
      expect(reports()[0].photos).toEqual([{ path: 'J1/1-0-b.jpg' }])
    }
  })

  test('drafts keep the editor rule: author super yes, another super no', async () => {
    seed({ daily_reports: [{ ...final(), status: 'draft' }] })
    expect((await delAs('super2', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })).status).toBe(403)
    expect((await delAs('super1', { jobId: 'J1', path: 'J1/1-0-a.jpg', fromReport: true, reportId: 'f1' })).status).toBe(200)
  })

  test('gallery deletes by a super are unchanged', async () => {
    seed({ job_photos: [{ id: U1, job_id: 'J1', storage_path: 'J1/gallery/9.jpg' }] })
    expect((await delAs('super1', { jobId: 'J1', path: 'J1/gallery/9.jpg' })).status).toBe(200)
    expect(mockState.db.job_photos).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('L1) PATCH merges: omitted fields keep their stored values', () => {
  const stored = () => draft({
    weather: 'Sunny', issues: 'Late truck', crew_log: [{ name: 'Al', company: 'NV', trade: 'Framer', hours: '8' }],
    photos: [{ path: 'J1/1-0-a.jpg', internal_only: true }], visitors: [{ name: 'Inspector', company: 'City' }],
  })

  test('only work_performed sent → everything else unchanged', async () => {
    seed({ daily_reports: [stored()] }); as('super', 'super1')
    const r = await patch({ id: 'd1', work_performed: 'Hung drywall' })
    expect(r.status).toBe(200)
    expect(reports()[0]).toMatchObject({
      work_performed: 'Hung drywall', weather: 'Sunny', issues: 'Late truck', report_date: '2026-11-09', job_id: 'J1', super_id: 'super1', status: 'draft',
    })
    expect(reports()[0].crew_log).toEqual(stored().crew_log)
    expect(reports()[0].photos).toEqual(stored().photos)
    expect(reports()[0].visitors).toEqual(stored().visitors)
    expect(reports()[0].materials_delivered).toEqual(stored().materials_delivered)
  })

  test('a provided key changes, including clearing it', async () => {
    seed({ daily_reports: [stored()] }); as('pm', 'pm1')
    const r = await patch({ id: 'd1', issues: '', photos: [] })
    expect(r.status).toBe(200)
    expect(reports()[0].issues || null).toBeNull()
    expect(reports()[0].photos || []).toEqual([])
    expect(reports()[0].weather).toBe('Sunny')
  })

  test('cannot move the report: job_id mismatch 403; super_id / status in the body are ignored', async () => {
    seed({ daily_reports: [stored()] }); as('super', 'super1')
    expect((await patch({ id: 'd1', job_id: 'J2', work_performed: 'x' })).status).toBe(403)
    const r = await patch({ id: 'd1', super_id: 'super2', status: 'final', finalized_at: '2026-01-01T00:00:00Z' })
    expect(r.status).toBe(200)
    expect(reports()[0]).toMatchObject({ super_id: 'super1', status: 'draft', finalized_at: null })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('L4) reopen before migration 075', () => {
  test('missing status column → 409 JSON naming 075, nothing changed', async () => {
    seed({ daily_reports: [{ id: 'old', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed' }] })
    mockState.missingCols = { daily_reports: ['status', 'finalized_at', 'finalized_by', 'reopened_at', 'reopened_by', 'updated_at'] }
    as('pm', 'pm1')
    const r = await reo('old')
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ migration_required: '075' })
    expect(r.body.error).toMatch(/migration 075/)
    expect(reports()[0].status).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('L7) re-finalize after a reopen', () => {
  test('materials added while reopened become deliveries; existing ones are not duplicated', async () => {
    seed({ daily_reports: [draft()] }); as('super', 'super1')
    expect((await fin('d1')).status).toBe(200)
    expect(deliveries().map(d => d.material)).toEqual(['Studs'])

    as('pm', 'pm1')
    expect((await reo('d1')).status).toBe(200)
    expect(reports()[0].deliveries_created_at).toBeTruthy() // kept through the reopen
    expect((await patch({ id: 'd1', materials_delivered: [studs, drywall] })).status).toBe(200)
    const r = await fin('d1')
    expect(r.status).toBe(200)
    expect(deliveries().map(d => d.material).sort()).toEqual(['Drywall', 'Studs'])
    expect(deliveries().find(d => d.material === 'Drywall')).toMatchObject({ daily_report_id: 'd1', received_date: '2026-11-09', source: 'daily_report' })

    // reopen + finalize again with nothing new → no new rows
    await reo('d1')
    await fin('d1')
    expect(deliveries()).toHaveLength(2)
  })

  test('a material removed while reopened does not delete its delivery (deliveries are history)', async () => {
    seed({ daily_reports: [draft({ materials_delivered: [studs, drywall] })] }); as('pm', 'pm1')
    await fin('d1')
    await reo('d1')
    await patch({ id: 'd1', materials_delivered: [studs] })
    await fin('d1')
    expect(deliveries()).toHaveLength(2)
  })
})
