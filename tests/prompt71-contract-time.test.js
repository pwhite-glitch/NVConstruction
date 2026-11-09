/**
 * Prompt 71: commercial contract time + weather days (migration 069 — PROPOSED, not applied).
 *  - lib/contract-time.js: original completion + approved owner-CO days = current completion,
 *    days left (Central), 14-day flag, weather-delay count / log rows.
 *  - Details: contract_completion_date (commercial only) via POST /api/jobs/details, with a
 *    missing-column retry that answers 200 + a "migration 069" warning before 069.
 *  - Owner CO revise: days_added saved in a separate update (RPC unchanged), logged.
 *  - /api/log-change: contract_completion_date + prime_change_order.days_added.
 *  - Weather-day log print builder.
 * DB/auth are mocked; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  return { requireAuth: async () => mockState.auth }
})

const details = require('../app/api/jobs/details/route')
const review = require('../app/api/prime-change-orders/review/route')
const logRoute = require('../app/api/log-change/route')
const {
  addCalendarDays, approvedDaysAdded, currentCompletionDate, daysLeftFromToday, completionFlag,
  weatherDelayCount, weatherDelayRows, parseDaysAdded, contractTimeSummary, formatDaysAdded,
} = require('../lib/contract-time')
const { commercialDetailsUpdate, residentialDetailsUpdate, jobDetailsUpdate } = require('../lib/job-details')
const { normalizeRevision } = require('../lib/prime-co-review')
const { CLIENT_LOG_FIELDS, CLIENT_LOG_ENTITY_TYPES } = require('../lib/change-log')
const { buildWeatherDayLogHtml } = require('../lib/weather-day-log-print')

const ROOT = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const JC = '11111111-1111-4111-8111-111111111111'
const JR = '22222222-2222-4222-8222-222222222222'
const JO = '33333333-3333-4333-8333-333333333333' // commercial, APM not on it
const B1 = 'b1000000-0000-4000-8000-000000000001'
const CO_P = 'c1000000-0000-4000-8000-000000000001' // pending, not applied
const CO_A = 'c2000000-0000-4000-8000-000000000002' // approved + applied
const CO_O = 'c3000000-0000-4000-8000-000000000003' // on JO

const req = (url, body) => new Request(`http://x${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const as = role => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null } }
const json = async r => ({ status: r.status, body: await r.json() })
// Central noon on a date, so todayCentral(now) === that date.
const at = d => new Date(d + 'T17:00:00Z')

function seed() {
  resetMockState({
    jobs: [
      { id: JC, job_type: 'commercial', status: 'active', archived: false, pm_email: 'pm@nv.com', project_name: 'Braum', job_number: '7469', contract_value: 100 },
      { id: JR, job_type: 'residential', status: 'active', archived: false, pm_email: 'pm@nv.com', project_name: 'NoLo', job_number: 'R-1' },
      { id: JO, job_type: 'commercial', status: 'active', archived: false, pm_email: null, project_name: 'Other', job_number: '7000' },
    ],
    pm_job_assignments: [{ id: 'a1', job_id: JC, user_id: 'u-apm' }],
    profiles: [{ id: 'u-pm', full_name: 'Pat PM', role: 'pm' }],
    budget_items: [{ id: B1, job_id: JC, description: 'Site', budget_amount: 1000, owner_amount: 1000 }],
    prime_change_orders: [
      { id: CO_P, job_id: JC, status: 'pending', description: 'Add door', amount: 100, notes: null, budget_applied: false, sov: [{ budget_item_id: B1, amount: 100 }], days_added: 0 },
      { id: CO_A, job_id: JC, status: 'approved', description: 'Rain', amount: 50, notes: null, budget_applied: true, sov: [{ budget_item_id: B1, amount: 50 }], days_added: 3 },
      { id: CO_O, job_id: JO, status: 'pending', description: 'x', amount: 1, budget_applied: false, sov: null, days_added: 0 },
    ],
    change_log: [],
  })
}
beforeEach(() => { seed(); as('pm') })

// ── 1. pure helpers ───────────────────────────────────────────────────────────
describe('lib/contract-time', () => {
  test('addCalendarDays across month / year / leap day, and negative', () => {
    expect(addCalendarDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(addCalendarDays('2026-12-30', 5)).toBe('2027-01-04')
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addCalendarDays('2026-11-01', 0)).toBe('2026-11-01') // DST change day
    expect(addCalendarDays('nope', 3)).toBeNull()
  })
  test('approvedDaysAdded counts approved only; null / missing = 0', () => {
    expect(approvedDaysAdded([
      { status: 'approved', days_added: 5 }, { status: 'approved', days_added: -2 },
      { status: 'pending', days_added: 10 }, { status: 'rejected', days_added: 7 },
      { status: 'approved', days_added: null }, { status: 'approved' }, null,
    ])).toBe(3)
    expect(approvedDaysAdded()).toBe(0)
  })
  test('currentCompletionDate null without an original date', () => {
    expect(currentCompletionDate(null, 10)).toBeNull()
    expect(currentCompletionDate(undefined, 0)).toBeNull()
    expect(currentCompletionDate('2026-12-01', 10)).toBe('2026-12-11')
    expect(currentCompletionDate('2026-12-01', 0)).toBe('2026-12-01')
  })
  test('daysLeftFromToday: today / future / past (Central)', () => {
    expect(daysLeftFromToday('2026-11-09', at('2026-11-09'))).toBe(0)
    expect(daysLeftFromToday('2026-11-23', at('2026-11-09'))).toBe(14)
    expect(daysLeftFromToday('2026-11-01', at('2026-11-09'))).toBe(-8)
    // 03:00Z Nov 10 is still Nov 9 in Chicago
    expect(daysLeftFromToday('2026-11-10', new Date('2026-11-10T03:00:00Z'))).toBe(1)
    expect(daysLeftFromToday(null)).toBeNull()
  })
  test('completionFlag window 14', () => {
    expect(completionFlag(15)).toBeNull()
    expect(completionFlag(14)).toMatchObject({ kind: 'due', label: 'Due in 14 days' })
    expect(completionFlag(1)).toMatchObject({ kind: 'due', label: 'Due in 1 day' })
    expect(completionFlag(0)).toMatchObject({ kind: 'today', label: 'Due today' })
    expect(completionFlag(-3)).toMatchObject({ kind: 'overdue', label: '3 days overdue' })
    expect(completionFlag(null)).toBeNull()
    expect(completionFlag(20, { window: 30 })).toMatchObject({ kind: 'due' })
  })
  test('contractTimeSummary: weather days never move completion; missing column → null', () => {
    const cos = [{ status: 'approved', days_added: 4 }, { status: 'pending', days_added: 9 }]
    expect(contractTimeSummary({ contract_completion_date: '2026-11-20' }, cos, at('2026-11-09')))
      .toMatchObject({ original: '2026-11-20', approvedDays: 4, current: '2026-11-24', daysLeft: 15, flag: null })
    expect(contractTimeSummary({}, cos, at('2026-11-09'))).toMatchObject({ original: null, approvedDays: 4, current: null, daysLeft: null, flag: null })
  })
  test('weatherDelayCount / weatherDelayRows', () => {
    const reports = [
      { report_date: '2026-10-03', weather_delay: true },
      { report_date: '2026-10-01', weather_delay: true },
      { report_date: '2026-10-02', weather_delay: false },
      { report_date: '2026-10-05', weather_delay: 'true' }, // not boolean true
      { report_date: '2026-11-01', weather_delay: true },
    ]
    expect(weatherDelayCount(reports)).toBe(3)
    expect(weatherDelayRows(reports).map(r => r.report_date)).toEqual(['2026-10-01', '2026-10-03', '2026-11-01'])
    expect(weatherDelayRows(reports, { from: '2026-10-03', to: '2026-10-31' }).map(r => r.report_date)).toEqual(['2026-10-03'])
    expect(weatherDelayRows(reports, { to: '2026-10-01' }).map(r => r.report_date)).toEqual(['2026-10-01'])
  })
  test('parseDaysAdded: integers incl. negative / 0; rejects others', () => {
    expect(parseDaysAdded('')).toEqual({ value: 0 })
    expect(parseDaysAdded(undefined)).toEqual({ value: 0 })
    expect(parseDaysAdded('5')).toEqual({ value: 5 })
    expect(parseDaysAdded(-3)).toEqual({ value: -3 })
    expect(parseDaysAdded(0)).toEqual({ value: 0 })
    for (const bad of [1.5, '2.5', 'abc', NaN, Infinity, true, 4000, -4000]) expect(parseDaysAdded(bad).error).toBeTruthy()
    expect(formatDaysAdded(5)).toBe('+5 days')
    expect(formatDaysAdded(undefined)).toBe('0 days')
    expect(formatDaysAdded(-1)).toBe('-1 day')
  })
})

// ── 2. Details allow-list ─────────────────────────────────────────────────────
describe('Details allow-list', () => {
  test('commercial accepts contract_completion_date, clears on blank, rejects bad dates', () => {
    expect(commercialDetailsUpdate({ contract_completion_date: '2027-03-31' }).fields).toEqual({ contract_completion_date: '2027-03-31' })
    expect(commercialDetailsUpdate({ contract_completion_date: '' }).fields).toEqual({ contract_completion_date: null })
    expect(commercialDetailsUpdate({ contract_completion_date: '03/31/2027' }).error).toMatch(/Contract completion date/)
    expect(commercialDetailsUpdate({ contract_completion_date: '2027-13-45' }).error).toBeTruthy()
  })
  test('residential never writes it', () => {
    expect(residentialDetailsUpdate({ contract_completion_date: '2027-03-31' }).fields).toEqual({})
    expect(jobDetailsUpdate({ contract_completion_date: '2027-03-31' }, { job_type: 'residential' }).fields).toEqual({})
  })
})

// ── 3. POST /api/jobs/details ─────────────────────────────────────────────────
describe('POST /api/jobs/details contract_completion_date', () => {
  const save = fields => details.POST(req('/api/jobs/details', { id: JC, fields }))
  test('writer sets it', async () => {
    const r = await json(await save({ contract_completion_date: '2027-01-15' }))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    expect(mockState.db.jobs.find(j => j.id === JC).contract_completion_date).toBe('2027-01-15')
  })
  test('super / sub are 403, nothing written', async () => {
    for (const role of ['super', 'subcontractor']) {
      as(role)
      const r = await save({ contract_completion_date: '2027-01-15' })
      expect(r.status).toBe(403)
    }
    expect(mockState.calls.filter(c => c.op === 'update')).toHaveLength(0)
  })
  test('denyJob still applies (APM not on the job)', async () => {
    as('apm')
    const r = await details.POST(req('/api/jobs/details', { id: JO, fields: { contract_completion_date: '2027-01-15' } }))
    expect(r.status).toBe(403)
    expect(mockState.db.jobs.find(j => j.id === JO).contract_completion_date).toBeUndefined()
  })
  test('before 069: other fields save, date dropped, 200 + migration 069 warning', async () => {
    mockState.missingCols = { jobs: ['contract_completion_date'] }
    const r = await json(await save({ project_name: 'Braum 2', contract_completion_date: '2027-01-15' }))
    expect(r.status).toBe(200)
    expect(r.body.migration_required).toBe('069')
    expect(r.body.warning).toMatch(/069/)
    const job = mockState.db.jobs.find(j => j.id === JC)
    expect(job.project_name).toBe('Braum 2')
    expect(job.contract_completion_date).toBeUndefined()
  })
  test('before 069: only the date changed → 200 + warning (no 500)', async () => {
    mockState.missingCols = { jobs: ['contract_completion_date'] }
    const r = await json(await save({ contract_completion_date: '2027-01-15' }))
    expect(r.status).toBe(200)
    expect(r.body.migration_required).toBe('069')
  })
  test('other missing columns are not dropped', async () => {
    mockState.missingCols = { jobs: ['project_name'] }
    const r = await save({ project_name: 'X', contract_completion_date: '2027-01-15' })
    expect(r.status).toBe(500)
  })
})

// ── 4. revise days_added ──────────────────────────────────────────────────────
describe('POST /api/prime-change-orders/review revise days_added', () => {
  const revise = (co, extra = {}) => review.POST(req('/api/prime-change-orders/review', {
    co_id: co.id, action: 'revise', description: co.description, amount: co.amount, notes: null, sov: co.sov, ...extra,
  }))
  const co = id => mockState.db.prime_change_orders.find(c => c.id === id)
  const logs = () => mockState.calls.filter(c => c.table === 'change_log').map(c => c.payload)

  test('normalizeRevision keeps days_added out of fields', () => {
    const r = normalizeRevision({ description: 'a', amount: 1, days_added: '4' })
    expect(r.daysAdded).toBe(4)
    expect(r.fields).not.toHaveProperty('days_added')
    expect(normalizeRevision({ description: 'a', amount: 1 }).daysAdded).toBeUndefined()
    expect(normalizeRevision({ description: 'a', amount: 1, days_added: 1.5 }).error).toBeTruthy()
  })
  test('non-applied update persists days_added and logs the change', async () => {
    const r = await json(await revise(co(CO_P), { description: 'Add door v2', days_added: 7 }))
    expect(r.status).toBe(200)
    expect(co(CO_P)).toMatchObject({ description: 'Add door v2', days_added: 7 })
    expect(logs()).toEqual([expect.objectContaining({ entity_type: 'prime_change_order', entity_id: CO_P, field_name: 'days_added', old_value: '0', new_value: '7', job_id: JC, changed_by: 'u-pm' })])
  })
  test('unchanged days_added: no extra write, no log', async () => {
    await revise(co(CO_P), { days_added: 0 })
    expect(mockState.calls.filter(c => c.table === 'prime_change_orders' && c.op === 'update')).toHaveLength(1)
    expect(logs()).toHaveLength(0)
  })
  test('applied path: RPC without days_added, then a separate days_added update', async () => {
    mockState.rpc.prime_co_revise = (args, db) => {
      const c = db.prime_change_orders.find(x => x.id === args.p_co_id)
      Object.assign(c, { description: args.p_description, amount: args.p_amount })
      return { data: { ok: true }, error: null }
    }
    const r = await json(await revise(co(CO_A), { description: 'Rain v2', days_added: 5 }))
    expect(r.status).toBe(200)
    const rpc = mockState.calls.find(c => c.table === 'rpc:prime_co_revise')
    expect(Object.keys(rpc.payload).sort()).toEqual(['p_amount', 'p_co_id', 'p_description', 'p_job_id', 'p_notes', 'p_sov'])
    const upd = mockState.calls.filter(c => c.table === 'prime_change_orders' && c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ days_added: 5 })
    expect(co(CO_A)).toMatchObject({ description: 'Rain v2', days_added: 5 })
    expect(logs()[0]).toMatchObject({ old_value: '3', new_value: '5' })
  })
  test('missing days_added column: description still saves, warning names 069, no log', async () => {
    mockState.missingCols = { prime_change_orders: ['days_added'] }
    delete co(CO_P).days_added
    const r = await json(await revise(co(CO_P), { description: 'Saved anyway', days_added: 4 }))
    expect(r.status).toBe(200)
    expect(r.body.migration_required).toBe('069')
    expect(co(CO_P).description).toBe('Saved anyway')
    expect(co(CO_P).days_added).toBeUndefined()
    expect(logs()).toHaveLength(0)
  })
  test('missing column + days 0 (nothing to save): no warning', async () => {
    mockState.missingCols = { prime_change_orders: ['days_added'] }
    delete co(CO_P).days_added
    const r = await json(await revise(co(CO_P), { days_added: 0 }))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
  })
  test('bad days_added → 400, nothing written', async () => {
    const r = await revise(co(CO_P), { days_added: 'abc' })
    expect(r.status).toBe(400)
    expect(mockState.calls.filter(c => c.op === 'update')).toHaveLength(0)
  })
})

// ── /api/log-change allow-list ────────────────────────────────────────────────
describe('POST /api/log-change', () => {
  const post = body => logRoute.POST(req('/api/log-change', body))
  test('allow-lists', () => {
    expect(CLIENT_LOG_FIELDS.job.has('contract_completion_date')).toBe(true)
    expect(CLIENT_LOG_ENTITY_TYPES.has('prime_change_order')).toBe(true)
    expect(CLIENT_LOG_FIELDS.prime_change_order.has('days_added')).toBe(true)
  })
  test('job entry still forces entity_id = job_id', async () => {
    const r = await post({ job_id: JC, entity_type: 'job', entity_id: 'other', field_name: 'contract_completion_date', old_value: '', new_value: '2027-01-01' })
    expect(r.status).toBe(200)
    expect(mockState.db.change_log.at(-1)).toMatchObject({ entity_type: 'job', entity_id: JC, field_name: 'contract_completion_date' })
  })
  test('prime_change_order entry uses the CO id (must be on that job)', async () => {
    const ok = await post({ job_id: JC, entity_type: 'prime_change_order', entity_id: CO_P, field_name: 'days_added', old_value: '0', new_value: '5' })
    expect(ok.status).toBe(200)
    expect(mockState.db.change_log.at(-1)).toMatchObject({ entity_type: 'prime_change_order', entity_id: CO_P, job_id: JC })
    const wrongJob = await post({ job_id: JC, entity_type: 'prime_change_order', entity_id: CO_O, field_name: 'days_added', new_value: '1' })
    expect(wrongJob.status).toBe(404)
    const noId = await post({ job_id: JC, entity_type: 'prime_change_order', field_name: 'days_added', new_value: '1' })
    expect(noId.status).toBe(400)
    const badField = await post({ job_id: JC, entity_type: 'prime_change_order', entity_id: CO_P, field_name: 'amount', new_value: '1' })
    expect(badField.status).toBe(400)
    expect(mockState.db.change_log).toHaveLength(1)
  })
})

// ── 5. source checks ──────────────────────────────────────────────────────────
describe('source checks', () => {
  const jd = read('app/jobdetail/page.js')
  const dash = read('app/dashboard/page.js')
  test('job page: overview card, weather log, days_added, details field', () => {
    expect(jd).toMatch(/ovSec\('Contract time'\)/)
    expect(jd).toMatch(/Print weather-day log/)
    expect(jd).toMatch(/buildWeatherDayLogHtml/)
    expect(jd).toMatch(/days_added/)
    expect(jd).toMatch(/Days added \(contract time\)/)
    expect(jd).toMatch(/form\.contract_completion_date/)
    expect(jd).toMatch(/field_name: 'contract_completion_date'/)
  })
  test('dashboard uses completionFlag', () => {
    expect(dash).toMatch(/completionFlag/)
    expect(dash).toMatch(/select\('job_id, days_added, status'\)/)
  })
  test('migration 069 is idempotent with both columns and a rollback', () => {
    const sql = read('migrations/069_contract_time.sql')
    expect(sql).toMatch(/STATUS: PROPOSED/)
    expect(sql).toMatch(/ALTER TABLE public\.jobs\s+ADD COLUMN IF NOT EXISTS contract_completion_date date;/)
    expect(sql).toMatch(/ALTER TABLE public\.prime_change_orders\s+ADD COLUMN IF NOT EXISTS days_added integer NOT NULL DEFAULT 0;/)
    expect(sql).toMatch(/-- ALTER TABLE public\.jobs DROP COLUMN IF EXISTS contract_completion_date;/)
  })
  test('prime_co_revise RPC / migration 049 untouched by this package', () => {
    expect(read('migrations/049_prime_co_review_rpc.sql')).not.toMatch(/days_added/)
  })
})

// ── 6. weather-day log HTML ───────────────────────────────────────────────────
describe('buildWeatherDayLogHtml', () => {
  const reports = [
    { report_date: '2026-10-01', weather: 'Rain', weather_temp: '58°', weather_delay: true, work_performed: 'Site <flooded>', issues: 'Pump & dewater' },
    { report_date: '2026-10-02', weather: 'Sunny', weather_delay: false, work_performed: 'NOT A DELAY ROW' },
    { report_date: '2026-10-09', weather: 'Storm', weather_delay: true, work_performed: 'Shut down' },
  ]
  const html = buildWeatherDayLogHtml({
    job: { project_name: 'Braum <Tyler>', job_number: '7469' }, reports,
    contractCompletionDate: '2027-01-15', currentCompletion: '2027-01-20', approvedDays: 5, now: new Date('2026-11-09T18:00:00Z'),
  })
  test('escapes text, only delay rows, header has job number and dates', () => {
    expect(html).toContain('Braum &lt;Tyler&gt;')
    expect(html).not.toContain('Braum <Tyler>')
    expect(html).toContain('Site &lt;flooded&gt;<br>Pump &amp; dewater')
    expect(html).not.toContain('NOT A DELAY ROW')
    expect(html).toContain('#7469')
    expect(html).toContain('Jan 15, 2027')
    expect(html).toContain('Jan 20, 2027')
    expect(html).toMatch(/Weather-delay days<b>2<\/b>/)
    expect(html).toMatch(/@media print/)
    expect(html).toMatch(/Printed Nov 9, 2026.*CST/)
  })
  test('from / to filter', () => {
    const h = buildWeatherDayLogHtml({ job: { project_name: 'J', job_number: '1' }, reports, from: '2026-10-05', to: '2026-10-31' })
    expect(h).toContain('Shut down')
    expect(h).not.toContain('flooded')
  })
})
