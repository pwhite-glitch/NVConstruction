/**
 * Prompt 91 — Delete button for daily reports (hard delete, logged).
 * Peyton 11/18: PM / Owner / Supers can delete; supers only reports they wrote; delete
 * permanently, no recovery. All DB / storage access is the in-memory mock; nothing live;
 * migration 078 is only read as text (never applied).
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
    requirePM: async () => (mockState.auth.error ? mockState.auth : PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: () => false,
    PM_ROLES: PM,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const noToken = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const req = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const P = require('../lib/daily-report-payload')
const S = require('../lib/daily-report-server')
const C = require('../lib/daily-report-client')
const { weatherDelayCount, weatherDelayRows } = require('../lib/contract-time')
const route = require('../app/api/daily-reports/route')
const supa = require('@supabase/supabase-js').createClient()

const del = async (id, { query = false } = {}) => {
  const res = await route.DELETE(query ? req(`/api/daily-reports?id=${encodeURIComponent(id)}`, 'DELETE') : req('/api/daily-reports', 'DELETE', { id }))
  return { status: res.status, body: await res.json() }
}

const BUCKET = 'daily-report-photos'
const rpt = (extra = {}) => ({
  id: 'r1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed walls',
  status: 'final', finalized_at: '2026-11-09T22:00:00Z', finalized_by: 'super1', weather_delay: false,
  revision_count: 0, materials_delivered: [], photos: null, ...extra,
})

const seed = (extra = {}) => {
  resetMockState({
    jobs: [{ id: 'J1', pm_email: 'lead@x.com' }, { id: 'J2' }],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' },
      { id: 'a3', job_id: 'J1', user_id: 'super2' }, { id: 'a4', job_id: 'J1', user_id: 'apm1' },
    ],
    profiles: [{ id: 'super1', role: 'super', full_name: 'Sam Super' }, { id: 'super2', role: 'super' }, { id: 'pm1', role: 'pm', full_name: 'Pat PM' }, { id: 'pm9', role: 'pm' }, { id: 'principal1', role: 'principal', full_name: 'Peyton' }, { id: 'apm1', role: 'apm' }],
    daily_reports: [
      rpt(),
      rpt({ id: 'r2', super_id: 'super2', report_date: '2026-11-10', weather_delay: true }),
      rpt({ id: 'r3', job_id: 'J2', super_id: 'super9', report_date: '2026-11-11' }),
      rpt({ id: 'r4', status: 'draft', finalized_at: null, finalized_by: null, report_date: '2026-11-12' }),
    ],
    deliveries: [],
    job_photos: [],
    change_log: [],
    daily_report_versions: [],
    ...extra,
  })
}
const report = id => mockState.db.daily_reports.find(r => r.id === id)

describe('prompt 91 — canDeleteReport', () => {
  const mine = rpt(), theirs = rpt({ super_id: 'super2' })
  test('principal / admin / pm / apm: any report (job access is the route\'s job)', () => {
    for (const role of ['principal', 'admin', 'pm', 'apm']) {
      expect(P.canDeleteReport({ role, userId: 'x' }, theirs)).toBe(true)
      expect(P.canDeleteReport({ role, userId: 'x' }, { ...theirs, status: 'draft' })).toBe(true)
    }
  })
  test('super: only reports they wrote (draft or final)', () => {
    expect(P.canDeleteReport({ role: 'super', userId: 'super1' }, mine)).toBe(true)
    expect(P.canDeleteReport({ role: 'super', userId: 'super1' }, { ...mine, status: 'draft' })).toBe(true)
    expect(P.canDeleteReport({ role: 'super', userId: 'super1' }, theirs)).toBe(false)
    expect(P.canDeleteReport({ role: 'super' }, rpt({ super_id: undefined }))).toBe(false)
    expect(P.canDeleteReport({ role: 'super', userId: 'super1' }, null)).toBe(false)
  })
  test('sub / owner client / sales / anyone else: never, even as the "author"', () => {
    for (const role of ['subcontractor', 'sub', 'owner', 'client', 'sales', undefined, null, '']) {
      expect(P.canDeleteReport({ role, userId: 'super1' }, mine)).toBe(false)
    }
  })
  test('server module re-exports the same function and the 403 text', () => {
    expect(S.canDeleteReport).toBe(P.canDeleteReport)
    expect(S.DELETE_AUTHOR_MESSAGE).toBe("Only the report's author or the office can delete it.")
  })
})

describe('prompt 91 — DELETE /api/daily-reports: who', () => {
  beforeEach(seed)

  test('401 without a token; nothing changes', async () => {
    noToken()
    expect((await del('r1')).status).toBe(401)
    expect(report('r1')).toBeTruthy()
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test.each([['subcontractor'], ['owner'], ['client'], ['sales']])('403 for %s; nothing changes', async role => {
    as(role)
    const r = await del('r1')
    expect(r.status).toBe(403)
    expect(report('r1')).toBeTruthy()
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test('403 for a PM not on the job', async () => {
    as('pm', 'pm9')
    const r = await del('r1')
    expect(r.status).toBe(403)
    expect(report('r1')).toBeTruthy()
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test("403 for a super deleting someone else's report on their job", async () => {
    as('super', 'super1')
    const r = await del('r2')
    expect(r.status).toBe(403)
    expect(r.body.error).toBe("Only the report's author or the office can delete it.")
    expect(report('r2')).toBeTruthy()
    expect(mockState.db.change_log).toHaveLength(0)
  })

  test('403 for a super who wrote the report but is no longer on the job', async () => {
    as('super', 'super9')
    expect((await del('r3')).status).toBe(403)
    expect(report('r3')).toBeTruthy()
  })

  test('200 PM on the job (someone else\'s final)', async () => {
    as('pm', 'pm1')
    const r = await del('r2')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, id: 'r2' })
    expect(report('r2')).toBeUndefined()
  })

  test('200 APM on the job', async () => {
    as('apm', 'apm1')
    expect((await del('r2')).status).toBe(200)
    expect(report('r2')).toBeUndefined()
  })

  test('200 principal on any job (no assignment)', async () => {
    as('principal', 'principal1')
    expect((await del('r3')).status).toBe(200)
    expect(report('r3')).toBeUndefined()
  })

  test('200 super deleting their own final and their own draft (same path)', async () => {
    as('super', 'super1')
    expect((await del('r1')).status).toBe(200)
    expect((await del('r4')).status).toBe(200)
    expect(report('r1')).toBeUndefined()
    expect(report('r4')).toBeUndefined()
  })

  test('404 unknown id; 404 on a second delete of the same id; 400 no id', async () => {
    as('principal', 'principal1')
    expect((await del('nope')).status).toBe(404)
    expect((await del('r1')).status).toBe(200)
    const again = await del('r1')
    expect(again.status).toBe(404)
    expect(again.body.error).toBe('Daily report not found.')
    expect(mockState.db.change_log.filter(e => e.field_name === 'deleted')).toHaveLength(1)
    expect((await del('')).status).toBe(400)
  })

  test('?id= works as well as the JSON body', async () => {
    as('pm', 'pm1')
    expect((await del('r1', { query: true })).status).toBe(200)
    expect(report('r1')).toBeUndefined()
  })
})

describe('prompt 91 — DELETE: log, children, order', () => {
  beforeEach(seed)

  test('change_log row holds the full row snapshot and is written BEFORE the delete', async () => {
    as('super', 'super1')
    const before = JSON.parse(JSON.stringify(report('r1')))
    expect((await del('r1')).status).toBe(200)
    const log = mockState.db.change_log
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      job_id: 'J1', entity_type: 'daily_report', entity_id: 'r1', field_name: 'deleted',
      new_value: null, changed_by: 'super1', changed_by_name: 'Sam Super', note: 'Deleted daily report for 2026-11-09',
    })
    expect(JSON.parse(log[0].old_value)).toEqual(before)
    const i = mockState.calls.findIndex(c => c.table === 'change_log' && c.op === 'insert')
    const j = mockState.calls.findIndex(c => c.table === 'daily_reports' && c.op === 'delete')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(j).toBeGreaterThan(i)
  })

  test('if the change_log entry cannot be written, nothing is deleted (500)', async () => {
    as('pm', 'pm1')
    mockState.failWrite = { change_log: { insert: 'change_log is down' } }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const r = await del('r1')
    spy.mockRestore()
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/nothing was deleted/)
    expect(report('r1')).toBeTruthy()
  })

  test('deliveries are unlinked, not deleted; legacy (no id) deliveries untouched; unlink before delete', async () => {
    seed({
      deliveries: [
        { id: 'd1', job_id: 'J1', source: 'daily_report', daily_report_id: 'r1', received_date: '2026-11-09', material: 'Lumber' },
        { id: 'd2', job_id: 'J1', source: 'daily_report', daily_report_id: 'r1', received_date: '2026-11-09', material: 'Nails' },
        { id: 'd3', job_id: 'J1', source: 'daily_report', daily_report_id: null, received_date: '2026-11-09', material: 'Legacy' },
        { id: 'd4', job_id: 'J1', source: 'daily_report', daily_report_id: 'r2', received_date: '2026-11-10', material: 'Other report' },
      ],
    })
    as('pm', 'pm1')
    const r = await del('r1')
    expect(r.status).toBe(200)
    expect(r.body.deliveries_kept).toBe(3)
    const d = Object.fromEntries(mockState.db.deliveries.map(x => [x.id, x]))
    expect(Object.keys(d).sort()).toEqual(['d1', 'd2', 'd3', 'd4'])
    expect(d.d1.daily_report_id).toBeNull()
    expect(d.d2.daily_report_id).toBeNull()
    expect(d.d3).toMatchObject({ daily_report_id: null, received_date: '2026-11-09', material: 'Legacy' })
    expect(d.d4.daily_report_id).toBe('r2')
    expect(mockState.calls.some(c => c.table === 'deliveries' && c.op === 'delete')).toBe(false)
    const u = mockState.calls.findIndex(c => c.table === 'deliveries' && c.op === 'update')
    const j = mockState.calls.findIndex(c => c.table === 'daily_reports' && c.op === 'delete')
    expect(u).toBeGreaterThanOrEqual(0)
    expect(j).toBeGreaterThan(u)
  })

  test('before 075 (no deliveries.daily_report_id) the delete still works', async () => {
    mockState.missingCols = { deliveries: ['daily_report_id'] }
    as('pm', 'pm1')
    expect((await del('r1')).status).toBe(200)
    expect(report('r1')).toBeUndefined()
  })

  test('only report-only photo files are removed; job_photos rows / files and shared paths are kept', async () => {
    seed({
      job_photos: [{ id: 'jp1', job_id: 'J1', storage_path: 'J1/cc/one.jpg' }, { id: 'jp2', job_id: 'J1', storage_path: 'J1/gallery/two.jpg' }],
    })
    report('r1').photos = [
      { path: 'J1/r1/own.jpg', caption: 'uploaded' },
      { path: 'J1/cc/one.jpg', job_photo_id: 'jp1', source: 'job_photos' },
      { path: 'J1/gallery/two.jpg' }, // no reference flag, but a job_photos row owns the path
      { path: 'J1/shared/three.jpg' }, // also listed on r2
      { path: 'J2/elsewhere.jpg' }, // not this job's folder
    ]
    report('r2').photos = [{ path: 'J1/shared/three.jpg' }]
    for (const p of ['J1/r1/own.jpg', 'J1/r1/own_thumb.jpg', 'J1/cc/one.jpg', 'J1/cc/one_thumb.jpg', 'J1/gallery/two.jpg', 'J1/shared/three.jpg', 'J2/elsewhere.jpg']) mockState.files[`${BUCKET}/${p}`] = Buffer.from('x')
    as('pm', 'pm1')
    const r = await del('r1')
    expect(r.status).toBe(200)
    expect(r.body.files_removed).toBe(1)
    expect(Object.keys(mockState.files).sort()).toEqual([`${BUCKET}/J1/cc/one.jpg`, `${BUCKET}/J1/cc/one_thumb.jpg`, `${BUCKET}/J1/gallery/two.jpg`, `${BUCKET}/J1/shared/three.jpg`, `${BUCKET}/J2/elsewhere.jpg`])
    const removes = mockState.calls.filter(c => c.op === 'remove')
    expect(removes).toEqual([{ table: `storage:${BUCKET}`, op: 'remove', payload: ['J1/r1/own.jpg', 'J1/r1/own_thumb.jpg'] }])
    expect(mockState.db.job_photos.map(p => p.id)).toEqual(['jp1', 'jp2'])
    expect(mockState.calls.some(c => c.table === 'job_photos')).toBe(false)
    // storage removal happens after the row is gone
    const j = mockState.calls.findIndex(c => c.table === 'daily_reports' && c.op === 'delete')
    expect(mockState.calls.findIndex(c => c.op === 'remove')).toBeGreaterThan(j)
  })

  test('a storage error does not fail the delete (logged, warning returned)', async () => {
    report('r1').photos = [{ path: 'J1/r1/own.jpg' }]
    const orig = supa.storage.from
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    supa.storage.from = b => ({ ...orig(b), remove: async () => ({ data: null, error: { message: 'storage down' } }) })
    try {
      as('pm', 'pm1')
      const r = await del('r1')
      expect(r.status).toBe(200)
      expect(r.body.warning).toMatch(/photo files could not be removed/)
      expect(report('r1')).toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      supa.storage.from = orig
      spy.mockRestore()
    }
  })

  test('weather-delay count drops after the delete (computed live from rows)', async () => {
    const before = weatherDelayCount(mockState.db.daily_reports)
    expect(before).toBe(1)
    expect(weatherDelayRows(mockState.db.daily_reports).map(r => r.id)).toEqual(['r2'])
    as('pm', 'pm1')
    expect((await del('r2')).status).toBe(200)
    expect(weatherDelayCount(mockState.db.daily_reports)).toBe(0)
    expect(weatherDelayRows(mockState.db.daily_reports)).toEqual([])
  })

  test('daily_report_versions go with the report (076 ON DELETE CASCADE); no soft-delete column', () => {
    const sql076 = read('migrations/076_daily_report_versions.sql')
    expect(sql076).toMatch(/daily_report_id\s+uuid NOT NULL REFERENCES public\.daily_reports\(id\) ON DELETE CASCADE/)
    const src = read('app/api/daily-reports/route.js')
    expect(src).toMatch(/076: ON DELETE CASCADE/)
    expect(src).toMatch(/from\('daily_reports'\)\.delete\(\)\.eq\('id', report\.id\)/)
    expect(src).not.toMatch(/deleted_at/)
    // contract time / weather-day PDF use the live rows, no stored count
    expect(read('lib/contract-time.js')).toMatch(/export function weatherDelayCount\(reports = \[\]\)/)
    expect(read('lib/weather-day-log-print.js')).toMatch(/weatherDelayRows\(reports/)
  })
})

describe('prompt 91 — client helper + confirm', () => {
  test('deleteDailyReport sends DELETE { id } and throws the API error text', async () => {
    const calls = []
    const ok = async (url, opts) => { calls.push({ url, ...opts }); return { ok: true, status: 200, json: async () => ({ ok: true, id: 'r1' }) } }
    await expect(C.deleteDailyReport(ok, 'r1')).resolves.toMatchObject({ ok: true, id: 'r1' })
    expect(calls[0]).toMatchObject({ url: '/api/daily-reports', method: 'DELETE', body: JSON.stringify({ id: 'r1' }) })
    const refused = async () => ({ ok: false, status: 403, json: async () => ({ error: "Only the report's author or the office can delete it." }) })
    await expect(C.deleteDailyReport(refused, 'r2')).rejects.toThrow("Only the report's author or the office can delete it.")
    const blank = async () => ({ ok: false, status: 500, json: async () => ({}) })
    await expect(C.deleteDailyReport(blank, 'r2')).rejects.toThrow('Could not delete the daily report (server returned 500).')
  })

  test('confirm text, with and without linked deliveries', () => {
    const r = rpt({ report_date: '2026-11-09' })
    expect(C.deleteReportConfirm(r, 0)).toBe("Delete the daily report for Mon, Nov 9, 2026? This can't be undone. It will disappear from the job, the owner view and the weather-delay count.")
    expect(C.deleteReportConfirm(r, 3)).toBe("Delete the daily report for Mon, Nov 9, 2026? This can't be undone. It will disappear from the job, the owner view and the weather-delay count. This report logged 3 material deliveries; they will be kept.")
    expect(C.deleteReportConfirm(r, 1)).toMatch(/logged 1 material delivery; they will be kept\.$/)
  })

  test('reportDeliveryCount: linked by id, or legacy by date on the same job', () => {
    const r = rpt()
    const ds = [
      { daily_report_id: 'r1' }, { daily_report_id: null, source: 'daily_report', job_id: 'J1', received_date: '2026-11-09' },
      { daily_report_id: null, source: 'manual', job_id: 'J1', received_date: '2026-11-09' }, { daily_report_id: 'r2' },
      { daily_report_id: null, source: 'daily_report', job_id: 'J1', received_date: '2026-11-10' },
    ]
    expect(P.reportDeliveryCount(r, ds)).toBe(2)
    expect(P.reportDeliveryCount(r, null)).toBe(0)
  })

  test('history view: deleted-report entries are recognised and their snapshot parsed', () => {
    const e = { entity_type: 'daily_report', field_name: 'deleted', old_value: JSON.stringify(rpt()) }
    expect(P.isDeletedReportLogEntry(e)).toBe(true)
    expect(P.deletedReportSnapshot(e)).toMatchObject({ id: 'r1', report_date: '2026-11-09' })
    expect(P.deletedReportSnapshot({ ...e, old_value: 'not json' })).toBeNull()
    expect(P.isDeletedReportLogEntry({ entity_type: 'daily_report', field_name: 'status' })).toBe(false)
  })
})

describe('prompt 91 — UI wiring (source)', () => {
  const job = read('app/jobdetail/page.js')
  const res = read('app/residentialjobdetail/page.js')
  const field = read('app/field/page.js')

  test('job pages: red Delete next to Reopen, gated by canDeleteReport, refresh after delete', () => {
    for (const src of [job, res]) {
      expect(src).toMatch(/canDeleteReport\(\{ role: userRole, userId: fieldUserId \}, r\) && !inPreview/)
      expect(src).toMatch(/deleteDailyReport\(authFetch, r\.id\)/)
      expect(src).toMatch(/window\.confirm\(deleteReportConfirm\(r, /)
      expect(src).toMatch(/await loadFieldData\(\)/)
      expect(src).toMatch(/catch \(err\) \{ alert\(err\.message\) \}/)
      expect(src.indexOf('DELETE_BUTTON')).toBeGreaterThan(-1)
    }
  })

  test('job page history renders deleted daily_report entries (dot colour + snapshot summary)', () => {
    expect(job).toMatch(/daily_report: '#0891b2'/)
    expect(job).toMatch(/isDeletedReportLogEntry\(entry\) \?/)
    expect(job).toMatch(/deletedReportSnapshot\(entry\)/)
  })

  test('field app: Delete on past reports and in the open report, clears the form when the open one is deleted', () => {
    expect(field).toMatch(/canDeleteReport\(myReportAuth\(\), r\) && !isPreviewActive\(\)/)
    expect(field).toMatch(/canDeleteReport\(myReportAuth\(\), open\)/)
    const fn = field.slice(field.indexOf('async function deleteReport(r)'), field.indexOf('const myReportAuth'))
    expect(fn).toMatch(/editingReportId === r\.id \|\| savedReportIdRef\.current === r\.id\) \{ resetDailyWizard\(\)/)
    expect(fn).toMatch(/await loadDailyReports\(\)/)
    expect(fn).toMatch(/alert\(err\.message\)/)
  })

  test('44px tap targets on the Delete button', () => {
    expect(C.DELETE_BUTTON.minHeight).toBe('44px')
    expect(C.DELETE_BUTTON.color).toBe('#dc2626')
  })
})

describe('prompt 91 — migration 078 (PROPOSED, not applied)', () => {
  const sql = read('migrations/078_daily_report_delete_rls.sql')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  test('header: proposed, not applied, apply only when Peyton names it; has ROLLBACK', () => {
    expect(sql).toMatch(/STATUS: PROPOSED — written, NOT applied/)
    expect(sql).toMatch(/Apply only after Peyton names it/)
    expect(sql).toMatch(/ROLLBACK/)
    expect(sql).toMatch(/--\s+CREATE POLICY daily_reports_delete_own_draft/)
  })

  test('drops the browser delete policy and creates no other DELETE policy', () => {
    expect(code).toMatch(/DROP POLICY IF EXISTS daily_reports_delete_own_draft ON public\.daily_reports;/)
    expect(code).not.toMatch(/FOR DELETE/)
  })

  test('finals only for staff on the job; drafts keep 075 rules; idempotent', () => {
    expect(code).toMatch(/status = 'final' AND public\.daily_report_staff_job_access\(job_id::text\)/)
    expect(code).toMatch(/status = 'draft' AND \(super_id = auth\.uid\(\) OR public\.daily_report_draft_access\(job_id::text\)\)/)
    expect(code).toMatch(/WHEN public\.get_my_role\(\) IN \('principal', 'admin'\) THEN true/)
    expect(code).toMatch(/WHEN public\.get_my_role\(\) IN \('pm', 'apm', 'super'\)/)
    expect(code).toMatch(/pm_job_assignments/)
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.daily_report_staff_job_access/)
    expect(code).toMatch(/DROP POLICY IF EXISTS daily_reports_select_final_or_allowed_drafts/)
    expect(code).toMatch(/DROP POLICY IF EXISTS daily_reports_select_staff_final_or_allowed_drafts/)
    expect(code).not.toMatch(/USING \(\s*status = 'final'\s*OR/)
  })

  test('075 is unchanged and no code depends on 078', () => {
    expect(read('migrations/075_daily_report_drafts.sql')).toMatch(/CREATE POLICY daily_reports_delete_own_draft/)
    const files = ['app/api/daily-reports/route.js', 'lib/daily-report-server.js', 'lib/daily-report-payload.js', 'lib/daily-report-client.js', 'app/field/page.js', 'app/jobdetail/page.js', 'app/residentialjobdetail/page.js']
    for (const f of files) expect(read(f)).not.toMatch(/daily_report_staff_job_access|\b078\b/)
  })
})
