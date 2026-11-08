/**
 * Prompt 59 — eleven approved hourly findings.
 *   1. Lookahead freeze-risk flag (40°F) on pours / masonry / roofing / sealants; Submit-to-PM email warns.
 *   2. Tool actions update the tool server-side; supers only on their own tool; no super edit/delete; retire.
 *   3. Friday mileage reminder: any mileage since Monday counts; field form defaults to Weekly Miles.
 *   4. Doc-request via authFetch; office COI upload carries (and requires) the new expiration.
 *   5. Owner pay apps: app_number + G702 current payment due (aiaCurrentPaymentDue), no drafts, no draw fallback.
 *   6. Bid leveling: blank = null, first click = included, excluded omitted, canEdit, server route.
 *   7. Field / staff RFIs get a number (insertNumberedRfi) and status open; RFI # shown.
 *   8. Notification labels / field links; bells on /field and /sales; dashboard badge loads on start.
 *   9. Owner photos from job_photos + daily_reports via daily-report-photos; errors not swallowed.
 *  10. Closeout loads billings; never "ready" on a failed load or negative retainage.
 *  11. Billing draft keyed per login, % per SOV line restored.
 * All DB access is the in-memory mock; no network, no email, no migration applied.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

const mockSent = []
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: async msg => { mockSent.push(msg); return { data: { id: 'e1' }, error: null } } } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    requireRole: async (_r, roles) => (roles.includes(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    verifyCronSecret: () => mockState.cronOk !== false,
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const sent = () => mockSent
const clearSent = () => { mockSent.length = 0 }

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => { clearSent() })

// ─────────────────────────────────────────────────────────────────────────────
describe('1) lookahead freeze risk', () => {
  const { COLD_RISK_F, isColdRisk, coldFlagged, looksColdSensitive, rainFlagged, weatherFlags } = require('../lib/lookahead-weather')
  const { lookaheadWeatherFlags, weatherWarningHtml, loadJobForecast } = require('../lib/lookahead-forecast')
  const { buildLookaheadPrintHtml } = require('../lib/lookahead-print')

  test('threshold is 40°F and uses the forecast low', () => {
    expect(COLD_RISK_F).toBe(40)
    expect(isColdRisk({ high: 55, low: 40 })).toBe(true)
    expect(isColdRisk({ high: 55, low: 28 })).toBe(true)
    expect(isColdRisk({ high: 70, low: 41 })).toBe(false)
    expect(isColdRisk({ high: 70, low: null })).toBe(false)
    expect(isColdRisk(null)).toBe(false)
  })

  test('only temperature-sensitive work is flagged', () => {
    const cold = { high: 50, low: 30, precip: 0 }
    for (const d of ['Pour footings', 'Concrete slab', 'Flatwork at drive-thru', 'Sidewalk and curb', 'Masonry veneer', 'Brick wainscot', 'CMU block wall', 'Stucco scratch coat', 'Grout cells', 'Roof membrane', 'TPO roofing', 'Sealant at storefront', 'Exterior paint', 'Parking lot striping', 'Paving']) {
      expect([d, coldFlagged({ description: d }, cold)]).toEqual([d, true])
    }
    for (const d of ['Hang drywall', 'Interior electrical rough-in', 'Install doors', 'Excavate for utilities', 'Framing walls']) {
      expect([d, coldFlagged({ description: d }, cold)]).toEqual([d, false])
    }
    expect(looksColdSensitive({ description: 'Set forms', location: 'footings' })).toBe(true)
    expect(coldFlagged({ description: 'Pour slab' }, { low: 45 })).toBe(false)
  })

  test('weatherFlags / lookaheadWeatherFlags pick rain and cold per working day', () => {
    const forecast = { '2026-11-09': { low: 28, high: 50, precip: 10 }, '2026-11-10': { low: 50, high: 70, precip: 80 } }
    const acts = [
      { id: 'a', description: 'Pour sidewalk', planned_date: '2026-11-09', end_date: '2026-11-10' },
      { id: 'b', description: 'Interior paint', planned_date: '2026-11-09' },
      { id: 'c', description: 'Pour curb', planned_date: '2026-11-09', status: 'done' },
    ]
    const flags = lookaheadWeatherFlags(acts, '2026-11-09', forecast)
    expect(flags.map(f => [f.act.id, f.date, f.cold, f.rain])).toEqual([['a', '2026-11-09', true, false], ['a', '2026-11-10', false, true]])
    const html = weatherWarningHtml(flags)
    expect(html).toMatch(/Freeze risk \(low 28°F\)/)
    expect(html).toMatch(/Rain risk \(80%\)/)
    expect(weatherWarningHtml([])).toBe('')
    expect(weatherFlags([{ act: acts[1], date: '2026-11-09' }], forecast)).toEqual([])
    expect(rainFlagged(acts[0], forecast['2026-11-10'])).toBe(true)
  })

  test('printed lookahead shows Freeze risk on the card and the day header', () => {
    const html = buildLookaheadPrintHtml({
      job: { project_name: 'Braum\'s Conway' }, lookahead: {}, weekStart: '2026-11-09', contracts: [],
      activities: [{ id: 'a', description: 'Pour footings', planned_date: '2026-11-09', responsible_type: 'sub' }],
      forecast: { '2026-11-09': { low: 31, high: 52, precip: 0, label: 'Clear', icon: '' } },
    })
    expect(html).toMatch(/❄ Freeze risk \(low 31°\)/)
    expect(html).toMatch(/52°\/31° ❄ Freeze risk/)
  })

  test('UI pieces exist on the PM board, the field app and DayWeather', () => {
    expect(read('app/components/lookahead/LookaheadShared.js')).toMatch(/Freeze risk/)
    expect(read('app/components/lookahead/LookaheadShared.js')).toMatch(/export function ColdTag/)
    expect(read('app/jobdetail/page.js')).toMatch(/coldFlagged\(act, wx\)[\s\S]{0,2000}<ColdTag/)
    expect(read('app/field/page.js')).toMatch(/coldFlagged\(act, wx\)[\s\S]{0,3000}<ColdTag/)
  })

  test('loadJobForecast uses the injected fetch and never throws', async () => {
    resetMockState({ jobs: [{ id: 'J1', latitude: 35.1, longitude: -92.4 }] })
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ daily: { time: ['2026-11-09'], temperature_2m_min: [29.6], temperature_2m_max: [50], precipitation_probability_max: [5], weather_code: [0] } }) }))
    const r = await loadJobForecast(require('@supabase/supabase-js').createClient(), 'J1', { fetchImpl, useCache: false })
    expect(r.days['2026-11-09'].low).toBe(30)
    const bad = await loadJobForecast(require('@supabase/supabase-js').createClient(), 'J1', { fetchImpl: async () => { throw new Error('offline') }, useCache: false })
    expect(bad).toEqual({ days: {}, reason: 'offline' })
  })

  test('Submit-to-PM email carries the freeze / rain warning', async () => {
    const realFetch = global.fetch
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ daily: { time: ['2026-11-09'], temperature_2m_min: [27], temperature_2m_max: [48], precipitation_probability_max: [10], weather_code: [0] } }) }))
    try {
      resetMockState({
        jobs: [{ id: 'J9', job_number: '901', project_name: 'Tyler Braum\'s', pm_email: 'pm@nv.test', latitude: 32.3, longitude: -95.3 }],
        lookaheads: [{ id: 'L1', job_id: 'J9', week_start_date: '2026-11-09', status: 'draft' }],
        lookahead_activities: [{ id: 'A1', lookahead_id: 'L1', description: 'Pour parking lot', planned_date: '2026-11-09' }],
        profiles: [{ id: 'super1', full_name: 'Sam Super' }],
        pm_job_assignments: [],
      })
      as('super')
      const route = require('../app/api/lookaheads/route')
      const r = await call(route.PUT, '/api/lookaheads', 'PUT', { id: 'L1', status: 'submitted' })
      expect(r.status).toBe(200)
      const mail = sent().find(m => /Lookahead Submitted/.test(m.subject))
      expect(mail).toBeTruthy()
      expect(mail.html).toMatch(/Weather warnings/)
      expect(mail.html).toMatch(/Pour parking lot — ❄ Freeze risk \(low 27°F\)/)
    } finally { global.fetch = realFetch }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) tools', () => {
  const logs = require('../app/api/tool-logs/route')
  const tools = require('../app/api/tools/route')
  const { toolStatusFor, toolUpdateForAction, toolLogDenied, pickToolFields } = require('../lib/tool-actions')

  const seed = () => resetMockState({
    tools: [
      { id: 'T1', name: 'Drill', status: 'checked_out', assigned_to: 'super1', condition: 'good', purchase_cost: 199 },
      { id: 'T2', name: 'Saw', status: 'checked_out', assigned_to: 'super2', condition: 'good' },
      { id: 'T3', name: 'Laser', status: 'available', assigned_to: null, condition: 'good' },
    ],
    tool_logs: [],
    profiles: [
      { id: 'super1', full_name: 'Sam Super', role: 'super', email: 'sam@x.com' },
      { id: 'pm1', role: 'pm', email: 'pm1@x.com' },
      { id: 'principal1', role: 'principal', email: 'owner@x.com' },
      { id: 'admin1', role: 'admin', email: 'admin@x.com' },
    ],
    notifications: [],
  })
  beforeEach(seed)
  const T = id => mockState.db.tools.find(t => t.id === id)

  test('status follows the assignee', () => {
    expect(toolStatusFor('u1', 'available', null)).toBe('checked_out')
    expect(toolStatusFor('u1', undefined, 'available')).toBe('checked_out')
    expect(toolStatusFor(null, undefined, 'checked_out')).toBe('available')
    expect(toolStatusFor('u1', 'repair', null)).toBe('repair')
    expect(toolStatusFor('u1', 'lost', null)).toBe('lost')
    expect(toolStatusFor(null, 'lost', 'checked_out')).toBe('lost')
    expect(toolUpdateForAction('checkout').error).toBeTruthy()
    expect(toolUpdateForAction('checkin').updates).toEqual({ assigned_to: null, status: 'available' })
    expect(toolUpdateForAction('lost').updates).toEqual({ status: 'lost' })
    expect(toolUpdateForAction('damage').updates.status).toBe('repair')
    expect(toolUpdateForAction('maintenance').updates.status).toBe('repair')
    expect(pickToolFields({ name: 'x', logged_by: 'evil', id: 'T9', status: 'bogus', assigned_to: '' })).toEqual({ name: 'x', assigned_to: null })
    expect(toolLogDenied({ role: 'super', userId: 'super1' }, T('T1'), 'checkout').status).toBe(403)
  })

  test('super Check In clears the assignee and sets available; logged_by is the session', async () => {
    as('super')
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin', log_date: '2026-11-08', logged_by: 'someone-else' })
    expect(r.status).toBe(200)
    expect(T('T1')).toMatchObject({ assigned_to: null, status: 'available' })
    expect(mockState.db.tool_logs[0]).toMatchObject({ tool_id: 'T1', log_type: 'checkin', logged_by: 'super1', assigned_to: 'super1' })
    expect(r.body.tool).toMatchObject({ status: 'available' })
  })

  test('super cannot log on a tool assigned to someone else, or check one out', async () => {
    as('super')
    let r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T2', log_type: 'checkin' })
    expect(r.status).toBe(403)
    r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T3', log_type: 'checkout', assigned_to: 'super1' })
    expect(r.status).toBe(403)
    expect(mockState.db.tool_logs).toHaveLength(0)
    expect(T('T2').assigned_to).toBe('super2')
  })

  test('lost → Lost and the office is notified + emailed; damage → In Repair', async () => {
    as('super')
    let r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'lost', notes: 'Left at Conway site' })
    expect(r.status).toBe(200)
    expect(T('T1').status).toBe('lost')
    const bells = mockState.db.notifications.filter(n => n.type === 'tool_lost')
    expect(bells.map(n => n.recipient_id).sort()).toEqual(['pm1', 'principal1'])
    expect(bells[0].link).toBe('/dashboard?tab=tools')
    const lostMail = sent().find(m => /reported lost/.test(m.subject))
    expect(lostMail.html).toMatch(/https:\/\/portal\.nv\.construction\/dashboard\?tab=tools/)
    expect([...lostMail.to].sort()).toEqual(['pm1@x.com', 'principal1@x.com'])

    seed(); clearSent(); as('super')
    r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'damage', notes: 'Cracked housing' })
    expect(r.status).toBe(200)
    expect(T('T1')).toMatchObject({ status: 'repair', condition: 'poor' })
    expect(mockState.db.notifications.some(n => n.type === 'tool_damage')).toBe(true)
  })

  test('maintenance needs a description from a super; a failed tool update undoes the log', async () => {
    as('super')
    let r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'maintenance' })
    expect(r.status).toBe(400)
    mockState.failWrite = { tools: { update: 'boom' } }
    r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })
    expect(r.status).toBe(500)
    expect(mockState.db.tool_logs).toHaveLength(0)
  })

  test('H2: super check-in after the office reassigned the tool → 409, B keeps it, no history row', async () => {
    as('super')
    // Office reassigns T1 to super2 after the route read/authorized T1 but before the tools UPDATE.
    mockState.beforeWrite = (table, op) => {
      if (table === 'tools' && op === 'update') Object.assign(T('T1'), { assigned_to: 'super2', status: 'checked_out' })
    }
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })
    expect(r.status).toBe(409)
    expect(T('T1')).toMatchObject({ assigned_to: 'super2', status: 'checked_out' })
    expect(mockState.db.tool_logs).toHaveLength(0)
    expect(mockState.db.notifications).toHaveLength(0)
  })

  test('H2: lost / damage after reassignment cannot mark the new holder\'s tool', async () => {
    for (const action of ['lost', 'damage']) {
      seed(); clearSent(); as('super')
      mockState.beforeWrite = (table, op) => { if (table === 'tools' && op === 'update') T('T1').assigned_to = 'super2' }
      const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: action, notes: 'x' })
      expect([action, r.status]).toEqual([action, 409])
      expect(T('T1')).toMatchObject({ assigned_to: 'super2', status: 'checked_out', condition: 'good' })
      expect(mockState.db.tool_logs).toHaveLength(0)
      expect(sent()).toHaveLength(0)
    }
  })

  test('H2: the update is pinned to the authorized snapshot (super → assigned_to = session user)', () => {
    const { toolCasFilters } = require('../lib/tool-actions')
    expect(toolCasFilters({ role: 'super', userId: 'super1' }, T('T1'))).toEqual([['assigned_to', 'super1'], ['status', 'checked_out']])
    expect(toolCasFilters({ role: 'pm', userId: 'pm1' }, T('T3'))).toEqual([['assigned_to', null], ['status', 'available']])
  })

  test('H2: office status change in between also conflicts; a PM on an unchanged tool still works', async () => {
    as('super')
    mockState.beforeWrite = (table, op) => { if (table === 'tools' && op === 'update') T('T1').status = 'repair' }
    expect((await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })).status).toBe(409)
    expect(T('T1')).toMatchObject({ assigned_to: 'super1', status: 'repair' })
    seed(); as('pm')
    mockState.beforeWrite = (table, op) => { if (table === 'tools' && op === 'update') T('T3').assigned_to = 'super2' }
    expect((await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T3', log_type: 'checkout', assigned_to: 'super1' })).status).toBe(409)
    expect(T('T3').assigned_to).toBe('super2')
  })

  test('H2 leftover: the inventory CAS runs before the history insert; a CAS miss never writes a log', async () => {
    as('super')
    const order = []
    mockState.beforeWrite = (table, op) => {
      order.push(`${table}:${op}`)
      if (table === 'tools' && op === 'update') Object.assign(T('T1'), { assigned_to: 'super2', status: 'checked_out' })
    }
    // Even if a compensating DELETE were attempted, it would fail.
    mockState.failWrite = { tool_logs: { delete: 'delete failed' } }
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })
    expect(r.status).toBe(409)
    expect(T('T1')).toMatchObject({ assigned_to: 'super2', status: 'checked_out' })
    expect(mockState.db.tool_logs).toHaveLength(0)
    expect(order).toEqual(['tools:update']) // no tool_logs insert, no delete
    expect(mockState.calls.some(c => c.table === 'tool_logs')).toBe(false)
  })

  test('H2 leftover: lost / damage CAS conflict leaves no history row even when a DELETE would fail', async () => {
    for (const action of ['lost', 'damage']) {
      seed(); clearSent(); as('super')
      mockState.failWrite = { tool_logs: { delete: 'delete failed' } }
      mockState.beforeWrite = (table, op) => { if (table === 'tools' && op === 'update') T('T1').assigned_to = 'super2' }
      const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: action, notes: 'x' })
      expect([action, r.status]).toEqual([action, 409])
      expect(T('T1')).toMatchObject({ assigned_to: 'super2', status: 'checked_out', condition: 'good' })
      expect(mockState.db.tool_logs).toHaveLength(0)
      expect(mockState.db.notifications).toHaveLength(0)
      expect(sent()).toHaveLength(0)
    }
  })

  test('H2 leftover: history insert fails after the tool update → tool change reversed, 500, no log', async () => {
    as('super')
    mockState.failWrite = { tool_logs: { insert: 'insert failed' } }
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'damage', notes: 'x' })
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/Nothing was changed/)
    expect(T('T1')).toMatchObject({ assigned_to: 'super1', status: 'checked_out', condition: 'good' })
    expect(mockState.db.tool_logs).toHaveLength(0)
    expect(mockState.db.notifications).toHaveLength(0)
    // The reversal is compare-and-set on what we wrote.
    const updates = mockState.calls.filter(c => c.table === 'tools' && c.op === 'update')
    expect(updates.map(c => c.payload)).toEqual([{ status: 'repair', condition: 'poor' }, { status: 'checked_out', condition: 'good' }])
  })

  test('H2 leftover: insert fails and the tool changed again before the reversal → 500, newer change kept', async () => {
    as('super')
    mockState.failWrite = { tool_logs: { insert: 'insert failed' } }
    let n = 0
    mockState.beforeWrite = (table, op) => {
      // Office checks the tool out to super2 between our update and our reversal.
      if (table === 'tools' && op === 'update' && ++n === 2) Object.assign(T('T1'), { assigned_to: 'super2', status: 'checked_out' })
    }
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/could not be undone/)
    expect(r.body.ok).toBeUndefined()
    expect(T('T1')).toMatchObject({ assigned_to: 'super2', status: 'checked_out' })
    expect(mockState.db.tool_logs).toHaveLength(0)
  })

  test('H2 leftover: insert fails and the reversal UPDATE errors → 500, never success', async () => {
    as('super')
    let n = 0
    mockState.failWrite = { tool_logs: { insert: 'insert failed' }, tools: op => (op === 'update' && ++n === 2 ? 'revert failed' : null) }
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T1', log_type: 'checkin' })
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/could not be undone/)
    expect(mockState.db.tool_logs).toHaveLength(0)
  })

  test('PM checkout assigns and sets checked_out', async () => {
    as('pm')
    const r = await call(logs.POST, '/api/tool-logs', 'POST', { tool_id: 'T3', log_type: 'checkout', assigned_to: 'super1' })
    expect(r.status).toBe(200)
    expect(T('T3')).toMatchObject({ assigned_to: 'super1', status: 'checked_out' })
  })

  test('supers (and admin) cannot edit or delete tools; Owner/PM/APM retire instead of delete', async () => {
    for (const role of ['super', 'admin']) {
      as(role)
      expect((await call(tools.PUT, '/api/tools', 'PUT', { id: 'T1', purchase_cost: 1, assigned_to: `${role}1` })).status).toBe(403)
      expect((await call(tools.DELETE, '/api/tools', 'DELETE', { id: 'T1' })).status).toBe(403)
    }
    expect(T('T1')).toMatchObject({ purchase_cost: 199, assigned_to: 'super1' })
    as('apm')
    const r = await call(tools.DELETE, '/api/tools', 'DELETE', { id: 'T1' })
    expect(r.status).toBe(200)
    expect(T('T1')).toMatchObject({ status: 'retired', assigned_to: null })
    expect(mockState.calls.some(c => c.table === 'tools' && c.op === 'delete')).toBe(false)
  })

  test('Add / Edit / field purchase set checked_out when someone is assigned', async () => {
    as('pm')
    let r = await call(tools.POST, '/api/tools', 'POST', { name: 'Nailer', assigned_to: 'super1', status: 'available' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ assigned_to: 'super1', status: 'checked_out' })
    expect(mockState.db.tool_logs.some(l => l.tool_id === r.body.data.id && l.log_type === 'checkout' && l.logged_by === 'pm1')).toBe(true)

    r = await call(tools.PUT, '/api/tools', 'PUT', { id: 'T3', assigned_to: 'super1', status: 'available' })
    expect(r.body.data).toMatchObject({ assigned_to: 'super1', status: 'checked_out' })
    r = await call(tools.PUT, '/api/tools', 'PUT', { id: 'T3', assigned_to: '' })
    expect(r.body.data).toMatchObject({ assigned_to: null, status: 'available' })

    as('super')
    r = await call(tools.POST, '/api/tools', 'POST', { name: 'Grinder', assigned_to: 'someone-else', status: 'available' })
    expect(r.body.data).toMatchObject({ assigned_to: 'super1', status: 'checked_out' })
  })

  test('field app sends no logged_by and uses the server result', () => {
    const src = read('app/field/page.js')
    const fn = src.slice(src.indexOf('async function submitToolLog'), src.indexOf('async function loadVehicleLogsForVehicle'))
    expect(fn).not.toMatch(/logged_by:/)
    expect(fn).toMatch(/authFetch\('\/api\/tool-logs'/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) Friday mileage reminder', () => {
  const { weeklyMileageLogged, vehicleLogLabel } = require('../lib/vehicle-log-types')
  const route = require('../app/api/mileage-reminder/route')
  const { mondayOf } = require('../lib/lookahead-dates')
  const { todayCentral } = require('../lib/central-date')

  test('any mileage since Monday counts', () => {
    const mon = '2026-11-02'
    expect(weeklyMileageLogged([{ log_type: 'Mileage Update', log_date: '2026-11-04', mileage: 54200 }], mon)).toBe(true)
    expect(weeklyMileageLogged([{ log_type: 'Oil Change', log_date: '2026-11-02', mileage: '54210' }], mon)).toBe(true)
    expect(weeklyMileageLogged([{ log_type: 'Weekly Miles', log_date: '2026-11-06', mileage: null }], mon)).toBe(true)
    expect(weeklyMileageLogged([{ log_type: 'Mileage Update', log_date: '2026-11-04', mileage: null }], mon)).toBe(false)
    expect(weeklyMileageLogged([{ log_type: 'Weekly Miles', log_date: '2026-11-01', mileage: 1 }], mon)).toBe(false)
    expect(vehicleLogLabel('Mileage Update')).toBe('Extra / mid-week reading')
    expect(vehicleLogLabel('Weekly Miles')).toBe('Weekly Miles')
  })

  test('cron: a Mileage Update with an odometer reading suppresses the email', async () => {
    const mon = mondayOf(todayCentral())
    resetMockState({
      vehicles: [
        { id: 'V1', name: 'F-150', assigned_to: 'super1', profiles: { full_name: 'Sam', role: 'super' } },
        { id: 'V2', name: 'Tacoma', assigned_to: 'super2', profiles: { full_name: 'Pat', role: 'super' } },
      ],
      vehicle_logs: [
        { id: 'l1', vehicle_id: 'V1', log_type: 'Mileage Update', log_date: mon, mileage: 54200 },
        { id: 'l2', vehicle_id: 'V2', log_type: 'Mileage Update', log_date: mon, mileage: null },
      ],
    })
    const res = await route.GET(new Request('http://x/api/mileage-reminder'))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, sent: 1, checked: 2 })
    expect(sent().map(m => m.to)).toEqual(['super2@x.com'])
  })

  test('field form defaults / resets to Weekly Miles; office list has Weekly Miles; labels relabelled', () => {
    const field = read('app/field/page.js')
    expect(field).not.toMatch(/log_type: 'Mileage Update', log_date/)
    expect((field.match(/log_type: 'Weekly Miles', log_date: localToday\(\)/g) || []).length).toBe(2)
    expect(field).toMatch(/LOG_TYPES\.map\(t => <option key=\{t\} value=\{t\}>\{vehicleLogLabel\(t\)\}/)
    const dash = read('app/dashboard/page.js')
    expect(dash).toMatch(/const LOG_TYPES = \['Weekly Miles', 'Mileage Update'/)
    expect(dash).toMatch(/LOG_TYPES_APM\.map\(t => <option key=\{t\} value=\{t\}>\{vehicleLogLabel\(t\)\}/)
    expect(read('vercel.json')).toMatch(/"\/api\/mileage-reminder"[\s\S]{0,80}"0 21 \* \* 5"/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4) W-9 / COI reminders and COI upload', () => {
  const { coiState, coiNeedsReminder, coiUploadError } = require('../lib/coi-status')
  const subDocs = require('../app/api/sub-docs/route')
  const now = new Date('2026-11-08T18:00:00Z')

  test('COI status from the file and the date', () => {
    expect(coiState({}, now)).toBe('missing')
    expect(coiState({ coi_url: 'd/coi.pdf' }, now)).toBe('no_date')
    expect(coiState({ coi_url: 'd/coi.pdf', coi_expiration: '2026-11-07' }, now)).toBe('expired')
    expect(coiState({ coi_url: 'd/coi.pdf', coi_expiration: '2026-11-08' }, now)).toBe('expiring')
    expect(coiState({ coi_url: 'd/coi.pdf', coi_expiration: '2027-06-01' }, now)).toBe('ok')
    expect(coiNeedsReminder({ coi_url: 'd/coi.pdf' }, now)).toBe(true)
    expect(coiNeedsReminder({ coi_url: 'd/coi.pdf', coi_expiration: '2027-06-01' }, now)).toBe(false)
    expect(coiUploadError({ coi_url: 'x' })).toMatch(/expiration/)
    expect(coiUploadError({ coi_url: 'x', coi_expiration: '2027-01-31' })).toBeNull()
    expect(coiUploadError({ w9_url: 'x' })).toBeNull()
  })

  test('office COI replace without a date is refused; with a date both are saved', async () => {
    resetMockState({ sub_directory: [{ id: 'D1', company_name: 'JC Concreteworks', coi_url: 'D1/coi-old.pdf', coi_expiration: '2025-01-01' }] })
    as('pm')
    let r = await call(subDocs.POST, '/api/sub-docs', 'POST', { directory_id: 'D1', coi_url: 'D1/coi-new.pdf' })
    expect(r.status).toBe(400)
    expect(mockState.db.sub_directory[0].coi_url).toBe('D1/coi-old.pdf')
    r = await call(subDocs.POST, '/api/sub-docs', 'POST', { directory_id: 'D1', coi_url: 'D1/coi-new.pdf', coi_expiration: '2027-03-01' })
    expect(r.status).toBe(200)
    expect(mockState.db.sub_directory[0]).toMatchObject({ coi_url: 'D1/coi-new.pdf', coi_expiration: '2027-03-01' })
    // Edit form re-sending the same file without touching the date is not a new upload
    r = await call(subDocs.POST, '/api/sub-docs', 'POST', { directory_id: 'D1', coi_url: 'D1/coi-new.pdf', phone: '555' })
    expect(r.status).toBe(200)
  })

  test('both sendDocRequest calls use authFetch; uploads check storage + save', () => {
    for (const p of ['app/dashboard/page.js', 'app/admin/page.js']) {
      const src = read(p)
      const fn = src.slice(src.indexOf('async function sendDocRequest'), src.indexOf('async function sendDocRequest') + 800)
      expect([p, /authFetch\('\/api\/doc-request'/.test(fn)]).toEqual([p, true])
      expect([p, /[^h]fetch\('\/api\/doc-request'/.test(fn)]).toEqual([p, false])
      const up = src.slice(src.indexOf('async function uploadSubDoc'), src.indexOf('async function uploadSubDoc') + 2500)
      expect(up).toMatch(/coi_expiration: coiExpiration/)
      expect(up).toMatch(/!put(Res)?\.ok/)
      expect(up).toMatch(/!saveRes\.ok/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) owner pay applications', () => {
  const { ownerPayApps } = require('../lib/owner-pay-apps')
  const { aiaCurrentPaymentDue } = require('../lib/cash-outlook')
  const route = require('../app/api/owner-pay-apps/route')

  const budget = [{ id: 'B1', job_id: 'J1', budget_amount: 100000, owner_amount: null }]
  const apps = [
    { id: 'A1', job_id: 'J1', app_number: 1, status: 'submitted', retainage_pct: 10, period_to: '2026-09-30', created_at: '2026-10-01T00:00:00Z' },
    { id: 'A2', job_id: 'J1', app_number: 2, status: 'certified', retainage_pct: 10, period_to: '2026-10-31', created_at: '2026-11-01T00:00:00Z' },
    { id: 'A3', job_id: 'J1', app_number: 3, status: null, retainage_pct: 10 },
    { id: 'A4', job_id: 'J1', app_number: 1, status: 'submitted', nv_subcontract_id: 'NS1', retainage_pct: 10 },
  ]
  const linesByApp = {
    A1: [{ application_id: 'A1', budget_item_id: 'B1', dollar_prev: 0, dollar_this_period: 20000 }],
    A2: [{ application_id: 'A2', budget_item_id: 'B1', dollar_prev: 20000, dollar_this_period: 30000 }],
    A3: [{ application_id: 'A3', budget_item_id: 'B1', dollar_prev: 50000, dollar_this_period: 10000 }],
  }

  test('app_number + aiaCurrentPaymentDue, drafts and NV-as-sub apps left out', () => {
    const r = ownerPayApps({ apps, linesByApp, budgetItems: budget })
    expect(r.apps.map(a => a.app_number)).toEqual([1, 2])
    const prime = apps.filter(a => !a.nv_subcontract_id)
    expect(r.apps[0].current_payment_due).toBe(aiaCurrentPaymentDue({ app: apps[0], apps: prime, linesByApp, budgetItems: budget }).due)
    expect(r.apps.map(a => a.current_payment_due)).toEqual([18000, 27000])
    expect(r.billed_to_date).toBe(45000)
    expect(r.has_aia).toBe(true)
  })

  test('a $0 AIA total is still AIA (no draw fallback)', () => {
    const r = ownerPayApps({ apps: [{ id: 'Z', job_id: 'J1', app_number: 1, status: 'submitted' }], linesByApp: {}, budgetItems: budget })
    expect(r).toMatchObject({ billed_to_date: 0, has_aia: true })
    const page = read('app/owner/page.js')
    expect(page).not.toMatch(/application_number|net_payment|drawBilled|aiaBilled \|\|/)
    expect(page).toMatch(/const totalBilled = payAppsInfo\.billed_to_date/)
    expect(page).toMatch(/a\.app_number/)
    expect(page).not.toMatch(/a\.status \|\| 'submitted'/)
  })

  test('route: owner on the job gets the payload; another owner is refused', async () => {
    resetMockState({
      jobs: [{ id: 'J1', owner_email: 'Client@Braums.test' }],
      aia_applications: apps,
      aia_application_lines: Object.values(linesByApp).flat(),
      budget_items: budget,
    })
    as('owner', 'o1', 'client@braums.test')
    let r = await call(route.GET, '/api/owner-pay-apps?job_id=J1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.apps.map(a => [a.app_number, a.current_payment_due, a.status])).toEqual([[1, 18000, 'submitted'], [2, 27000, 'certified']])
    expect(r.body.billed_to_date).toBe(45000)
    as('owner', 'o2', 'someone@else.test')
    r = await call(route.GET, '/api/owner-pay-apps?job_id=J1', 'GET')
    expect(r.status).toBe(403)
    as('subcontractor')
    expect((await call(route.GET, '/api/owner-pay-apps?job_id=J1', 'GET')).status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('6) bid leveling', () => {
  const L = require('../lib/bid-leveling')
  const route = require('../app/api/bid-leveling/route')

  test('blank is not quoted, 0 is a quote; first click on an empty cell = included', () => {
    expect(L.parseLevelingAmount('')).toEqual({ amount: null })
    expect(L.parseLevelingAmount('  ')).toEqual({ amount: null })
    expect(L.parseLevelingAmount('0')).toEqual({ amount: 0 })
    expect(L.parseLevelingAmount('$12,500')).toEqual({ amount: 12500 })
    expect(L.parseLevelingAmount('abc').error).toBeTruthy()
    expect(L.nextIncluded(undefined)).toBe(true)
    expect(L.nextIncluded({ included: true })).toBe(false)
    expect(L.nextIncluded({ included: false })).toBe(true)
  })

  test('excluded amounts are left out of the leveled total; gaps and General', () => {
    const items = [{ id: 'i1', trade: 'Concrete' }, { id: 'i2', trade: null }, { id: 'i3', trade: 'Concrete' }]
    const subs = [{ id: 's1', amount: 30000, trade: 'Concrete' }, { id: 's2', amount: 31000, trade: null }, { id: 's3', amount: 5, trade: 'Roofing' }]
    const map = L.entryMap([
      { bid_submission_id: 's1', bid_scope_item_id: 'i1', amount: 20000, included: true },
      { bid_submission_id: 's1', bid_scope_item_id: 'i2', amount: 5000, included: false },
      { bid_submission_id: 's1', bid_scope_item_id: 'i3', amount: null, included: true },
      { bid_submission_id: 's2', bid_scope_item_id: 'i2', amount: 0, included: false },
      { bid_submission_id: 's3', bid_scope_item_id: 'i2', amount: 1, included: false },
    ])
    expect(L.leveledTotal(subs[0], items, map)).toBe(20000)
    expect(L.gapItems(items, subs, map).map(i => i.id)).toEqual(['i2'])
    expect(L.groupByTrade(items).map(([t, its]) => [t, its.map(i => i.id)])).toEqual([['Concrete', ['i1', 'i3']], ['General', ['i2']]])
    expect(L.subsForTrade(subs, 'Concrete').map(s => s.id)).toEqual(['s1', 's2'])
    expect(L.subsForTrade(subs, 'General').map(s => s.id)).toEqual(['s1', 's2', 's3'])
  })

  const seed = () => resetMockState({
    bid_packages: [{ id: 'P1', job_id: null, allowed_users: ['apm1'] }, { id: 'P2', job_id: null, allowed_users: [] }],
    bid_submissions: [{ id: 'S1', bid_package_id: 'P1' }, { id: 'S9', bid_package_id: 'P2' }],
    bid_scope_items: [{ id: 'I1', bid_package_id: 'P1' }],
    bid_leveling_entries: [],
  })
  beforeEach(seed)

  test('server route: blank saves null, first toggle included, supers / unlisted APMs refused', async () => {
    as('pm')
    let r = await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: '' })
    expect(r.status).toBe(200)
    expect(mockState.db.bid_leveling_entries).toEqual([expect.objectContaining({ amount: null, included: true })])
    r = await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: '0' })
    expect(mockState.db.bid_leveling_entries).toHaveLength(1)
    expect(mockState.db.bid_leveling_entries[0].amount).toBe(0)
    r = await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', included: false })
    expect(mockState.db.bid_leveling_entries[0]).toMatchObject({ amount: 0, included: false })

    as('super')
    r = await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: '9' })
    expect(r.status).toBe(403)
    r = await call(route.GET, '/api/bid-leveling?bid_package_id=P1', 'GET')
    expect(r.status).toBe(200) // supers can read (read-only)

    as('apm', 'apm2')
    expect((await call(route.GET, '/api/bid-leveling?bid_package_id=P1', 'GET')).status).toBe(403)
    expect((await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: '9' })).status).toBe(403)
    as('apm', 'apm1')
    expect((await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: '9' })).status).toBe(200)

    as('pm')
    r = await call(route.PUT, '/api/bid-leveling', 'PUT', { bid_package_id: 'P1', bid_submission_id: 'S9', bid_scope_item_id: 'I1', amount: '1' })
    expect(r.status).toBe(404)
  })

  test('both screens use the shared matrix through the server; bid page passes canEdit', () => {
    const bid = read('app/bid/[id]/page.js')
    const dash = read('app/dashboard/page.js')
    for (const src of [bid, dash]) {
      expect(src).not.toMatch(/from\('bid_leveling_entries'\)/)
      expect(src).toMatch(/<LevelingMatrix/)
    }
    expect(bid).toMatch(/<LevelingSection[^>]*canEdit=\{canEdit\}/)
    expect(dash).toMatch(/canEdit=\{canEditBidPackage\(profile\?\.role, profile\?\.id, pkg\)\}/)
    const m = read('app/components/bid/LevelingMatrix.js')
    expect(m).toMatch(/nextIncluded\(entry\)/)
    expect(m).toMatch(/onBlur=\{\(\) => flushAmount/)
    expect(m).toMatch(/DEBOUNCE_MS/)
  })
})

test('6) leveling matrix: an older save response for a cell cannot overwrite a newer one', () => {
  const src = read('lib/leveling-cell-saves.js')
  const fn = src.slice(src.indexOf('async function commit'), src.indexOf('function flushAmount'))
  expect(fn).toMatch(/const seq = \(reqSeq\.current\[k\] \|\| 0\) \+ 1/)
  const awaitAt = fn.indexOf('await io.saveCell')
  const guardAt = fn.indexOf('if (reqSeq.current[k] !== seq) return false')
  expect(guardAt).toBeGreaterThan(awaitAt)
  expect(guardAt).toBeLessThan(fn.indexOf('io.onEntry?.(r.entry)'))
  expect(guardAt).toBeLessThan(fn.indexOf('io.setErrors'))
  // flushAmount only clears the draft when commit returned true for unchanged text.
  expect(src).toMatch(/commit\(sub, item, \{ amount: p\.amount \}\)\.then\(ok => \{ if \(ok && draftsRef\.current\[k\] === text\) io\.clearDraft\(k\)/)
  // The matrix uses the shared ops.
  expect(read('app/components/bid/LevelingMatrix.js')).toMatch(/levelingCellOps\(\s*\{ reqSeq, inFlight, chains, draftsRef, entriesRef, timers \}/)
})

describe('6) leveling matrix: per-cell save interleavings (lib/leveling-cell-saves)', () => {
  const { levelingCellOps } = require('../lib/leveling-cell-saves')
  const sub = { id: 'S1' }
  const item = { id: 'I1' }
  const K = 'S1_I1'

  // A harness that mimics the component: drafts, saved entries, deferred server responses.
  function harness(savedAmount) {
    const state = { reqSeq: { current: {} }, inFlight: { current: {} }, draftsRef: { current: {} }, entriesRef: { current: [{ bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: savedAmount, included: true }] }, timers: { current: {} } }
    const requests = [] // { body, resolve }
    let saving = {}
    let errors = {}
    const io = {
      bidPackageId: 'P1',
      saveCell: body => new Promise(resolve => requests.push({ body, resolve })),
      onEntry: entry => { state.entriesRef.current = [entry] },
      setSaving: f => { saving = f(saving) },
      setErrors: f => { errors = f(errors) },
      clearDraft: k => { const { [k]: _, ...rest } = state.draftsRef.current; state.draftsRef.current = rest },
    }
    const ops = levelingCellOps(state, io)
    const type = text => { state.draftsRef.current = { ...state.draftsRef.current, [K]: text } }
    const amount = () => state.entriesRef.current[0].amount
    const reply = (i, amt) => requests[i].resolve({ entry: { bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: amt, included: true } })
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
    return { state, ops, type, amount, reply, requests, flush, get saving() { return saving }, get errors() { return errors } }
  }

  test('saved 0 → type 100 (in flight) → type 0: the revert is queued behind the 100, sent after it, and the late 100 cannot win', async () => {
    const h = harness(0)
    h.type('100'); const p1 = h.ops.flushAmount(sub, item)
    await h.flush()
    expect(h.requests.map(r => r.body.amount)).toEqual([100])
    h.type('0'); const p2 = h.ops.flushAmount(sub, item)
    await h.flush()
    // The compensating 0 is NOT a no-op (it bumped the sequence) but waits for the 100 to finish.
    expect(h.state.reqSeq.current[K]).toBe(2)
    expect(h.requests.map(r => r.body.amount)).toEqual([100])
    // The 100 finishes: its response is ignored, and only then is the 0 sent.
    h.reply(0, 100); expect(await p1).toBe(false)
    await h.flush()
    expect(h.amount()).toBe(0) // older response never onEntry'd
    expect(h.state.draftsRef.current[K]).toBe('0') // the newer intent is still on screen
    expect(h.saving).toEqual({ [K]: true })
    expect(h.requests.map(r => r.body.amount)).toEqual([100, 0])
    h.reply(1, 0); expect(await p2).toBe(true)
    expect(h.amount()).toBe(0)
    expect(K in h.state.draftsRef.current).toBe(false)
    expect(h.saving).toEqual({})
  })

  test('only the latest queued amount is sent once the in-flight save finishes', async () => {
    const h = harness(0)
    h.type('100'); const p1 = h.ops.flushAmount(sub, item)
    h.type('200'); const p2 = h.ops.flushAmount(sub, item)
    h.type('0'); const p3 = h.ops.flushAmount(sub, item)
    await h.flush()
    expect(h.requests.map(r => r.body.amount)).toEqual([100])
    h.reply(0, 100); expect(await p1).toBe(false)
    expect(await p2).toBe(false) // superseded while queued: never sent
    await h.flush()
    expect(h.requests.map(r => r.body.amount)).toEqual([100, 0])
    h.reply(1, 0); expect(await p3).toBe(true)
    expect(h.amount()).toBe(0)
    expect(K in h.state.draftsRef.current).toBe(false)
  })

  test('a failed in-flight save still lets the queued newer save go out', async () => {
    const h = harness(0)
    h.type('100'); const p1 = h.ops.flushAmount(sub, item)
    h.type('0'); const p2 = h.ops.flushAmount(sub, item)
    await h.flush()
    h.requests[0].resolve({ error: 'boom' }); expect(await p1).toBe(false)
    expect(h.errors).toEqual({}) // stale error is ignored too
    await h.flush()
    expect(h.requests.map(r => r.body.amount)).toEqual([100, 0])
    h.reply(1, 0); expect(await p2).toBe(true)
    expect(h.amount()).toBe(0)
  })

  test('an included toggle queued behind an amount save is still sent (different field)', async () => {
    const h = harness(0)
    h.type('100'); const p1 = h.ops.flushAmount(sub, item)
    const p2 = h.ops.commit(sub, item, { included: false })
    await h.flush()
    expect(h.requests).toHaveLength(1)
    h.reply(0, 100); await p1; await h.flush()
    expect(h.requests.map(r => r.body)).toEqual([expect.objectContaining({ amount: 100 }), expect.objectContaining({ included: false })])
    h.requests[1].resolve({ entry: { bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: 100, included: false } })
    expect(await p2).toBe(true)
  })

  test('typing the saved amount with nothing in flight is still a no-op', async () => {
    const h = harness(0)
    h.type('0'); h.ops.flushAmount(sub, item)
    expect(h.requests).toHaveLength(0)
    expect(K in h.state.draftsRef.current).toBe(false)
    // After a save completes, a matching amount is a no-op again.
    h.type('50'); const p = h.ops.flushAmount(sub, item); h.reply(0, 50); await p
    h.type('50'); h.ops.flushAmount(sub, item)
    expect(h.requests).toHaveLength(1)
  })

  test('a newer non-revert save still beats an older in-flight one (reqSeq not regressed)', async () => {
    const h = harness(null)
    h.type('100'); const p1 = h.ops.flushAmount(sub, item)
    h.type('200'); const p2 = h.ops.flushAmount(sub, item)
    await h.flush()
    h.reply(0, 100); expect(await p1).toBe(false)
    expect(h.amount()).toBe(null)
    await h.flush()
    expect(h.requests.map(r => r.body.amount)).toEqual([100, 200])
    h.reply(1, 200); await p2
    expect(h.amount()).toBe(200)
  })

  test('different cells are not serialized against each other', async () => {
    const h = harness(0)
    h.type('100'); h.ops.flushAmount(sub, item)
    h.state.draftsRef.current = { ...h.state.draftsRef.current, S2_I1: '5' }
    h.ops.flushAmount({ id: 'S2' }, item)
    await h.flush()
    expect(h.requests.map(r => [r.body.bid_submission_id, r.body.amount])).toEqual([['S1', 100], ['S2', 5]])
  })
})

describe('6) leveling matrix: persisted amount after a revert, helper + real PUT/GET', () => {
  const { levelingCellOps } = require('../lib/leveling-cell-saves')
  const route = require('../app/api/bid-leveling/route')
  const sub = { id: 'S1' }
  const item = { id: 'I1' }
  const K = 'S1_I1'
  const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)) }

  beforeEach(() => resetMockState({
    bid_packages: [{ id: 'P1', job_id: null, allowed_users: [] }],
    bid_submissions: [{ id: 'S1', bid_package_id: 'P1' }],
    bid_scope_items: [{ id: 'I1', bid_package_id: 'P1' }],
    bid_leveling_entries: [{ id: 'E1', bid_submission_id: 'S1', bid_scope_item_id: 'I1', amount: 0, included: true }],
  }))

  test('0 → type 100 (DB write paused) → type 0: the 100 write lands first, 0 is persisted and reloaded', async () => {
    as('pm')
    const state = { reqSeq: { current: {} }, inFlight: { current: {} }, chains: { current: {} }, draftsRef: { current: {} }, entriesRef: { current: [...mockState.db.bid_leveling_entries.map(e => ({ ...e }))] }, timers: { current: {} } }
    const puts = []
    const io = {
      bidPackageId: 'P1',
      saveCell: async body => {
        puts.push(body.amount)
        const r = await call(route.PUT, '/api/bid-leveling', 'PUT', body)
        return r.status === 200 ? { entry: r.body.entry } : { error: r.body.error }
      },
      onEntry: entry => { state.entriesRef.current = [entry] },
      setSaving: () => {}, setErrors: () => {},
      clearDraft: k => { const { [k]: _, ...rest } = state.draftsRef.current; state.draftsRef.current = rest },
    }
    const writes = []
    let release
    const gate = new Promise(r => { release = r })
    let reached
    const paused = new Promise(r => { reached = r })
    mockState.pauseWrite = async (table, op, payload) => {
      if (table !== 'bid_leveling_entries' || op !== 'update') return
      if (payload.amount === 100) { reached(); await gate }
      writes.push(payload.amount)
    }
    const ops = levelingCellOps(state, io)
    const type = t => { state.draftsRef.current = { ...state.draftsRef.current, [K]: t } }

    // 1. Type 100 and flush; its PUT pauses right before the UPDATE.
    type('100'); const p1 = ops.flushAmount(sub, item)
    await paused
    // 2. Type 0 and flush while the 100 is paused: queued, not sent, not a no-op.
    type('0'); const p2 = ops.flushAmount(sub, item)
    await tick()
    expect(puts).toEqual([100])
    expect(state.reqSeq.current[K]).toBe(2)
    // 3. Release the 100 UPDATE: it lands, its response is ignored, then the 0 is sent and written.
    release()
    expect(await p1).toBe(false)
    expect(await p2).toBe(true)
    expect(puts).toEqual([100, 0])
    expect(writes).toEqual([100, 0])
    // 4. Screen, DB and a reload all agree on 0; draft cleared.
    expect(state.entriesRef.current[0].amount).toBe(0)
    expect(K in state.draftsRef.current).toBe(false)
    expect(mockState.db.bid_leveling_entries[0].amount).toBe(0)
    const g = await call(route.GET, '/api/bid-leveling?bid_package_id=P1', 'GET')
    expect(g.status).toBe(200)
    expect(g.body.entries.map(e => e.amount)).toEqual([0])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('7) staff RFIs are numbered and open', () => {
  const route = require('../app/api/rfis/staff/route')
  const seed = () => resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Russellville', pm_email: null }, { id: 'J2', pm_email: null }],
    pm_job_assignments: [{ id: 'pa1', job_id: 'J1', user_id: 'super1' }],
    rfis: [{ id: 'r1', job_id: 'J1', number: 4 }, { id: 'r2', job_id: 'J1', number: null }, { id: 'r3', job_id: 'J2', number: 9 }],
    profiles: [{ id: 'super1', full_name: 'Sam Super' }],
  })
  beforeEach(seed)

  test('super on the job: next number, status open, super_id from the session', async () => {
    as('super')
    const r = await call(route.POST, '/api/rfis/staff', 'POST', { job_id: 'J1', title: 'Panel location', description: 'Where does MDP go?', super_id: 'spoof', number: 1 })
    expect(r.status).toBe(200)
    expect(r.body.rfi).toMatchObject({ job_id: 'J1', number: 5, status: 'open', super_id: 'super1', title: 'Panel location' })
  })

  test('refused off the job, for subs, and without details', async () => {
    as('super')
    expect((await call(route.POST, '/api/rfis/staff', 'POST', { job_id: 'J2', title: 'x', description: 'y' })).status).toBe(403)
    expect((await call(route.POST, '/api/rfis/staff', 'POST', { job_id: 'J1', title: 'x' })).status).toBe(400)
    as('subcontractor')
    expect((await call(route.POST, '/api/rfis/staff', 'POST', { job_id: 'J1', title: 'x', description: 'y' })).status).toBe(403)
    expect(mockState.db.rfis).toHaveLength(3)
  })

  test('route uses insertNumberedRfi; field app has no browser insert; RFI # shown', () => {
    expect(read('app/api/rfis/staff/route.js')).toMatch(/insertNumberedRfi\(adminSupabase, \{[\s\S]*status: 'open'/)
    const field = read('app/field/page.js')
    expect(field).not.toMatch(/from\('rfis'\)\.insert/)
    expect(field).toMatch(/authFetch\('\/api\/rfis\/staff'/)
    expect(field).toMatch(/RFI #\{rfi\.number\}/)
    expect(read('app/jobdetail/page.js')).toMatch(/RFI #\{rfi\.number\}/)
    expect(read('app/residentialjobdetail/page.js')).toMatch(/RFI #\{r\.number\}/)
    const owner = read('app/owner/page.js')
    expect(owner).toMatch(/RFI #\{rfi\.number \?\? '—'\}/)
    expect(owner).not.toMatch(/rfi_number/)
  })

  test('backfill migration is 057, numbers by created_at, not 051/052', () => {
    const sql = read('migrations/057_rfi_number_backfill.sql')
    expect(sql).toMatch(/PARTITION BY r\.job_id ORDER BY r\.created_at/)
    expect(sql).toMatch(/NOT APPLIED/)
    const files = fs.readdirSync(path.join(root, 'migrations'))
    expect(files.some(f => /^05[12]_/.test(f))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('8) notifications', () => {
  const { notificationLabel, fieldTarget, rfiAnsweredLink, fieldTabFromParam } = require('../lib/notification-labels')

  test('label map covers the newer types', () => {
    expect(notificationLabel('lookahead_approved')).toBe('Lookahead approved')
    expect(notificationLabel('lookahead_returned')).toBe('Lookahead sent back')
    expect(notificationLabel('lookahead_sent_confirm')).toBe('Lookahead sent to subs')
    expect(notificationLabel('dc_rejected')).toBe('Cost entry rejected')
    expect(notificationLabel('rfi_comment')).toBe('RFI comment')
    expect(notificationLabel('sales_task')).toBe('Sales task')
    expect(notificationLabel('sales_order')).toBe('Sales order')
    expect(notificationLabel('billing_approved')).toBe('Approved')
    expect(notificationLabel('brand_new_type')).toBe('Brand new type')
  })

  test('field links open the job / tab (incl. legacy bare "rfis")', () => {
    expect(fieldTarget({ link: '/field?job=J1&tab=costs' })).toEqual({ job: 'J1', tab: 'costs', week: null })
    expect(fieldTarget({ link: '/field?job=J1&tab=lookahead&week=2026-11-09' })).toEqual({ job: 'J1', tab: 'lookahead', week: '2026-11-09' })
    expect(fieldTarget({ link: '/field?job=J1&tab=rfis' }).tab).toBe('rfi')
    expect(fieldTarget({ link: 'rfis', job_id: 'J7' })).toEqual({ job: 'J7', tab: 'rfi', week: null })
    expect(fieldTarget({ link: '/sales/1' })).toBeNull()
    expect(fieldTabFromParam('rfis')).toBe('rfi')
    expect(rfiAnsweredLink('/field', 'J1')).toBe('/field?job=J1&tab=rfis')
    expect(rfiAnsweredLink('/submit', 'J1')).toBe('/submit')
  })

  test('RFI answered bell deep-links per portal', async () => {
    resetMockState({ notifications: [] })
    const { notifyRfiAnswered } = require('../lib/rfi-notify')
    await notifyRfiAnswered({ id: 'R1', job_id: 'J1', title: 'Panel', super_id: 'super1', sub_id: 'sub1' }, 'North wall')
    const links = Object.fromEntries(mockState.db.notifications.map(n => [n.recipient_id, n.link]))
    expect(links).toEqual({ super1: '/field?job=J1&tab=rfis', sub1: '/submit' })
  })

  test('bells on /field and /sales; dashboard badge loads on start', () => {
    expect(read('app/field/page.js')).toMatch(/<NotificationBell onOpen=\{openNotification\}/)
    expect(read('app/sales/page.js')).toMatch(/<NotificationBell/)
    const bell = read('app/components/NotificationBell.js')
    expect(bell).toMatch(/authFetch\('\/api\/notifications'\)/)
    expect(bell).toMatch(/method: 'PATCH'/)
    const dash = read('app/dashboard/page.js')
    expect(dash).toMatch(/if \(!profile\?\.id\) return\s+loadPmNotifications\(\)/)
    expect(dash).toMatch(/const typeLabel = notificationLabel\(n\.type\)/)
  })

  test('lookahead send-back emails the super (mocked)', async () => {
    resetMockState({
      lookaheads: [{ id: 'L1', job_id: 'J1', week_start_date: '2026-11-09', status: 'submitted', submitted_by: 'super1' }],
      jobs: [{ id: 'J1', project_name: 'Conway' }],
      profiles: [{ id: 'principal1', full_name: 'Pat Owner' }],
      notifications: [],
    })
    as('principal')
    const route = require('../app/api/lookaheads/route')
    const r = await call(route.PUT, '/api/lookaheads', 'PUT', { id: 'L1', action: 'return', note: 'Add the pour crew' })
    expect(r.status).toBe(200)
    const mail = sent().find(m => /sent back/.test(m.subject))
    expect(mail.to).toBe('super1@x.com')
    expect(mail.html).toMatch(/Add the pour crew/)
    expect(mail.html).toMatch(/\/field\?job=J1&amp;tab=lookahead|\/field\?job=J1&tab=lookahead/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('9) owner photos', () => {
  const { ownerPhotoList } = require('../lib/owner-photos')
  const route = require('../app/api/owner-photos/route')

  test('gallery + daily report photos, no thumbs, only this job', () => {
    const list = ownerPhotoList({
      jobId: 'J1',
      jobPhotos: [
        { storage_path: 'J1/gallery/1.jpg', caption: 'Footings', taken_at: '2026-11-05T15:00:00Z' },
        { storage_path: 'J1/gallery/1_thumb.jpg' },
        { storage_path: 'J2/gallery/9.jpg' },
      ],
      reports: [{ report_date: '2026-11-06', photos: [{ path: 'J1/abc.jpg', caption: 'Slab' }, { path: 'J1/gallery/1.jpg' }] }],
    })
    expect(list.map(p => [p.path, p.caption, p.date])).toEqual([['J1/abc.jpg', 'Slab', '2026-11-06'], ['J1/gallery/1.jpg', 'Footings', '2026-11-05']])
  })

  test('route signs from daily-report-photos for the owner; errors are returned', async () => {
    resetMockState({
      jobs: [{ id: 'J1', owner_email: 'client@braums.test' }],
      job_photos: [{ job_id: 'J1', storage_path: 'J1/gallery/1.jpg', caption: 'Footings', taken_at: '2026-11-05T15:00:00Z' }],
      daily_reports: [{ id: 'd1', job_id: 'J1', report_date: '2026-11-06', photos: [{ path: 'J1/abc.jpg' }] }],
    })
    as('owner', 'o1', 'client@braums.test')
    let r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.photos[1]).toMatchObject({ path: 'J1/gallery/1.jpg', url: 'https://signed/daily-report-photos/J1/gallery/1.jpg', thumb_url: 'https://signed/daily-report-photos/J1/gallery/1_thumb.jpg', caption: 'Footings' })
    mockState.failSignedUrls = { 'daily-report-photos': 'denied' }
    r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(500)
    as('owner', 'o2', 'other@x.test')
    expect((await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')).status).toBe(403)
  })

  test('M1: a full-size image that fails to sign is an error, not an empty gallery', async () => {
    resetMockState({
      jobs: [{ id: 'J1', owner_email: 'client@braums.test' }],
      job_photos: [{ job_id: 'J1', storage_path: 'J1/gallery/1.jpg', taken_at: '2026-11-05T15:00:00Z' }],
      daily_reports: [],
    })
    as('owner', 'o1', 'client@braums.test')
    // Batch call succeeds; the per-object result for the primary image failed.
    mockState.signedUrlResults = { 'daily-report-photos': p => (p === 'J1/gallery/1.jpg' ? { signedUrl: null, error: 'Object not found' } : null) }
    let r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(502)
    expect(r.body.error).toBeTruthy()
    expect(r.body.photos).toBeUndefined()

    // Only the optional thumbnail missing → 200, thumb falls back to the full image.
    mockState.signedUrlResults = { 'daily-report-photos': p => (/_thumb/.test(p) ? { signedUrl: null, error: 'Object not found' } : null) }
    r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.photos[0]).toMatchObject({ url: 'https://signed/daily-report-photos/J1/gallery/1.jpg', thumb_url: 'https://signed/daily-report-photos/J1/gallery/1.jpg' })

    // A job that truly has no photos is still an empty list.
    mockState.db.job_photos = []
    r = await call(route.GET, '/api/owner-photos?job_id=J1', 'GET')
    expect(r).toEqual({ status: 200, body: { photos: [] } })
  })

  test('M1: signOwnerPhotos treats an absent primary as failed', () => {
    const { signOwnerPhotos } = require('../lib/owner-photos')
    const list = [{ path: 'J1/a.jpg' }, { path: 'J1/b.jpg' }]
    expect(signOwnerPhotos(list, [{ path: 'J1/a.jpg', signedUrl: 'u' }])).toMatchObject({ failed: ['J1/b.jpg'] })
    expect(signOwnerPhotos(list, null).error).toBeTruthy()
    expect(signOwnerPhotos(list, [{ path: 'J1/a.jpg', signedUrl: 'u' }, { path: 'J1/b.jpg', signedUrl: 'v' }]).photos).toHaveLength(2)
  })

  test('M1: owner page shows the load error for an error body or a missing list', () => {
    const page = read('app/owner/page.js')
    const block = page.slice(page.indexOf('/api/owner-photos'), page.indexOf('/api/owner-photos') + 600)
    expect(block).toMatch(/if \(!r\.ok \|\| j\.error\) throw/)
    expect(block).toMatch(/if \(!Array\.isArray\(j\.photos\)\) throw/)
  })

  test('owner page no longer reads the job-photos bucket and shows a load error', () => {
    const page = read('app/owner/page.js')
    expect(page).not.toMatch(/job-photos/)
    expect(page).toMatch(/\/api\/owner-photos/)
    expect(page).toMatch(/Couldn&apos;t load photos/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('10) closeout', () => {
  const { closeoutStatus } = require('../lib/closeout')
  const ok = { punch: 'ok', releases: 'ok', notices: 'ok', billing: 'ok' }

  test('checking until everything loads; never ready on a failed load', () => {
    expect(closeoutStatus({ loads: {} }).state).toBe('checking')
    expect(closeoutStatus({ loads: { ...ok, billing: 'loading' } }).state).toBe('checking')
    const failed = closeoutStatus({ loads: { ...ok, billing: 'error' } })
    expect(failed.state).toBe('error')
    expect(failed.failed).toEqual(['billing'])
    expect(closeoutStatus({ loads: ok }).state).toBe('ready')
  })

  test('retainage held and pending billings block ready; negative balance is not ✓', () => {
    const billing = [{ status: 'approved', retainage_held: 5000 }]
    expect(closeoutStatus({ loads: ok, billingSubmissions: billing }).state).toBe('not_ready')
    expect(closeoutStatus({ loads: ok, billingSubmissions: billing, retainageReleases: [{ amount: 5000 }] }).state).toBe('ready')
    const over = closeoutStatus({ loads: ok, billingSubmissions: billing, retainageReleases: [{ amount: 6000 }] })
    expect(over).toMatchObject({ state: 'not_ready', retainage: 'over_released', retainageBalance: -1000 })
    expect(over.checks.retainage).toBe(false)
    expect(closeoutStatus({ loads: ok, retainageReleases: [{ amount: 100 }] }).state).toBe('not_ready')
    const pend = closeoutStatus({ loads: ok, billingSubmissions: [{ status: 'pending', retainage_held: 0 }] })
    expect(pend.state).toBe('not_ready')
    expect(pend.checks.billing).toBe(false)
  })

  test('H3: a null billing payload without an error is a failed load, never ready', () => {
    const { closeoutList } = require('../lib/closeout')
    expect(closeoutList({ data: null, error: null })).toBeNull()
    expect(closeoutList({ data: undefined, error: null })).toBeNull()
    expect(closeoutList({ data: { rows: [] }, error: null })).toBeNull()
    expect(closeoutList({ data: [], error: { message: 'x' } })).toBeNull()
    expect(closeoutList(null)).toBeNull()
    expect(closeoutList({ data: [], error: null })).toEqual([])
    // Whatever the loader stamped, a null list is not an empty-and-ok list.
    const st = closeoutStatus({ loads: ok, billingSubmissions: null })
    expect(st.state).toBe('error')
    expect(st.failed).toEqual(['billing'])
    expect(closeoutStatus({ loads: { ...ok, billing: 'loading' }, billingSubmissions: null }).state).toBe('checking')
    // Simulated loader: null payload → loader returns false → billing 'error' → not ready.
    const loader = res => closeoutList(res) !== null
    const loads = { ...ok, billing: loader({ data: null, error: null }) ? 'ok' : 'error' }
    expect(closeoutStatus({ loads, billingSubmissions: [] }).state).toBe('error')
  })

  test('H3: loadBillingForJob requires an array before marking billing loaded', () => {
    const src = read('app/jobdetail/page.js')
    const fn = src.slice(src.indexOf('async function loadBillingForJob'), src.indexOf('async function loadBillingForJob') + 700)
    expect(fn).toMatch(/const bills = closeoutList\(billRes\)/)
    expect(fn).toMatch(/if \(!bills\) return false/)
    expect(fn).not.toMatch(/setBillingSubmissions\(data \|\| \[\]\)/)
  })

  test('Closeout loader includes billings and the banner uses closeoutStatus', () => {
    const src = read('app/jobdetail/page.js')
    expect(src).toMatch(/if \(activeTab === 'closeout'\) loadCloseout\(\)/)
    const fn = src.slice(src.indexOf('async function loadCloseout'), src.indexOf('async function loadCloseout') + 900)
    expect(fn).toMatch(/track\('billing', loadBillingForJob\(\)\)/)
    expect(src).toMatch(/const allClear = co\.state === 'ready'/)
    for (const f of ['loadPunchItems', 'loadRetainageReleases', 'loadPrelimNotices']) {
      const body = src.slice(src.indexOf(`async function ${f}()`), src.indexOf(`async function ${f}()`) + 400)
      expect([f, /!res\.ok/.test(body)]).toEqual([f, true])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('11) billing draft', () => {
  const D = require('../lib/billing-draft')

  test('keyed per login; legacy key not reused', () => {
    expect(D.billingDraftKey('u1')).toBe('nvc_billing_draft:u1')
    expect(D.billingDraftKey(null)).toBeNull()
    expect(D.billingDraftKey('u1')).not.toBe(D.LEGACY_BILLING_DRAFT_KEY)
  })

  test('draft keeps % per SOV line and is restored onto fresh lines', () => {
    const sov = [{ sov_line_id: 'L1', pct_this: '25', amount_this: 2500 }, { sov_line_id: 'L2', pct_this: '' }]
    const draft = D.buildBillingDraft({ job_id: 'J1', invoice_number: 'INV-7', stray: 'x' }, sov)
    expect(draft).toEqual({ job_id: 'J1', invoice_number: 'INV-7', sov_pct: { L1: '25' } })
    const restored = D.restoreBillingDraft(JSON.stringify(draft), [{ id: 'J1' }])
    expect(restored).toEqual({ form: { job_id: 'J1', invoice_number: 'INV-7' }, sovPct: { L1: '25' } })
    const fresh = [
      { sov_line_id: 'L1', scheduled_value: 10000, pct_prev: 50, pct_this: '', amount_this: 0 },
      { sov_line_id: 'L3', scheduled_value: 500, pct_prev: 0, pct_this: '', amount_this: 0 },
    ]
    expect(D.applyDraftPcts(fresh, { L1: '25', GONE: '10' })).toEqual([
      { sov_line_id: 'L1', scheduled_value: 10000, pct_prev: 50, pct_this: '25', amount_this: 2500 },
      fresh[1],
    ])
    expect(D.applyDraftPcts([{ sov_line_id: 'L1', scheduled_value: 1, pct_prev: 100, pct_this: '' }], { L1: '5' })[0].pct_this).toBe('')
    expect(D.applyDraftPcts([{ sov_line_id: 'L1', scheduled_value: 1, pct_prev: 90, pct_this: '' }], { L1: '15' })[0].pct_this).toBe('')
  })

  test('a job this login cannot see is dropped; empty drafts restore nothing; stale draw dropped', () => {
    expect(D.restoreBillingDraft(JSON.stringify({ job_id: 'J9', draw_request_id: 'DR1', sov_pct: { L1: '5' } }), [{ id: 'J1' }])).toBeNull()
    expect(D.restoreBillingDraft(JSON.stringify({ job_id: 'J9', invoice_number: 'A' }), [{ id: 'J1' }]).form).toEqual({ job_id: '', draw_request_id: '', invoice_number: 'A' })
    expect(D.restoreBillingDraft('not json', [])).toBeNull()
    expect(D.keepOpenDraw('DR1', [{ id: 'DR2' }])).toBe('')
    expect(D.keepOpenDraw('DR2', [{ id: 'DR2' }])).toBe('DR2')
  })

  test('submit page: restore loads the SOV, banner only after a restore, sign out clears', () => {
    const src = read('app/submit/page.js')
    expect(src).not.toMatch(/localStorage\.setItem\(BILLING_DRAFT_KEY/)
    expect(src).toMatch(/ok = await loadJobSov\(f\.job_id, \{ sovPct, drawId/)
    expect(src).toMatch(/\{!prefillSub && draftRestored && \(/)
    expect((src.match(/onClick=\{signOutAndClear\}/g) || []).length).toBe(2)
    expect(src).toMatch(/const draft = draftToPersist\(\{ form, sovForm, hydrating: draftHydrating, held: heldDraftPctRef\.current \}\)/)
    expect(src).toMatch(/if \(draft\) localStorage\.setItem\(key, JSON\.stringify\(draft\)\)/)
  })

  test('M2: saved { sov_pct: { L1: 25 } } survives the restore window and a failed SOV load', () => {
    const key = D.billingDraftKey('u1')
    const store = { [key]: JSON.stringify({ job_id: 'J1', invoice_number: 'INV-7', sov_pct: { L1: '25' } }) }
    // The page's persist effect, as a function of what is on screen.
    const persist = (screen) => { const d = D.draftToPersist(screen); if (d) store[key] = JSON.stringify(d) }
    const saved = () => JSON.parse(store[key])

    const restored = D.restoreBillingDraft(store[key], [{ id: 'J1' }])
    const form = { job_id: '', invoice_number: '', ...restored.form }
    const held = { jobId: 'J1', sovPct: restored.sovPct }

    // 1) Restore window: form restored, SOV not loaded yet (sovForm empty) → nothing written.
    persist({ form, sovForm: [], hydrating: true, held })
    expect(saved().sov_pct).toEqual({ L1: '25' })

    // 2) SOV load failed: hydration over, % still held → written draft keeps them,
    //    even after the sub edits another field.
    persist({ form, sovForm: [], hydrating: false, held })
    expect(saved().sov_pct).toEqual({ L1: '25' })
    persist({ form: { ...form, invoice_number: 'INV-8' }, sovForm: [], hydrating: false, held })
    expect(saved()).toMatchObject({ invoice_number: 'INV-8', sov_pct: { L1: '25' } })

    // 3) Tab reloads → next restore still has the percentages.
    expect(D.restoreBillingDraft(store[key], [{ id: 'J1' }]).sovPct).toEqual({ L1: '25' })

    // 4) SOV loads later: % applied to the line; the line value wins over the held copy.
    const lines = D.applyDraftPcts([{ sov_line_id: 'L1', scheduled_value: 1000, pct_prev: 0, pct_this: '' }], { L1: '25' })
    expect(lines[0]).toMatchObject({ pct_this: '25', amount_this: 250 })
    persist({ form, sovForm: [{ ...lines[0], pct_this: '30' }], hydrating: false, held: null })
    expect(saved().sov_pct).toEqual({ L1: '30' })

    // Held % only applies to its own job; a different job does not carry them.
    expect(D.draftToPersist({ form: { job_id: 'J2' }, sovForm: [], held }).sov_pct).toEqual({})
  })

  test('M2: readOpenDraws — only an OK response with a draws array is a successful load', async () => {
    const res = (ok, json) => ({ ok, json })
    expect(await D.readOpenDraws(null)).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(false, async () => ({ draws: [] })))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, async () => { throw new SyntaxError('Unexpected end of JSON input') }))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, () => Promise.reject(new Error('truncated'))))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, async () => null))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, async () => ({})))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, async () => ({ draws: 'x' })))).toEqual({ ok: false })
    expect(await D.readOpenDraws(res(true, async () => ({ draws: [] })))).toEqual({ ok: true, openDraws: [] })
    expect(await D.readOpenDraws(res(true, async () => ({ draws: [{ id: 'D', status: 'open' }, { id: 'X', status: 'closed' }, null] }))))
      .toEqual({ ok: true, openDraws: [{ id: 'D', status: 'open' }] })
    expect(await D.loadOpenDraws(() => { throw new Error('offline') }, 'J1')).toEqual({ ok: false })
    expect(D.drawAfterLoad('D', { ok: false })).toBe('D')
    expect(D.drawAfterLoad('D', { ok: true, openDraws: [] })).toBe('')
    expect(D.drawAfterLoad('D', { ok: true, openDraws: [{ id: 'D' }] })).toBe('D')
  })

  test('M2: saved draw D + sov_pct {L1:25} survive a 200 draw response whose body cannot be parsed', async () => {
    const key = D.billingDraftKey('u1')
    const store = { [key]: JSON.stringify({ job_id: 'J1', draw_request_id: 'D', invoice_number: 'INV-7', sov_pct: { L1: '25' } }) }
    const persist = screen => { const d = D.draftToPersist(screen); if (d) store[key] = JSON.stringify(d) }
    const sovFetch = jest.fn(async () => ({ ok: true, json: async () => ({ contracts: [{ id: 'C1' }], lines: [{ id: 'L1', subcontract_id: 'C1', scheduled_value: 1000 }] }) }))
    const fetchImpl = jest.fn(async url => {
      if (url.startsWith('/api/draw-requests')) return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }
      return sovFetch(url)
    })

    // Mirror of the page's restore path (loadJobSov's draw step + the restore effect).
    const restored = D.restoreBillingDraft(store[key], [{ id: 'J1' }])
    let form = { job_id: '', draw_request_id: '', invoice_number: '', ...restored.form }
    const held = { jobId: 'J1', sovPct: restored.sovPct }
    persist({ form, sovForm: [], hydrating: true, held })
    const drawLoad = await D.loadOpenDraws(fetchImpl, 'J1')
    let ok
    if (!drawLoad.ok) ok = false
    else {
      if (!D.drawAfterLoad(form.draw_request_id, drawLoad)) form = { ...form, draw_request_id: '' }
      await fetchImpl('/api/sub-portal/sov?job_id=J1')
      ok = true
    }
    const outcome = { restored: ok !== false, draw: form.draw_request_id }
    expect(outcome).toEqual({ restored: false, draw: 'D' })
    expect(sovFetch).not.toHaveBeenCalled() // would have succeeded, but the load already failed

    // Hydration ends; the persisted draft still has D and the percentages.
    persist({ form, sovForm: [], hydrating: false, held })
    expect(JSON.parse(store[key])).toMatchObject({ job_id: 'J1', draw_request_id: 'D', sov_pct: { L1: '25' } })
  })

  test('M2: submit page — hydration guard, failed load returns false, banner only on success, sign-out clears', () => {
    const src = read('app/submit/page.js')
    const restore = src.slice(src.indexOf('if (!pendingDraft || !user) return'), src.indexOf('// Persist the billing draft'))
    expect(restore).toMatch(/setDraftHydrating\(true\)/)
    expect(restore.indexOf('setDraftHydrating(true)')).toBeLessThan(restore.indexOf('setPendingDraft(null)'))
    expect(restore).toMatch(/if \(ok !== false\) \{\s*setDraftRestored\(true\)/)
    expect(restore).not.toMatch(/return \(\) =>/) // no cleanup that would cancel the hydration
    const fn = src.slice(src.indexOf('async function loadJobSov'), src.indexOf('async function saveSovLines'))
    expect(fn).toMatch(/const drawLoad = await loadOpenDraws\(/)
    expect(fn).toMatch(/if \(!drawLoad\.ok\) \{[^}]*return false \}/)
    expect(fn).not.toMatch(/drRes\.json\(\)\.catch/)
    // The draw check comes before the SOV request, so a broken draw body fails the load first.
    expect(fn.indexOf('if (!drawLoad.ok)')).toBeLessThan(fn.indexOf('/api/sub-portal/sov'))
    expect(fn).toMatch(/if \(!sov\) \{[\s\S]*?return false/)
    expect(fn).not.toMatch(/\{ contracts: \[\], lines: \[\] \}/) // a failed SOV load is not "no contract"
    const out = src.slice(src.indexOf('async function signOutAndClear'), src.indexOf('async function signOutAndClear') + 200)
    expect(out).toMatch(/signingOutRef\.current = true\s*clearBillingDraft\(\)/)
    expect(src).toMatch(/!draftChecked \|\| pendingDraft \|\| signingOutRef\.current\) return/)
  })
})
