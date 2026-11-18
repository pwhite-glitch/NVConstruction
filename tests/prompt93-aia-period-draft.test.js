/**
 * Prompt 93 — AIA G702/G703: "DRAFT" label + blank Billing period (Module X).
 * Peyton 11/18: "the Billing period is blank on the aia for module x … and also it says draft".
 * DRAFT follows status only; missing period_to prints "Not set"; draw-request jobs get a
 * period on create; nothing leaves draft without period_to (UI + /api/aia-status → 400).
 * All DB access is the in-memory mock; nothing live, no migrations.
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
function fnBody(src, decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error('not found: ' + decl)
  // body starts at the first "{" after the parameter list (params may hold "= {}")
  let i = src.indexOf(') {', start) + 2, depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

const A = require('../lib/aia-period')
const route = require('../app/api/aia-status/route')

const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const noToken = () => { mockState.auth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } }
const post = async body => {
  const res = await route.POST(new Request('http://x/api/aia-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}
const appRow = (extra = {}) => ({
  id: 'a1', job_id: 'J1', app_number: 2, status: 'draft', payment_received: false, nv_subcontract_id: null,
  period_from: null, period_to: null, schedule_frozen_at: null, ...extra,
})
const seed = (apps = []) => resetMockState({
  jobs: [{ id: 'J1', pm_email: 'lead@x.com' }, { id: 'J2' }],
  pm_job_assignments: [{ id: 'p1', job_id: 'J1', user_id: 'pm1' }, { id: 'p2', job_id: 'J1', user_id: 'apm1' }],
  profiles: [],
  aia_applications: apps,
})
const stored = id => mockState.db.aia_applications.find(a => a.id === id)

describe('prompt 93 — isAiaDraft / title suffix (status decides, not period_to)', () => {
  test('draft, blank and null status are drafts', () => {
    for (const status of ['draft', 'DRAFT', '', null, undefined]) {
      expect(A.isAiaDraft({ status, period_to: '2026-11-30' })).toBe(true)
      expect(A.isAiaDraft({ status, period_to: null })).toBe(true)
      expect(A.aiaTitleSuffix({ status })).toBe(' — DRAFT')
    }
  })
  test('submitted / certified / sent / approved / paid are never DRAFT, with or without period_to', () => {
    for (const status of ['submitted', 'certified', 'sent', 'approved', 'paid', 'Certified']) {
      for (const period_to of [null, '', '2026-11-30']) {
        expect(A.isAiaDraft({ status, period_to })).toBe(false)
        expect(A.aiaTitleSuffix({ status, period_to })).toBe('')
        expect(A.aiaDraftPeriodNote({ status, period_to })).toBe(null)
      }
    }
  })
  test('draft without period_to gets the soft note; with it, none', () => {
    expect(A.aiaDraftPeriodNote({ status: 'draft', period_to: null })).toBe('Billing period not set')
    expect(A.aiaDraftPeriodNote({ status: 'draft', period_to: '2026-11-30' })).toBe(null)
  })
})

describe('prompt 93 — aiaPeriodLabel', () => {
  test('both dates → "Mon D, YYYY – Mon D, YYYY"', () => {
    expect(A.aiaPeriodLabel({ period_from: '2026-11-01', period_to: '2026-11-30' })).toBe('Nov 1, 2026 – Nov 30, 2026')
    expect(A.aiaPeriodLabel({ period_from: '2026-10-16', period_to: '2026-10-31', status: 'certified' })).toBe('Oct 16, 2026 – Oct 31, 2026')
  })
  test('only period_to → that date alone', () => {
    expect(A.aiaPeriodLabel({ period_from: null, period_to: '2026-09-30' })).toBe('Sep 30, 2026')
  })
  test('no period_to → "Not set" (never "— – —"), whatever the status', () => {
    for (const status of ['submitted', 'certified', 'draft', null]) {
      expect(A.aiaPeriodLabel({ status, period_from: null, period_to: null })).toBe('Not set')
      expect(A.aiaPeriodLabel({ status, period_from: '2026-11-01', period_to: '' })).toBe('Not set')
    }
    expect(A.aiaPeriodLabel(null)).toBe('Not set')
  })
  test('formatAiaDate has no time-zone drift and rejects junk', () => {
    expect(A.formatAiaDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(A.formatAiaDate('2026-12-31T00:00:00Z')).toBe('Dec 31, 2026')
    expect(A.formatAiaDate('nope')).toBe('')
    expect(A.formatAiaDate('2026-13-01')).toBe('')
  })
})

describe('prompt 93 — canFinalizeAia / aiaFinalizeError', () => {
  test('needs a period end date to leave draft', () => {
    expect(A.canFinalizeAia({ period_to: '2026-11-30' })).toBe(true)
    expect(A.canFinalizeAia({ period_to: null })).toBe(false)
    expect(A.canFinalizeAia({ period_to: '' })).toBe(false)
    expect(A.canFinalizeAia(null)).toBe(false)
    for (const s of ['submitted', 'certified', 'sent']) {
      expect(A.aiaFinalizeError({ period_to: null }, s)).toBe('Set the billing period end date before submitting this application.')
      expect(A.aiaFinalizeError({ period_to: '2026-11-30' }, s)).toBe(null)
    }
  })
  test('saving / moving to draft is never blocked', () => {
    expect(A.aiaFinalizeError({ period_to: null }, 'draft')).toBe(null)
    expect(A.aiaFinalizeError({ period_to: null }, '')).toBe(null)
    expect(A.aiaFinalizeError({ period_to: null }, null)).toBe(null)
  })
})

describe('prompt 93 — create period (draw-request jobs default to the Central month)', () => {
  test('monthPeriod: first to last day, leap years', () => {
    expect(A.monthPeriod('2026-11')).toEqual({ period_from: '2026-11-01', period_to: '2026-11-30' })
    expect(A.monthPeriod('2028-02')).toEqual({ period_from: '2028-02-01', period_to: '2028-02-29' })
    expect(A.monthPeriod('2026-02')).toEqual({ period_from: '2026-02-01', period_to: '2026-02-28' })
    expect(A.monthPeriod('2026-13')).toBe(null)
    expect(A.monthPeriod('')).toBe(null)
  })
  test('draw job with blank dates → current Central month', () => {
    expect(A.aiaCreatePeriod({ isDrawType: true, form: { period_from: '', period_to: '' }, today: '2026-11-18' }))
      .toEqual({ period_from: '2026-11-01', period_to: '2026-11-30' })
    expect(A.aiaCreatePeriod({ isDrawType: true, form: {}, today: '2026-12-31' }))
      .toEqual({ period_from: '2026-12-01', period_to: '2026-12-31' })
  })
  test('draw job keeps edited dates; rejects from > to', () => {
    expect(A.aiaCreatePeriod({ isDrawType: true, form: { period_from: '2026-10-15', period_to: '2026-11-14' }, today: '2026-11-18' }))
      .toEqual({ period_from: '2026-10-15', period_to: '2026-11-14' })
    expect(A.aiaCreatePeriod({ isDrawType: true, form: { period_from: '2026-11-20', period_to: '2026-11-10' }, today: '2026-11-18' }).error).toMatch(/on or before/)
  })
  test('non-draw paths unchanged: monthly picker and biweekly dates', () => {
    expect(A.aiaCreatePeriod({ form: { period_to: '2026-10' }, today: '2026-11-18' })).toEqual({ period_from: '2026-10-01', period_to: '2026-10-31' })
    expect(A.aiaCreatePeriod({ form: { period_from: '2026-11-01', period_to: '2026-11-14' } })).toEqual({ period_from: '2026-11-01', period_to: '2026-11-14' })
    expect(A.aiaCreatePeriod({ form: { period_to: '' } }).error).toBeTruthy()
  })
  test('createAiaApplication uses it for every job (draw jobs no longer insert null dates)', () => {
    const job = read('app/jobdetail/page.js')
    const create = fnBody(job, 'async function createAiaApplication(')
    expect(create).toContain('aiaCreatePeriod({ isDrawType, form: newAiaForm, today: todayCentral() })')
    expect(create).toContain('period_from: periodFrom,')
    expect(create).toContain('period_to: periodTo,')
    expect(create).not.toContain('let periodTo = null')
    // new draw form is prefilled with the current month and has editable dates
    expect(job).toContain("const drawPeriod = job.billing_type === 'draw_request' ? monthPeriod(todayCentral().slice(0, 7)) : null")
  })
})

describe('prompt 93 — POST /api/aia-status', () => {
  test('submit / certify without period_to → 400 with the message; row unchanged', async () => {
    for (const status of ['submitted', 'certified']) {
      seed([appRow()])
      as('principal')
      const r = await post({ app_id: 'a1', status })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('Set the billing period end date before submitting this application.')
      expect(r.body.code).toBe('period_required')
      expect(stored('a1').status).toBe('draft')
    }
  })
  test('submitted → certified without period_to is also refused (sent apps stay as they are)', async () => {
    seed([appRow({ status: 'submitted' })])
    as('pm')
    const r = await post({ app_id: 'a1', status: 'certified' })
    expect(r.status).toBe(400)
    expect(stored('a1').status).toBe('submitted')
    expect(stored('a1').period_to).toBe(null)
  })
  test('with period_to: status written, freeze header kept (only freeze columns)', async () => {
    seed([appRow({ period_from: '2026-11-01', period_to: '2026-11-30' })])
    as('pm')
    const r = await post({ app_id: 'a1', status: 'submitted', header: { original_contract_sum: 1000.004, net_change_orders: 50, schedule_frozen_at: '2026-11-18T22:00:00.000Z', retainage_pct: 0, period_to: null } })
    expect(r.status).toBe(200)
    const a = stored('a1')
    expect(a.status).toBe('submitted')
    expect(a.original_contract_sum).toBe(1000)
    expect(a.net_change_orders).toBe(50)
    expect(a.schedule_frozen_at).toBe('2026-11-18T22:00:00.000Z')
    expect(a.period_to).toBe('2026-11-30')
    expect(a.retainage_pct).toBeUndefined()
    expect(r.body.patch.status).toBe('submitted')
  })
  test('back to draft is never blocked by the period; Owner clears the freeze', async () => {
    seed([appRow({ status: 'submitted', schedule_frozen_at: '2026-11-01T00:00:00Z' })])
    as('principal')
    const r = await post({ app_id: 'a1', status: 'draft' })
    expect(r.status).toBe(200)
    expect(stored('a1').status).toBe('draft')
    expect(stored('a1').schedule_frozen_at).toBe(null)
  })
  test('locked app back to draft: non-Owner refused', async () => {
    seed([appRow({ status: 'certified', period_to: '2026-11-30' })])
    as('pm')
    const r = await post({ app_id: 'a1', status: 'draft' })
    expect(r.status).toBe(403)
    expect(stored('a1').status).toBe('certified')
  })
  test('auth, job access and input checks', async () => {
    seed([appRow({ period_to: '2026-11-30' }), appRow({ id: 'a2', job_id: 'J2', period_to: '2026-11-30' })])
    noToken()
    expect((await post({ app_id: 'a1', status: 'submitted' })).status).toBe(401)
    as('subcontractor')
    expect((await post({ app_id: 'a1', status: 'submitted' })).status).toBe(403)
    as('pm')
    expect((await post({ app_id: 'a2', status: 'submitted' })).status).toBe(403)
    expect(stored('a2').status).toBe('draft')
    expect((await post({ app_id: 'a1', status: 'paid' })).status).toBe(400)
    expect((await post({ status: 'submitted' })).status).toBe(400)
    expect((await post({ app_id: 'nope', status: 'submitted' })).status).toBe(404)
  })
})

describe('prompt 93 — job page / owner portal wiring', () => {
  const job = read('app/jobdetail/page.js')
  const gen = fnBody(job, 'function generateAIAFromApp(')
  test('G702/G703 DRAFT label + banner follow status, not period_to', () => {
    expect(gen).not.toContain('const isDraft = !app.period_to')
    expect(gen).toContain('const isDraft = isAiaDraft(app)')
    expect(gen).toContain('Application No. ${app.app_number}${aiaTitleSuffix(app)}')
    expect(gen).not.toContain('Billing period end date is required before final submission')
    expect(gen).not.toContain('DRAFT — Billing period is not set')
    expect(gen).not.toContain('${periodFrom} – ${periodTo}')
    expect((gen.match(/\$\{periodText\}/g) || []).length).toBe(3)
  })
  test('Save & Generate only warns for drafts, never says a sent app will be marked DRAFT', () => {
    const sg = fnBody(job, 'async function saveAndGenerateAIA(')
    expect(sg).not.toContain('The PDF will be marked DRAFT')
    expect(sg).toContain('aiaDraftPeriodNote(activeAia)')
  })
  test('save blocks leaving draft without period_to; status goes through /api/aia-status', () => {
    const save = fnBody(job, 'async function saveAiaLines(')
    expect(save).toContain('aiaFinalizeError(activeAia, targetStatus)')
    expect(save).toContain('alert(AIA_PERIOD_REQUIRED_MESSAGE)')
    expect(save).toContain('period_to: activeAia.period_to || null')
    expect(fnBody(job, 'async function changeAiaStatus(appId, status, header = {}) {')).toContain("authFetch('/api/aia-status'")
    // no direct browser status writes left
    expect(job).not.toMatch(/updateAiaHeader\([^)]*\{\s*status:/)
    expect(job).toContain('{AIA_PERIOD_REQUIRED_MESSAGE}')
  })
  test('owner portal shows the shared period label', () => {
    const owner = read('app/owner/page.js')
    expect(owner).toContain("import { aiaPeriodLabel } from '../../lib/aia-period'")
    expect(owner).toContain('{aiaPeriodLabel(a)}')
  })
})
