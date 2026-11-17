/**
 * Prompt 89 — Supers may reopen FINAL daily reports on jobs they are assigned to, and (addendum)
 * only reports they wrote. APM still cannot reopen. Revision history (076 trigger) unchanged.
 * All DB access is the in-memory mock; nothing live; no migration.
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
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

const P = require('../lib/daily-report-payload')
const { REOPEN_AUTHOR_MESSAGE, REOPEN_ROLE_MESSAGE } = require('../lib/daily-report-server')
const { FINALIZE_CONFIRM } = require('../lib/daily-report-client')
const route = require('../app/api/daily-reports/route')
const finalize = require('../app/api/daily-reports/finalize/route')
const reopen = require('../app/api/daily-reports/reopen/route')

const fin = id => call(finalize.POST, '/api/daily-reports/finalize', 'POST', { id })
const reo = id => call(reopen.POST, '/api/daily-reports/reopen', 'POST', { id })
const patch = body => call(route.PATCH, '/api/daily-reports', 'PATCH', body)

// Copied from tests/prompt86-daily-report-revisions.test.js (not exported there).
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

const final = (extra = {}) => ({
  id: 'r1', job_id: 'J1', super_id: 'super1', report_date: '2026-11-09', work_performed: 'Framed walls',
  status: 'final', finalized_at: '2026-11-09T22:00:00Z', finalized_by: 'super1',
  first_finalized_at: '2026-11-09T22:00:00Z', first_finalized_by: 'super1',
  revision_count: 0, revised_by_name: null, reopened_at: null, reopened_by: null, materials_delivered: [], ...extra,
})

const seed = (extra = {}) => {
  resetMockState({
    jobs: [{ id: 'J1', pm_email: 'lead@x.com' }, { id: 'J2' }],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'super1' },
      { id: 'a3', job_id: 'J1', user_id: 'super2' }, { id: 'a4', job_id: 'J1', user_id: 'apm1' },
    ],
    profiles: [{ id: 'super1', role: 'super', full_name: 'Sam Super' }, { id: 'super2', role: 'super' }, { id: 'super9', role: 'super' }, { id: 'pm1', role: 'pm', full_name: 'Pat PM' }, { id: 'apm1', role: 'apm' }],
    daily_reports: [final()],
    deliveries: [],
    change_log: [],
    daily_report_versions: [],
    ...extra,
  })
  mockState.triggers.daily_reports = revisionGuard
  mockState.failSnapshot = false
}
const report = (id = 'r1') => mockState.db.daily_reports.find(r => r.id === id)

describe('prompt 89 — helpers', () => {
  test('canReopenReport: principal / admin / pm / super true; apm / owner / subcontractor false', () => {
    for (const role of ['principal', 'admin', 'pm', 'super']) expect(P.canReopenReport(role)).toBe(true)
    for (const role of ['apm', 'owner', 'subcontractor', undefined, null, '']) expect(P.canReopenReport(role)).toBe(false)
    // Supers are still NOT draft viewers.
    expect(P.DRAFT_VIEWER_ROLES.has('super')).toBe(false)
    expect(P.canSeeAllDrafts('super')).toBe(false)
    expect(P.canViewReportVersions('super')).toBe(false)
  })

  test('canReopenFinalReport: a super only on their own final; office on any final; never a draft', () => {
    const mine = final(), theirs = final({ super_id: 'super2' })
    expect(P.canReopenFinalReport({ role: 'super', userId: 'super1' }, mine)).toBe(true)
    expect(P.canReopenFinalReport({ role: 'super', userId: 'super1' }, theirs)).toBe(false)
    expect(P.canReopenFinalReport({ role: 'super', userId: 'super1' }, { ...mine, status: 'draft' })).toBe(false)
    expect(P.canReopenFinalReport({ role: 'pm', userId: 'pm1' }, theirs)).toBe(true)
    expect(P.canReopenFinalReport({ role: 'apm', userId: 'super2' }, theirs)).toBe(false)
    expect(P.canReopenFinalReport({ role: 'super' }, final({ super_id: undefined }))).toBe(false)
  })

  test('messages', () => {
    expect(REOPEN_ROLE_MESSAGE).toBe('Only an Owner, admin, PM or Super can reopen a finalized report.')
    expect(REOPEN_AUTHOR_MESSAGE).toBe("Only the report's author or the office can reopen it.")
    expect(FINALIZE_CONFIRM).toMatch(/unless an Owner, PM or Super reopens it\.$/)
  })
})

describe('prompt 89 — reopen route', () => {
  test('super on the job reopens their own final → draft, stamps cleared, snapshot written (076 unchanged)', async () => {
    seed(); as('super', 'super1')
    const r = await reo('r1')
    expect(r.status).toBe(200)
    expect(r.body.report).toMatchObject({ status: 'draft', finalized_at: null, finalized_by: null, reopened_by: 'super1' })
    expect(r.body.report.reopened_at).toBeTruthy()
    const v = mockState.db.daily_report_versions
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ daily_report_id: 'r1', rev_number: 0, reopened_by: 'super1', finalized_by: 'super1' })
    expect(v[0].snapshot).toMatchObject({ status: 'final', work_performed: 'Framed walls', finalized_by: 'super1' })
    expect(report().first_finalized_by).toBe('super1')
    expect(mockState.db.change_log.some(c => c.entity_id === 'r1' && c.new_value === 'draft' && c.changed_by === 'super1')).toBe(true)
  })

  test('super not on the job → 403; final on J2 → 403; missing report → 404', async () => {
    seed(); as('super', 'super9')
    expect((await reo('r1')).status).toBe(403)
    seed({ daily_reports: [final({ id: 'r2', job_id: 'J2' })] }); as('super', 'super1')
    expect((await reo('r2')).status).toBe(403)
    expect(report('r2').status).toBe('final')
    expect((await reo('nope')).status).toBe(404)
    expect(mockState.db.daily_report_versions).toHaveLength(0)
  })

  test("addendum: a super cannot reopen another super's report (403, clear message); PM still can", async () => {
    seed(); as('super', 'super2')
    const r = await reo('r1')
    expect(r.status).toBe(403)
    expect(r.body.error).toBe(REOPEN_AUTHOR_MESSAGE)
    expect(report().status).toBe('final')
    expect(mockState.db.daily_report_versions).toHaveLength(0)
    as('pm', 'pm1')
    expect((await reo('r1')).status).toBe(200)
  })

  test('APM still 403 on reopen', async () => {
    seed(); as('apm', 'apm1')
    const r = await reo('r1')
    expect(r.status).toBe(403)
    expect(r.body.error).toBe(REOPEN_ROLE_MESSAGE)
    expect(report().status).toBe('final')
  })

  test('after super1 reopens their own report: PATCH → 200, finalize → 200, final again, revision_count +1', async () => {
    seed(); as('super', 'super1')
    expect((await reo('r1')).status).toBe(200)
    const p = await patch({ id: 'r1', work_performed: 'Framed walls + corrected crew count' })
    expect(p.status).toBe(200)
    const f = await fin('r1')
    expect(f.status).toBe(200)
    expect(report()).toMatchObject({ status: 'final', work_performed: 'Framed walls + corrected crew count', finalized_by: 'super1', revision_count: 1, first_finalized_at: '2026-11-09T22:00:00Z' })
  })
})

describe('prompt 89 — static UI', () => {
  const field = read('app/field/page.js')
  test('field app: imports, REOPEN_CONFIRM, Reopen button in Past reports gated to own finals', () => {
    expect(field).toMatch(/import \{[^}]*\bcanReopenReport\b[^}]*\} from '..\/..\/lib\/daily-report-payload'/)
    expect(field).toMatch(/import \{[^}]*\breopenDailyReport\b[^}]*\bREOPEN_CONFIRM\b[^}]*\} from '..\/..\/lib\/daily-report-client'/)
    const past = field.slice(field.indexOf('Past reports ('))
    expect(past).toMatch(/!draft && canReopenReport\(profile\?\.role\) && canReopenFinalReport\(\{ role: profile\?\.role, userId: user\?\.id \}, r\) && !isPreviewActive\(\)/)
    expect(past).toMatch(/window\.confirm\(REOPEN_CONFIRM\)/)
    expect(past).toMatch(/reopenDailyReport\(authFetch, r\.id\); await loadDailyReports\(\); await checkTodayReport\(\)/)
    expect(past).toMatch(/'Reopening…' : 'Reopen'/)
    expect(field).toMatch(/const \[reopeningReport, setReopeningReport\] = useState\(null\)/)
  })

  test('job pages still gate Reopen with canReopenReport(userRole)', () => {
    expect(read('app/jobdetail/page.js')).toMatch(/canReopenReport\(userRole\)/)
    expect(read('app/residentialjobdetail/page.js')).toMatch(/canReopenReport\(userRole\)/)
  })
})
