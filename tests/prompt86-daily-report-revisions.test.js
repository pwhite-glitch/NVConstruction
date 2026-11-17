/**
 * Prompt 86 — Daily reports: keep the revision history when a final report is reopened.
 * Migration 076 (NOT applied) adds a BEFORE INSERT/UPDATE trigger that snapshots the final row
 * into daily_report_versions in the same statement as the reopen, keeps first_finalized_* and
 * counts revisions. Here a JS stand-in mirrors that trigger (mockState.triggers.daily_reports).
 * All DB access is the in-memory mock; nothing live.
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
const asAnon = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json(), headers: res.headers }
}

const P = require('../lib/daily-report-payload')
const { ownerPhotoList } = require('../lib/owner-photos')
const { REOPEN_076_MESSAGE } = require('../lib/daily-report-server')
const route = require('../app/api/daily-reports/route')
const finalize = require('../app/api/daily-reports/finalize/route')
const reopen = require('../app/api/daily-reports/reopen/route')
const versionsRoute = require('../app/api/daily-reports/versions/route')

const fin = id => call(finalize.POST, '/api/daily-reports/finalize', 'POST', { id })
const reo = id => call(reopen.POST, '/api/daily-reports/reopen', 'POST', { id })
const patch = body => call(route.PATCH, '/api/daily-reports', 'PATCH', body)
const post = body => call(route.POST, '/api/daily-reports', 'POST', body)
const getVersions = (qs) => call(versionsRoute.GET, `/api/daily-reports/versions?${qs}`, 'GET')

const studs = { description: 'Studs', quantity: '200', supplier: 'Lowes' }
const drywall = { description: 'Drywall', quantity: '40', supplier: 'HD' }
const crew = [{ name: 'Ann', company: 'NV', trade: 'Carp', hours: '8' }]
const photos = [{ path: 'J1/a.jpg', caption: 'North wall' }]

// JS stand-in for 076's daily_reports_revision_guard (mirrors the SQL).
function revisionGuard({ op, payload, rows }) {
  if (mockState.failSnapshot && op === 'update' && rows.some(r => r.status === 'final') && payload.status === 'draft') {
    return { message: 'insert into daily_report_versions failed', code: '23505' }
  }
  if (op === 'insert') {
    for (const r of rows) {
      if (r.status === 'final') { r.first_finalized_at = r.finalized_at; r.first_finalized_by = r.finalized_by } else { r.first_finalized_at = null; r.first_finalized_by = null }
      r.revision_count = 0
      r.revised_by_name = null
      r.reopened_at = null
      r.reopened_by = null
    }
    return null
  }
  if (op !== 'update') return null
  const without = (o, ...ks) => { const c = { ...o }; for (const k of ['updated_at', ...ks]) delete c[k]; return JSON.stringify(c, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x)) }
  // value → NULL of an FK column with nothing else changing (the ON DELETE SET NULL action).
  const riNullOut = (OLD, NEW, col) => OLD[col] != null && NEW[col] == null && without(NEW, col) === without(OLD, col)
  for (const OLD of rows) {
    const NEW = { ...OLD, ...payload }
    const isReopen = OLD.status === 'final' && NEW.status === 'draft'
    const nullFirstBy = riNullOut(OLD, NEW, 'first_finalized_by')
    const nullReopenedBy = riNullOut(OLD, NEW, 'reopened_by')
    if (OLD.first_finalized_at != null) {
      NEW.first_finalized_at = OLD.first_finalized_at
      if (!nullFirstBy) NEW.first_finalized_by = OLD.first_finalized_by
    } else if (NEW.status === 'final') { NEW.first_finalized_at = NEW.finalized_at; NEW.first_finalized_by = NEW.finalized_by } else { NEW.first_finalized_at = null; NEW.first_finalized_by = null }
    NEW.revision_count = OLD.revision_count || 0
    NEW.revised_by_name = OLD.revised_by_name ?? null
    if (isReopen) NEW.reopened_at = NEW.reopened_at || new Date().toISOString()
    else {
      NEW.reopened_at = OLD.reopened_at ?? null
      if (!nullReopenedBy) NEW.reopened_by = OLD.reopened_by ?? null
    }
    if (isReopen) {
      const v = mockState.db.daily_report_versions = mockState.db.daily_report_versions || []
      if (v.some(x => x.daily_report_id === OLD.id && x.rev_number === (OLD.revision_count || 0))) return { message: 'duplicate key value violates unique constraint', code: '23505' }
      v.push({ id: `v-${v.length + 1}`, daily_report_id: OLD.id, rev_number: OLD.revision_count || 0, snapshot: JSON.parse(JSON.stringify(OLD)), finalized_at: OLD.finalized_at, finalized_by: OLD.finalized_by, reopened_at: NEW.reopened_at, reopened_by: NEW.reopened_by, created_at: new Date().toISOString() })
    }
    if (OLD.status === 'draft' && NEW.status === 'final' && OLD.reopened_at != null) {
      NEW.revision_count = (OLD.revision_count || 0) + 1
      const prof = (mockState.db.profiles || []).find(p => p.id === NEW.finalized_by)
      NEW.revised_by_name = prof?.full_name?.trim() || null
    }
    // BEFORE trigger: NEW is what gets written.
    for (const k of TRIGGER_OWNED) payload[k] = NEW[k]
  }
  return null
}
const TRIGGER_OWNED = ['first_finalized_at', 'first_finalized_by', 'revision_count', 'revised_by_name', 'reopened_at', 'reopened_by']

const seed = (extra = {}) => {
  resetMockState({
    jobs: [{ id: 'J1', pm_email: 'lead@x.com' }, { id: 'J2' }],
    pm_job_assignments: [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' }, { id: 'a3', job_id: 'J1', user_id: 'apm1' }],
    profiles: [{ id: 'super1', role: 'super', full_name: 'Sam Super' }, { id: 'pm1', role: 'pm', full_name: 'Pat PM' }, { id: 'apm1', role: 'apm' }, { id: 'admin1', role: 'admin', full_name: 'Ada Admin' }, { id: 'p1', role: 'principal', full_name: 'Peyton' }],
    daily_reports: [],
    deliveries: [],
    change_log: [],
    daily_report_versions: [],
    ...extra,
  })
  mockState.triggers.daily_reports = revisionGuard
  mockState.failSnapshot = false
}
const reports = () => mockState.db.daily_reports
const versions = () => mockState.db.daily_report_versions || []
const logs = () => mockState.db.change_log || []
// A post-076 final row (as 076's backfill / trigger leave it).
const final = (extra = {}) => ({
  id: 'd1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed', weather: 'Clear',
  status: 'final', finalized_at: '2026-11-09T22:00:00Z', finalized_by: 'super1', reopened_at: null, reopened_by: null,
  first_finalized_at: '2026-11-09T22:00:00Z', first_finalized_by: 'super1', revision_count: 0, revised_by_name: null,
  deliveries_created_at: '2026-11-09T22:00:01Z', crew_log: crew, materials_delivered: [studs], photos, ...extra,
})

afterAll(() => { delete mockState.failSnapshot })

// ─────────────────────────────────────────────────────────────────────────────
describe('1) reopen writes exactly one snapshot', () => {
  test('rev 0 = the full prior final row; finalize stamps copied; reopened_by = caller; report is a draft', async () => {
    seed({ daily_reports: [final()] }); as('pm', 'pm1')
    const before = JSON.parse(JSON.stringify(reports()[0]))
    const r = await reo('d1')
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'draft', finalized_at: null, finalized_by: null, reopened_by: 'pm1' })
    expect(versions()).toHaveLength(1)
    const v = versions()[0]
    expect(v).toMatchObject({ daily_report_id: 'd1', rev_number: 0, finalized_at: '2026-11-09T22:00:00Z', finalized_by: 'super1', reopened_by: 'pm1' })
    expect(v.snapshot).toEqual(before)
    expect(v.snapshot.photos).toEqual(photos)
    expect(v.snapshot.crew_log).toEqual(crew)
    expect(v.snapshot.materials_delivered).toEqual([studs])
    expect(reports()[0].status).toBe('draft')
    expect(reports()[0].first_finalized_at).toBe('2026-11-09T22:00:00Z')
  })
})

describe('2) reopen fails when the snapshot fails', () => {
  test('trigger error → 500, still final, no version, no status log', async () => {
    seed({ daily_reports: [final()] }); as('pm', 'pm1')
    mockState.failSnapshot = true
    const r = await reo('d1')
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/earlier version could not be saved, so nothing was changed/)
    expect(reports()[0].status).toBe('final')
    expect(reports()[0].finalized_at).toBe('2026-11-09T22:00:00Z')
    expect(versions()).toHaveLength(0)
    expect(logs().filter(l => l.field_name === 'status')).toHaveLength(0)
  })

  test('a change_log failure does not undo the reopen or its snapshot', async () => {
    seed({ daily_reports: [final()] }); as('pm', 'pm1')
    mockState.failWrite = { change_log: { insert: 'change_log down' } }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const r = await reo('d1')
    spy.mockRestore()
    expect(r.status).toBe(200)
    expect(versions()).toHaveLength(1)
    expect(reports()[0].status).toBe('draft')
  })
})

describe('3) reopen before 076', () => {
  test('row without revision_count → 409 migration_required 076, no update written', async () => {
    const { first_finalized_at, first_finalized_by, revision_count, revised_by_name, ...pre076 } = final()
    seed({ daily_reports: [pre076] }); mockState.triggers = {}; as('pm', 'pm1')
    const r = await reo('d1')
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ error: REOPEN_076_MESSAGE, migration_required: '076' })
    expect(mockState.calls.filter(c => c.table === 'daily_reports' && c.op === 'update')).toHaveLength(0)
    expect(reports()[0].status).toBe('final')
  })

  test('before 076 save draft / PATCH / finalize keep working', async () => {
    seed(); mockState.triggers = {}; as('super', 'super1')
    const created = await post({ job_id: 'J1', report_date: '2026-11-10', work_performed: '' })
    expect(created.status).toBe(200)
    expect((await patch({ id: created.body.report.id, work_performed: 'Done' })).status).toBe(200)
    expect((await fin(created.body.report.id)).status).toBe(200)
    expect(logs()).toHaveLength(0)
  })
})

describe('4) reopen → edit → re-finalize, twice', () => {
  test('first_finalized_* keep the original; revision_count 0→1→2; versions rev 0 and rev 1; revised_by_name set', async () => {
    seed({ daily_reports: [final()] })
    as('pm', 'pm1'); expect((await reo('d1')).status).toBe(200)
    expect((await patch({ id: 'd1', work_performed: 'Framed + sheathed' })).status).toBe(200)
    let f = await fin('d1')
    expect(f.status).toBe(200)
    expect(f.body.report).toMatchObject({ status: 'final', finalized_by: 'pm1', revision_count: 1, revised_by_name: 'Pat PM' })
    expect(reports()[0]).toMatchObject({ first_finalized_at: '2026-11-09T22:00:00Z', first_finalized_by: 'super1' })

    as('admin', 'admin1'); expect((await reo('d1')).status).toBe(200)
    f = await fin('d1')
    expect(f.body.report).toMatchObject({ revision_count: 2, revised_by_name: 'Ada Admin', first_finalized_at: '2026-11-09T22:00:00Z', first_finalized_by: 'super1' })
    expect(versions().map(v => v.rev_number)).toEqual([0, 1])
    expect(versions()[0].snapshot.work_performed).toBe('Framed')
    expect(versions()[1].snapshot.work_performed).toBe('Framed + sheathed')
    expect(versions()[1].finalized_by).toBe('pm1')
  })

  test('a never-reopened draft finalized does not count as a revision', async () => {
    seed({ daily_reports: [final({ status: 'draft', finalized_at: null, finalized_by: null, first_finalized_at: null, first_finalized_by: null })] })
    as('super', 'super1')
    const f = await fin('d1')
    expect(f.body.report).toMatchObject({ revision_count: 0, first_finalized_by: 'super1' })
    expect(f.body.report.first_finalized_at).toBe(f.body.report.finalized_at)
  })
})

describe('5) change_log', () => {
  test('PATCH on a reopened report logs only changed fields (arrays as JSON); reopen / re-finalize log status', async () => {
    seed({ daily_reports: [final()] }); as('pm', 'pm1')
    await reo('d1')
    expect(logs()).toHaveLength(1)
    expect(logs()[0]).toMatchObject({ job_id: 'J1', entity_type: 'daily_report', entity_id: 'd1', field_name: 'status', old_value: 'final', new_value: 'draft', changed_by: 'pm1', changed_by_name: 'Pat PM' })
    expect(logs()[0].note).toBe('Reopened the final report for 2026-11-09; saved as version rev 0')

    // weather unchanged, crew unchanged, materials + work changed
    expect((await patch({ id: 'd1', weather: 'Clear', crew_log: crew, work_performed: 'Fixed', materials_delivered: [studs, drywall] })).status).toBe(200)
    const edits = logs().slice(1)
    expect(edits.map(l => l.field_name).sort()).toEqual(['materials_delivered', 'work_performed'])
    const mat = edits.find(l => l.field_name === 'materials_delivered')
    expect(mat).toMatchObject({ entity_type: 'daily_report', old_value: JSON.stringify([studs]), new_value: JSON.stringify([studs, drywall]), note: 'Edited reopened report for 2026-11-09' })
    expect(edits.find(l => l.field_name === 'work_performed')).toMatchObject({ old_value: 'Framed', new_value: 'Fixed' })

    await fin('d1')
    const last = logs()[logs().length - 1]
    expect(last).toMatchObject({ entity_type: 'daily_report', field_name: 'status', old_value: 'draft', new_value: 'final', note: 'Re-finalized the report for 2026-11-09 (rev 1)' })
  })

  test('PATCH on a never-finalized draft logs nothing; first finalize logs nothing', async () => {
    seed({ daily_reports: [final({ status: 'draft', finalized_at: null, finalized_by: null, first_finalized_at: null, first_finalized_by: null })] })
    as('super', 'super1')
    expect((await patch({ id: 'd1', work_performed: 'Changed' })).status).toBe(200)
    expect((await fin('d1')).status).toBe(200)
    expect(logs()).toHaveLength(0)
  })

  test('changedFields truncates long values to 4000 chars + …', () => {
    const long = 'x'.repeat(5000)
    const [c] = P.changedFields({ work_performed: 'a' }, { work_performed: long, updated_at: 'ignored' })
    expect(c.field).toBe('work_performed')
    expect(c.new_value).toHaveLength(4001)
    expect(c.new_value.endsWith('…')).toBe(true)
    expect(P.changedFields({ weather: null }, { weather: undefined })).toEqual([])
    expect(P.changedFields({ crew_count: 3 }, { crew_count: 4 })).toEqual([{ field: 'crew_count', old_value: 3, new_value: 4 }])
  })
})

describe('6) clients cannot set the trigger-owned columns', () => {
  const sneaky = { first_finalized_at: '2020-01-01T00:00:00Z', first_finalized_by: 'evil', revision_count: 99, revised_by_name: 'Evil' }
  test('POST and PATCH payloads never carry them', async () => {
    seed(); mockState.triggers = {}; as('super', 'super1')
    const created = await post({ job_id: 'J1', report_date: '2026-11-10', work_performed: 'x', finalize: true, ...sneaky })
    expect(created.status).toBe(200)
    const draft = await post({ job_id: 'J1', report_date: '2026-11-11', work_performed: 'x', ...sneaky })
    expect((await patch({ id: draft.body.report.id, work_performed: 'y', ...sneaky })).status).toBe(200)
    const writes = mockState.calls.filter(c => c.table === 'daily_reports')
    expect(writes.length).toBeGreaterThanOrEqual(3)
    for (const w of writes) for (const k of Object.keys(sneaky)) expect([w.op, k, Object.prototype.hasOwnProperty.call(w.payload || {}, k)]).toEqual([w.op, k, false])
  })
  test('pure builders drop them too', () => {
    const row = P.buildDailyReportRow({ authUserId: 'u', body: { job_id: 'J1', report_date: '2026-11-10', work_performed: 'x', ...sneaky } })
    const dp = P.buildDraftPatch({ job_id: 'J1', report_date: '2026-11-10', ...sneaky })
    for (const k of Object.keys(sneaky)) { expect(row).not.toHaveProperty(k); expect(dp).not.toHaveProperty(k) }
  })
})

describe('7) GET /api/daily-reports/versions', () => {
  const seedVersions = (n = 3) => {
    seed({ daily_reports: [final({ revision_count: n })] })
    // stored newest first (the mock does not sort; the route orders rev_number desc)
    mockState.db.daily_report_versions = Array.from({ length: n }, (_, i) => n - 1 - i).map(rev => ({
      id: `v${rev}`, daily_report_id: 'd1', rev_number: rev, snapshot: { ...final(), work_performed: `rev ${rev}` },
      finalized_at: '2026-11-09T22:00:00Z', finalized_by: 'super1', reopened_at: '2026-11-10T15:00:00Z', reopened_by: 'pm1', created_at: '2026-11-10T15:00:00Z',
    }))
  }

  test('role gates: super / apm / owner / sub 403; anon 401; pm not on job 403', async () => {
    seedVersions()
    for (const [role, id] of [['super', 'super1'], ['apm', 'apm1'], ['owner', 'owner1'], ['sub', 'sub1']]) {
      as(role, id)
      expect([role, (await getVersions('report_id=d1')).status]).toEqual([role, 403])
    }
    asAnon(); expect((await getVersions('report_id=d1')).status).toBe(401)
    as('pm', 'pm9'); expect((await getVersions('report_id=d1')).status).toBe(403)
  })

  test('pm on the job / principal / admin → 200, paged, rev desc, no-store, no signed URLs', async () => {
    seedVersions(3)
    for (const [role, id] of [['pm', 'pm1'], ['principal', 'p1'], ['admin', 'admin1']]) {
      as(role, id)
      const r = await getVersions('report_id=d1')
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.body).toMatchObject({ total: 3, limit: 20, offset: 0, has_more: false })
      expect(r.body.versions.map(v => v.rev_number)).toEqual([2, 1, 0])
      expect(JSON.stringify(r.body)).not.toMatch(/signed|https?:\/\//i)
    }
    as('pm', 'pm1')
    let r = await getVersions('report_id=d1&limit=2&offset=0')
    expect(r.body).toMatchObject({ total: 3, limit: 2, offset: 0, has_more: true })
    expect(r.body.versions).toHaveLength(2)
    r = await getVersions('report_id=d1&limit=2&offset=2')
    expect(r.body).toMatchObject({ has_more: false })
    expect(r.body.versions.map(v => v.rev_number)).toEqual([0])
    expect((await getVersions('report_id=d1&limit=999')).body.limit).toBe(50)
    expect((await getVersions('report_id=d1&limit=0&offset=-4')).body).toMatchObject({ limit: 1, offset: 0 })
    expect((await getVersions('report_id=d1&limit=abc')).body.limit).toBe(20)
  })

  test('missing report 404; missing id 400; missing table → 200 migration_required; other error → 500', async () => {
    seedVersions(); as('pm', 'pm1')
    expect((await getVersions('report_id=zzz')).status).toBe(404)
    expect((await getVersions('')).status).toBe(400)
    mockState.failSelect = { daily_report_versions: 'relation "public.daily_report_versions" does not exist' }
    let r = await getVersions('report_id=d1')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ versions: [], total: 0, has_more: false, migration_required: '076' })
    mockState.failSelect = { daily_report_versions: 'timeout' }
    r = await getVersions('report_id=d1')
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/timeout/)
  })
})

describe('8) labels', () => {
  test('revisionLabel', () => {
    expect(P.revisionLabel(null)).toBeNull()
    expect(P.revisionLabel({ revision_count: 0, finalized_at: '2026-11-17T03:30:00Z' })).toBeNull()
    expect(P.revisionLabel({ finalized_at: '2026-11-17T03:30:00Z' })).toBeNull()
    // 03:30 UTC Nov 17 = 9:30 PM Central Nov 16
    expect(P.revisionLabel({ revision_count: 1, finalized_at: '2026-11-17T03:30:00Z', revised_by_name: 'Pat PM' })).toBe('Revised Nov 16, 2026 by Pat PM (rev 1)')
    expect(P.revisionLabel({ revision_count: 2, finalized_at: '2026-11-17T03:30:00Z', revised_by_name: ' ' })).toBe('Revised Nov 16, 2026 (rev 2)')
    expect(P.revisionLabel({ revision_count: 2, finalized_at: '2026-11-17T03:30:00Z' })).toBe('Revised Nov 16, 2026 (rev 2)')
  })
  test('has076', () => {
    expect(P.has076({ revision_count: 0 })).toBe(true)
    expect(P.has076({ status: 'final' })).toBe(false)
    expect(P.has076(null)).toBe(false)
  })
  test('ownerPhotoList carries revised (null when not revised)', () => {
    const list = ownerPhotoList({ jobId: 'J1', reports: [
      final({ id: 'a', photos: [{ path: 'J1/a.jpg' }], revision_count: 1, finalized_at: '2026-11-17T03:30:00Z', revised_by_name: 'Pat PM' }),
      final({ id: 'b', report_date: '2026-11-08', photos: [{ path: 'J1/b.jpg' }] }),
    ] })
    expect(list.find(p => p.path === 'J1/a.jpg').revised).toBe('Revised Nov 16, 2026 by Pat PM (rev 1)')
    expect(list.find(p => p.path === 'J1/b.jpg').revised).toBeNull()
  })
  test('canViewReportVersions', () => {
    for (const r of ['principal', 'admin', 'pm']) expect(P.canViewReportVersions(r)).toBe(true)
    for (const r of ['apm', 'super', 'owner', 'sub', undefined]) expect(P.canViewReportVersions(r)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// prompt86-leftover: review findings 1-4 and 6.
describe('10) review leftovers', () => {
  // A direct table client, like the browser's anon-key client or the FK's RI action (RLS is
  // not modelled by the mock; the trigger is).
  const direct = () => require('@supabase/supabase-js').createClient('http://x', 'k')
  const rowOf = id => reports().find(r => r.id === id)

  test('finding 1: FK ON DELETE SET NULL — first_finalized_by / reopened_by alone → NULL is honoured', async () => {
    seed({ daily_reports: [final({ status: 'draft', finalized_at: null, finalized_by: null, reopened_at: '2026-11-10T15:00:00Z', reopened_by: 'pm1', revision_count: 1, revised_by_name: 'Pat PM' })] })
    const db = direct()
    expect((await db.from('daily_reports').update({ first_finalized_by: null }).eq('first_finalized_by', 'super1')).error).toBeNull()
    expect(rowOf('d1')).toMatchObject({ first_finalized_by: null, first_finalized_at: '2026-11-09T22:00:00Z' })
    expect((await db.from('daily_reports').update({ reopened_by: null }).eq('reopened_by', 'pm1')).error).toBeNull()
    expect(rowOf('d1')).toMatchObject({ reopened_by: null, reopened_at: '2026-11-10T15:00:00Z', revision_count: 1 })
  })

  test('finding 1: but NULL → value, value → other value, or NULL-ing alongside other changes is refused', async () => {
    seed({ daily_reports: [final()] })
    const db = direct()
    await db.from('daily_reports').update({ first_finalized_by: 'evil' }).eq('id', 'd1')
    expect(rowOf('d1').first_finalized_by).toBe('super1')
    await db.from('daily_reports').update({ first_finalized_by: null, work_performed: 'x' }).eq('id', 'd1')
    expect(rowOf('d1').first_finalized_by).toBe('super1')
    await db.from('daily_reports').update({ first_finalized_at: null }).eq('id', 'd1')
    expect(rowOf('d1').first_finalized_at).toBe('2026-11-09T22:00:00Z')
    // first_finalized_by already NULL (backfilled pre-076 reopen) stays NULL
    seed({ daily_reports: [final({ first_finalized_by: null })] })
    await direct().from('daily_reports').update({ first_finalized_by: 'evil' }).eq('id', 'd1')
    expect(rowOf('d1').first_finalized_by).toBeNull()
  })

  test('finding 2: a direct UPDATE of a never-finalized draft cannot forge the trigger-owned columns', async () => {
    const draft = final({ status: 'draft', finalized_at: null, finalized_by: null, first_finalized_at: null, first_finalized_by: null })
    seed({ daily_reports: [draft] })
    await direct().from('daily_reports').update({
      work_performed: 'edited', first_finalized_at: '2020-01-01T00:00:00Z', first_finalized_by: 'evil',
      revision_count: 99, revised_by_name: '<b>Evil</b>', reopened_at: '2026-01-01T00:00:00Z', reopened_by: 'evil',
    }).eq('id', 'd1')
    expect(rowOf('d1')).toMatchObject({ work_performed: 'edited', first_finalized_at: null, first_finalized_by: null, revision_count: 0, revised_by_name: null, reopened_at: null, reopened_by: null })
    // the later API finalize is a FIRST finalize, not a revision, stamped with the real values
    as('super', 'super1')
    const f = await fin('d1')
    expect(f.body.report).toMatchObject({ revision_count: 0, revised_by_name: null, first_finalized_by: 'super1' })
    expect(f.body.report.first_finalized_at).toBe(f.body.report.finalized_at)
    expect(P.revisionLabel(f.body.report)).toBeNull()
    expect(versions()).toHaveLength(0)
  })

  test('finding 2: revision_count cannot go up or down outside a re-finalize; reopen still stamps reopened_*', async () => {
    seed({ daily_reports: [final({ revision_count: 2, revised_by_name: 'Pat PM' })] })
    await direct().from('daily_reports').update({ revision_count: 5, revised_by_name: 'X' }).eq('id', 'd1')
    expect(rowOf('d1')).toMatchObject({ revision_count: 2, revised_by_name: 'Pat PM' })
    await direct().from('daily_reports').update({ revision_count: 0 }).eq('id', 'd1')
    expect(rowOf('d1').revision_count).toBe(2)
    as('pm', 'pm1')
    expect((await reo('d1')).status).toBe(200)
    expect(rowOf('d1').reopened_by).toBe('pm1')
    expect(rowOf('d1').reopened_at).toBeTruthy()
    expect(versions().map(v => v.rev_number)).toEqual([2])
  })

  test('finding 3: a direct INSERT cannot pre-set reopened_* (no fake re-finalize)', async () => {
    seed()
    const { error } = await direct().from('daily_reports').insert({
      id: 'd9', job_id: 'J1', super_id: 'super1', report_date: '2026-11-12', work_performed: 'Poured', status: 'draft', finalized_at: null, finalized_by: null,
      reopened_at: '2026-01-01T00:00:00Z', reopened_by: 'pm1', first_finalized_at: '2020-01-01T00:00:00Z', first_finalized_by: 'evil', revision_count: 7, revised_by_name: 'Evil',
    })
    expect(error).toBeNull()
    expect(rowOf('d9')).toMatchObject({ reopened_at: null, reopened_by: null, first_finalized_at: null, first_finalized_by: null, revision_count: 0, revised_by_name: null })
    as('super', 'super1')
    const f = await fin('d9')
    expect(f.status).toBe(200)
    expect(f.body.report).toMatchObject({ revision_count: 0, revised_by_name: null })
    expect(logs()).toHaveLength(0)
  })

  test('finding 4: changedFields ignores jsonb key order (and 72 vs "72"); real changes still logged', () => {
    // as Postgres jsonb returns them: shorter keys first
    const stored = {
      crew_log: [{ name: 'Ann', hours: '8', trade: 'Carp', company: 'NV' }],
      materials_delivered: [{ quantity: '200', supplier: 'Lowes', description: 'Studs' }],
      photos: [{ path: 'J1/a.jpg', caption: 'North wall' }],
      weather_temp: 72,
    }
    const patchBody = { crew_log: crew, materials_delivered: [studs], photos: [{ caption: 'North wall', path: 'J1/a.jpg' }], weather_temp: '72' }
    expect(P.changedFields(stored, patchBody)).toEqual([])
    // array order and values still count
    expect(P.changedFields(stored, { materials_delivered: [studs, drywall] }).map(c => c.field)).toEqual(['materials_delivered'])
    expect(P.changedFields({ photos: [{ path: 'a' }, { path: 'b' }] }, { photos: [{ path: 'b' }, { path: 'a' }] }).map(c => c.field)).toEqual(['photos'])
    expect(P.changedFields(stored, { crew_log: [{ ...crew[0], hours: '9' }] }).map(c => c.field)).toEqual(['crew_log'])
    expect(P.changedFields({ weather_temp: null }, { weather_temp: '' }).map(c => c.field)).toEqual(['weather_temp'])
    // logged values are the real values, not the comparison keys
    const [c] = P.changedFields({ crew_count: 3 }, { crew_count: 4 })
    expect(c).toEqual({ field: 'crew_count', old_value: 3, new_value: 4 })
  })

  test('finding 4: a full-form PATCH of a reopened report with jsonb-ordered stored arrays logs only the real edit', async () => {
    seed({ daily_reports: [final({
      status: 'draft', finalized_at: null, finalized_by: null, reopened_at: '2026-11-10T15:00:00Z', reopened_by: 'pm1',
      crew_log: [{ name: 'Ann', hours: '8', trade: 'Carp', company: 'NV' }],
      materials_delivered: [{ quantity: '200', supplier: 'Lowes', description: 'Studs' }],
    })] })
    as('pm', 'pm1')
    expect((await patch({ id: 'd1', weather: 'Clear', crew_log: crew, materials_delivered: [studs], photos, work_performed: 'Framed + trim' })).status).toBe(200)
    expect(logs().map(l => l.field_name)).toEqual(['work_performed'])
  })

  test('finding 6: a revised report that is reopened shows "Revised (rev N), being edited"', async () => {
    expect(P.revisionLabel({ status: 'draft', revision_count: 1, finalized_at: null, revised_by_name: 'Pat PM' })).toBe('Revised (rev 1), being edited')
    expect(P.revisionLabel({ status: 'draft', revision_count: 0, finalized_at: null })).toBeNull()
    seed({ daily_reports: [final({ revision_count: 1, revised_by_name: 'Pat PM', finalized_at: '2026-11-17T03:30:00Z' })] })
    expect(P.revisionLabel(rowOf('d1'))).toBe('Revised Nov 16, 2026 by Pat PM (rev 1)')
    as('pm', 'pm1'); await reo('d1')
    expect(P.revisionLabel(rowOf('d1'))).toBe('Revised (rev 1), being edited')
  })

  test('076 SQL: FK null-out exception, server-derived columns, INSERT clears reopened_*, backfill runs without the trigger', () => {
    const sql = read('migrations/076_daily_report_versions.sql')
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.daily_reports_revision_guard'), sql.indexOf('$fn$;'))
    const ins = fn.slice(fn.indexOf("IF TG_OP = 'INSERT'"), fn.indexOf('RETURN NEW;'))
    expect(ins).toMatch(/NEW\.reopened_at := NULL;/)
    expect(ins).toMatch(/NEW\.reopened_by := NULL;/)
    expect(fn).not.toMatch(/GREATEST/)
    expect(fn).toMatch(/NEW\.revision_count := COALESCE\(OLD\.revision_count, 0\);/)
    expect(fn).toMatch(/NEW\.revised_by_name := OLD\.revised_by_name;/)
    expect(fn).toMatch(/NEW\.reopened_at := OLD\.reopened_at;/)
    expect(fn).toMatch(/\(new_j - 'first_finalized_by'\) = \(old_j - 'first_finalized_by'\)/)
    expect(fn).toMatch(/\(new_j - 'reopened_by'\) = \(old_j - 'reopened_by'\)/)
    // the backfill must not run through the trigger (a re-run would null it on drafts)
    const drop = sql.indexOf('DROP TRIGGER IF EXISTS daily_reports_revision_guard')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(sql.indexOf('SET first_finalized_at = finalized_at'))
    expect(sql.indexOf('CREATE TRIGGER daily_reports_revision_guard')).toBeGreaterThan(sql.indexOf('SET first_finalized_at = reopened_at'))
  })

  test('finding 9: versions 401 / 403 / 404 carry no-store', async () => {
    seed({ daily_reports: [final()] })
    asAnon(); expect((await getVersions('report_id=d1')).headers.get('cache-control')).toBe('no-store')
    as('owner', 'owner1'); expect((await getVersions('report_id=d1')).headers.get('cache-control')).toBe('no-store')
    as('pm', 'pm1'); expect((await getVersions('report_id=zzz')).headers.get('cache-control')).toBe('no-store')
    as('pm', 'pm9'); const r = await getVersions('report_id=d1')
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
})

describe('9) static checks', () => {
  const sql = read('migrations/076_daily_report_versions.sql')
  test('076: header, guard, table, trigger (invoker), RLS, backfill, tightened policies', () => {
    expect(sql).toMatch(/NOT applied/)
    expect(sql).toMatch(/DEPLOY ORDER/)
    expect(sql).toMatch(/ROLLBACK/)
    expect(sql).toMatch(/apply 075 first/)
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1)
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.daily_report_versions/)
    for (const c of ['id\\s+uuid PRIMARY KEY', 'daily_report_id\\s+uuid NOT NULL REFERENCES public\\.daily_reports\\(id\\) ON DELETE CASCADE', 'rev_number\\s+integer NOT NULL', 'snapshot\\s+jsonb NOT NULL', 'finalized_at\\s+timestamptz', 'finalized_by\\s+uuid', 'reopened_at\\s+timestamptz NOT NULL', 'reopened_by\\s+uuid', 'created_at\\s+timestamptz NOT NULL DEFAULT now\\(\\)', 'UNIQUE \\(daily_report_id, rev_number\\)']) {
      expect([c, new RegExp(c).test(sql)]).toEqual([c, true])
    }
    for (const c of ['first_finalized_at timestamptz', 'first_finalized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL', 'revision_count     integer NOT NULL DEFAULT 0', 'revised_by_name    text']) expect(sql).toContain(c)
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.daily_reports_revision_guard'), sql.indexOf('$fn$;'))
    expect(fn).toMatch(/LANGUAGE plpgsql/)
    expect(fn).not.toMatch(/SECURITY DEFINER/)
    expect(fn).toMatch(/to_jsonb\(OLD\)/)
    expect(sql).toMatch(/CREATE TRIGGER daily_reports_revision_guard\s+BEFORE INSERT OR UPDATE ON public\.daily_reports/)
    expect(sql).toMatch(/ALTER TABLE public\.daily_report_versions ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/CREATE POLICY daily_report_versions_office_select ON public\.daily_report_versions\s+FOR SELECT TO authenticated/)
    expect(sql).toMatch(/daily_report_draft_access\(d\.job_id::text\)/)
    expect(sql).toMatch(/SET first_finalized_at = finalized_at/)
    expect(sql).toMatch(/SET first_finalized_at = reopened_at/)
    const upd = sql.slice(sql.lastIndexOf('CREATE POLICY daily_reports_update_own_draft'), sql.lastIndexOf('DROP POLICY IF EXISTS daily_reports_delete_own_draft'))
    expect(upd.match(/reopened_at IS NULL/g)).toHaveLength(2)
    const del = sql.slice(sql.lastIndexOf('CREATE POLICY daily_reports_delete_own_draft'))
    expect(del).toMatch(/reopened_at IS NULL/)
  })
  test('routes and pages', () => {
    for (const f of ['app/api/daily-reports/route.js', 'app/api/daily-reports/finalize/route.js', 'app/api/daily-reports/reopen/route.js']) {
      expect([f, /import \{ logChange \} from '[./]+lib\/change-log'/.test(read(f))]).toEqual([f, true])
    }
    for (const f of ['app/jobdetail/page.js', 'app/residentialjobdetail/page.js', 'app/field/page.js']) {
      expect([f, /revisionLabel\(r\)/.test(read(f)) && /canViewReportVersions\(/.test(read(f)) && /ReportVersionsModal/.test(read(f))]).toEqual([f, true])
    }
    expect(read('app/owner/page.js')).toMatch(/p\.revised/)
    expect(read('app/owner/page.js')).not.toMatch(/ReportVersionsModal|daily-reports\/versions/)
    const v = read('app/api/daily-reports/versions/route.js')
    expect(v).toMatch(/denyUnlessOnJob\(/)
    expect(v).toMatch(/canViewReportVersions\(/)
    expect(v).toMatch(/order\('rev_number', \{ ascending: false \}\)/)
    expect(v).not.toMatch(/createSignedUrl/)
  })
})
