/**
 * Prompt 67D #10 — estimate proposals: exclusions, clarifications, alternates, proposal date /
 * valid-through / revision, every printed field escaped. In-memory DB only
 * (tests/helpers/mock-db.js): nothing real is read, written or migrated.
 *  - PDF builder (buildEstimateHtml) escaping, sections, dates, revision, license text
 *  - /api/estimates update: new fields + alternates, validation, before 065
 *  - /api/estimates/export: hash / revision / proposal date, compare-and-set
 *  - /api/estimates/proposal-defaults
 *  - convert to job: accepted alternates → budget lines + contract sum
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => (mockState.auth ? mockState.auth : { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }),
    isPM: r => PM.has(r),
    isSub: () => false,
  }
})

const { buildEstimateHtml } = require('../lib/generate-estimate-pdf')
const estimatesRoute = require('../app/api/estimates/route')
const exportRoute = require('../app/api/estimates/export/route')
const defaultsRoute = require('../app/api/estimates/proposal-defaults/route')
const toJobRoute = require('../app/api/estimates/to-job/route')
const { todayCentral } = require('../lib/central-date')
const P = require('../lib/estimate-proposal')
const { mapEstimateLinesToBudget, estimateTotal } = require('../lib/estimate-to-job')
const { alternatesSavePayload, estimateSavePayload } = require('../lib/estimate-save')

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const req = (url, body, method = 'POST') => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const as = (role, userId = `u-${role}`) => { mockState.auth = { userId, email: `${role}@nv.test`, role, error: null } }
const json = async r => ({ status: r.status, body: await r.json() })
const count = (hay, needle) => hay.split(needle).length - 1

beforeAll(() => { global.fetch = jest.fn(() => Promise.reject(new Error('no logo in tests'))) })

// ── PDF builder ──────────────────────────────────────────────────────────────
describe('PDF builder (buildEstimateHtml)', () => {
  const EVIL = {
    project_name: '<b>Acme</b> Plaza',
    estimate_number: 'EST-<1>',
    project_type: '<i>Retail</i>',
    owner_name: '<b>Acme</b>',
    owner_company: 'Acme & <Co>',
    owner_email: '<x@y.com>',
    owner_phone: '<555>',
    address: '1 <Main> St\nSuite <2>',
    notes: 'Scope <script>',
    markup_pct: 10, markup_flat: 0, taxable: false, tax_rate: 8.25,
    created_at: '2020-01-01T00:00:00Z',
    estimate_line_items: [{ description: '<2 in. conduit', amount: 1000, scope: '<scope>', sort_order: 0 }],
  }

  test('every listed field is escaped; address newlines still become <br>', async () => {
    const html = await buildEstimateHtml(EVIL)
    expect(html).toContain('<title>Proposal — &lt;b&gt;Acme&lt;/b&gt; Plaza</title>')
    expect(html).toContain('<div class="doc-project">&lt;b&gt;Acme&lt;/b&gt; Plaza</div>')
    expect(html).toContain('No. EST-&lt;1&gt;')
    expect(html).toContain('Proposal No. EST-&lt;1&gt;')
    expect(html).toContain('&lt;i&gt;Retail&lt;/i&gt;')
    expect(html).toContain('<div class="party-name">&lt;b&gt;Acme&lt;/b&gt;</div>')
    expect(html).toContain('Acme &amp; &lt;Co&gt;')
    expect(html).toContain('&lt;x@y.com&gt;')
    expect(html).toContain('&lt;555&gt;')
    expect(html).toContain('1 &lt;Main&gt; St<br>Suite &lt;2&gt;')
    expect(html).toContain('<div class="item-desc">&lt;2 in. conduit</div>')
    expect(html).toContain('&lt;scope&gt;')
    expect(html).toContain('Scope &lt;script&gt;')
    for (const raw of ['<b>Acme</b>', '<2 in.', '<i>Retail', '<Main>', '<x@y.com>', '<555>', '<script>', 'EST-<1>', '<Co>']) expect(html).not.toContain(raw)
  })

  test('alternates printed, excluded from Total; exclusions / clarifications as list items', async () => {
    const html = await buildEstimateHtml({
      ...EVIL, project_name: 'P', markup_pct: 0,
      estimate_line_items: [{ description: 'Base', amount: 1000, sort_order: 0 }],
      alternates: [
        { description: 'Upgrade <tile>', kind: 'add', amount: 500, accepted: true, sort_order: 0 },
        { description: 'Delete paint', kind: 'deduct', amount: 200, accepted: false, sort_order: 1 },
      ],
      exclusions: 'Permits\n\n  <Bonds>  \n',
      clarifications: 'Normal hours only',
    })
    const grand = html.slice(html.indexOf('totals-row grand'), html.indexOf('totals-row grand') + 200)
    expect(grand).toContain('$1,000.00')
    expect(html).not.toContain('$1,500.00')
    expect(html).not.toContain('$1,300.00')
    expect(html).toContain('Upgrade &lt;tile&gt;')
    expect(html).toContain('+$500.00')
    expect(html).toContain('−$200.00')
    expect(html).toContain('Deduct')
    expect(count(html, 'class="alt-accepted">Accepted<')).toBe(1)
    expect(html).toContain('Alternates are not included in the Total above.')
    expect(html).toContain('<ul class="section-list"><li>Permits</li><li>&lt;Bonds&gt;</li></ul>')
    expect(html).toContain('<li>Normal hours only</li>')
    expect(html.indexOf('Alternates are not included')).toBeGreaterThan(html.indexOf('totals-row grand'))
  })

  test('date / valid-through = proposal_date + valid_days; revision only when > 0', async () => {
    const html = await buildEstimateHtml({ ...EVIL, proposal_date: '2026-11-10', valid_days: 45, revision: 0 })
    expect(html).toContain('Date: November 10, 2026')
    expect(html).toContain('Valid through: December 25, 2026')
    expect(html).toContain('Valid 45 days from date of issue (through December 25, 2026)')
    expect(html).not.toContain('Valid 30 days')
    expect(html).not.toMatch(/Revision \d|Rev\. \d/)
    const rev = await buildEstimateHtml({ ...EVIL, proposal_date: '2026-11-10', valid_days: 30, revision: 2 })
    expect(rev).toContain('Revision 2')
    expect(rev).toContain('Rev. 2')
    expect(rev).toContain('Valid through: December 10, 2026')
  })

  test('no proposal_date (before 065 / never exported): prints today, not created_at; 30 days', async () => {
    const html = await buildEstimateHtml(EVIL)
    const today = new Date(todayCentral() + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    expect(html).toContain(`Date: ${today}`)
    expect(html).not.toContain('January 1, 2020')
    expect(html).toContain('Valid 30 days from date of issue')
  })

  test('"LA License # CL 10283" text is unchanged', async () => {
    const src = read('lib/generate-estimate-pdf.js')
    expect(count(src, 'LA License # CL 10283')).toBe(2)
    expect(count(src, 'LA License #&nbsp;CL 10283')).toBe(1)
    const html = await buildEstimateHtml(EVIL)
    expect(count(html, 'LA License # CL 10283')).toBe(2)
    expect(count(html, 'LA License #&nbsp;CL 10283')).toBe(1)
  })
})

// ── /api/estimates update ────────────────────────────────────────────────────
describe('/api/estimates update: proposal fields + alternates', () => {
  const ROW = () => ({ id: 'E1', created_by: 'u-principal', allowed_users: [], updated_at: 'T1', project_name: 'Old', exclusions: null, valid_days: 30, revision: 0 })
  beforeEach(() => {
    resetMockState({ estimates: [ROW()], estimate_line_items: [], estimate_alternates: [{ id: 'old-alt', estimate_id: 'E1', description: 'Old', kind: 'add', amount: 1, accepted: false }] })
    as('principal')
  })
  const update = extra => estimatesRoute.POST(req('/api/estimates', { action: 'update', id: 'E1', expected_updated_at: 'T1', line_items: [], ...extra }))

  test('saves the new fields and replaces alternates', async () => {
    const r = await json(await update({
      fields: { project_name: 'New', exclusions: 'Permits\nBonds', clarifications: 'Day work', proposal_date: '2026-11-10', valid_days: '45' },
      alternates: [{ description: ' Upgrade ', kind: 'add', amount: 500, accepted: true }, { description: 'Deduct tile', kind: 'deduct', amount: '200', accepted: false }],
    }))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    expect(mockState.db.estimates[0]).toMatchObject({ project_name: 'New', exclusions: 'Permits\nBonds', clarifications: 'Day work', proposal_date: '2026-11-10', valid_days: 45 })
    expect(mockState.db.estimate_alternates.map(a => [a.estimate_id, a.description, a.kind, a.amount, a.accepted, a.sort_order])).toEqual([
      ['E1', 'Upgrade', 'add', 500, true, 0],
      ['E1', 'Deduct tile', 'deduct', 200, false, 1],
    ])
  })

  test.each([
    ['bad date', { fields: { proposal_date: '11/10/2026' } }],
    ['valid_days 0', { fields: { valid_days: 0 } }],
    ['valid_days 366', { fields: { valid_days: 366 } }],
    ['valid_days 1.5', { fields: { valid_days: 1.5 } }],
    ['exclusions not text', { fields: { exclusions: 5 } }],
    ['alternate no description', { fields: {}, alternates: [{ description: ' ', kind: 'add', amount: 1 }] }],
    ['alternate bad kind', { fields: {}, alternates: [{ description: 'x', kind: 'plus', amount: 1 }] }],
    ['alternate negative', { fields: {}, alternates: [{ description: 'x', kind: 'add', amount: -1 }] }],
    ['alternate accepted not boolean', { fields: {}, alternates: [{ description: 'x', kind: 'add', amount: 1, accepted: 'yes' }] }],
    ['alternates not array', { fields: {}, alternates: 'x' }],
  ])('%s → 400, nothing written', async (_, extra) => {
    const r = await update(extra)
    expect(r.status).toBe(400)
    expect(mockState.calls).toHaveLength(0)
    expect(mockState.db.estimates[0].updated_at).toBe('T1')
  })

  test('before 065 (columns + table missing): old fields still save, with a warning', async () => {
    mockState.missingCols = { estimates: ['exclusions', 'clarifications', 'proposal_date', 'valid_days'] }
    mockState.failWrite = { estimate_alternates: { delete: { code: '42P01', message: 'relation "public.estimate_alternates" does not exist' } } }
    const r = await json(await update({ fields: { project_name: 'Saved anyway', exclusions: 'Permits', valid_days: 30 }, alternates: [{ description: 'x', kind: 'add', amount: 1 }] }))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe(P.MIGRATION_065_WARNING)
    expect(mockState.db.estimates[0].project_name).toBe('Saved anyway')
    expect(mockState.db.estimates[0].exclusions).toBeNull()
    const upd = mockState.calls.filter(c => c.table === 'estimates' && c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).not.toHaveProperty('exclusions')
  })

  test('without alternates in the body, alternates are left alone', async () => {
    expect((await update({ fields: { project_name: 'X' } })).status).toBe(200)
    expect(mockState.db.estimate_alternates.map(a => a.id)).toEqual(['old-alt'])
  })

  test('save payload only sends proposal fields when the row has them; alternates payload', () => {
    expect(estimateSavePayload({ project_name: 'x' }, [], 'E1').fields).not.toHaveProperty('valid_days')
    expect(estimateSavePayload({ project_name: 'x', valid_days: '', exclusions: '' }, [], 'E1').fields).toMatchObject({ valid_days: 30, exclusions: null })
    expect(alternatesSavePayload([{ description: '', amount: '' }, { description: 'a', kind: 'deduct', amount: '5', accepted: true }])).toEqual([{ description: 'a', kind: 'deduct', amount: 5, accepted: true }])
  })
})

// ── /api/estimates/export ────────────────────────────────────────────────────
describe('/api/estimates/export', () => {
  const ROW = extra => ({
    id: 'E1', created_by: 'u-creator', allowed_users: ['u-allowed'], updated_at: 'T1', estimate_number: 'EST-1', project_name: 'P',
    markup_pct: 0, taxable: false, tax_rate: 8.25, exclusions: 'Permits', clarifications: null, proposal_date: null, valid_days: 30,
    revision: 0, proposal_exported_at: null, proposal_export_hash: null,
    estimate_line_items: [{ id: 'l1', description: 'Base', amount: 100, sort_order: 0 }],
    ...extra,
  })
  const exp = () => exportRoute.POST(req('/api/estimates/export', { id: 'E1' }))
  beforeEach(() => {
    resetMockState({ estimates: [ROW()], estimate_alternates: [{ id: 'a1', estimate_id: 'E1', description: 'Alt', kind: 'add', amount: 50, accepted: false, sort_order: 0 }] })
    as('pm')
  })
  const row = () => mockState.db.estimates[0]
  const estUpdates = () => mockState.calls.filter(c => c.table === 'estimates' && c.op === 'update')

  test('first export: revision stays 0, proposal_date = today, hash saved; updated_at untouched', async () => {
    const r = await json(await exp())
    expect(r.status).toBe(200)
    expect(r.body.changed).toBe(true)
    expect(row()).toMatchObject({ revision: 0, proposal_date: todayCentral(), updated_at: 'T1' })
    expect(row().proposal_export_hash).toMatch(/^[0-9a-f]{16}$/)
    expect(row().proposal_exported_at).toBeTruthy()
    expect(r.body.estimate.alternates.map(a => a.description)).toEqual(['Alt'])
    expect(r.body.estimate.estimate_line_items.map(l => l.description)).toEqual(['Base'])
    expect(estUpdates()[0].payload).not.toHaveProperty('updated_at')
  })

  test('first export keeps a proposal_date the user set', async () => {
    row().proposal_date = '2026-10-01'
    await exp()
    expect(row().proposal_date).toBe('2026-10-01')
  })

  test('hash unchanged → no bump, nothing written', async () => {
    await exp()
    const before = { ...row() }
    mockState.calls = []
    const r = await json(await exp())
    expect(r.status).toBe(200)
    expect(r.body.changed).toBe(false)
    expect(estUpdates()).toHaveLength(0)
    expect(row().revision).toBe(before.revision)
  })

  test('content changed → revision + 1 and proposal_date = today', async () => {
    await exp()
    row().proposal_date = '2026-01-01'
    row().project_name = 'P revised'
    const r = await json(await exp())
    expect(r.body.changed).toBe(true)
    expect(row()).toMatchObject({ revision: 1, proposal_date: todayCentral() })
    expect(r.body.estimate.revision).toBe(1)
    // an alternate change also counts
    mockState.db.estimate_alternates[0].accepted = true
    await exp()
    expect(row().revision).toBe(2)
  })

  test('compare-and-set conflict → 409, nothing changed', async () => {
    mockState.beforeWrite = (table, op) => { if (table === 'estimates' && op === 'update') row().updated_at = 'T2' }
    const r = await json(await exp())
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('stale')
    expect(row().proposal_export_hash).toBeNull()
    expect(row().proposal_date).toBeNull()
  })

  test('access: principal / pm / apm → 200', async () => {
    for (const role of ['principal', 'pm', 'apm']) {
      as(role)
      expect((await exp()).status).toBe(200)
    }
    mockState.auth = null
    expect((await exp()).status).toBe(401)
    as('pm')
    expect((await exportRoute.POST(req('/api/estimates/export', { id: 'nope' }))).status).toBe(404)
  })

  test('access: super / admin / sub / others → 403, estimate not loaded, nothing written', async () => {
    // super and admin are PM_ROLES but estimates RLS doesn't let them read estimates.
    // The creator / allowed_users ids don't open it up for any of these roles either.
    for (const [role, userId] of [['super', 'u-super'], ['admin', 'u-admin'], ['subcontractor', 'u-x'], ['super', 'u-creator'], ['admin', 'u-allowed'], ['estimator', 'u-creator'], ['dev', 'u-dev']]) {
      as(role, userId)
      mockState.calls = []
      const r = await json(await exp())
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ error: 'Forbidden' })
      expect(r.body.estimate).toBeUndefined()
      expect(estUpdates()).toHaveLength(0)
    }
    expect(row()).toMatchObject({ revision: 0, proposal_date: null, proposal_export_hash: null, proposal_exported_at: null, updated_at: 'T1' })
  })

  test('403 shows a clear message in the dashboard and Estimator export', () => {
    expect(P.exportErrorMessage(403, 'Forbidden')).toMatch(/only an Owner \(principal\), PM or APM can export/)
    expect(P.exportErrorMessage(409, 'This estimate changed while exporting. Try again.')).toBe('This estimate changed while exporting. Try again.')
    expect(P.exportErrorMessage(500)).toBe('Export failed (500)')
    expect(read('lib/generate-estimate-pdf.js')).toMatch(/exportErrorMessage\(res\.status, body\?\.error\)/)
    expect(read('app/components/estimating/EstimateWorkspace.js')).toMatch(/exportErrorMessage\(res\.status, result\?\.error\)/)
  })

  test('route source: role gate runs before the estimate is loaded', () => {
    const src = read('app/api/estimates/export/route.js')
    expect(src).toMatch(/const EXPORT_ROLES = new Set\(\['principal', 'pm', 'apm'\]\)/)
    expect(src.indexOf('EXPORT_ROLES.has(auth.role)')).toBeGreaterThan(-1)
    expect(src.indexOf('EXPORT_ROLES.has(auth.role)')).toBeLessThan(src.indexOf(".from('estimates')"))
    expect(src).not.toMatch(/est\.allowed_users|est\.created_by|isPM\(/)
  })

  test('before 065: estimate returned unchanged, no revision, nothing written', async () => {
    const legacy = ROW()
    for (const k of ['exclusions', 'clarifications', 'proposal_date', 'valid_days', 'revision', 'proposal_exported_at', 'proposal_export_hash']) delete legacy[k]
    resetMockState({ estimates: [legacy] })
    mockState.failSelect = { estimate_alternates: 'relation "public.estimate_alternates" does not exist' }
    // failSelect has no code; the message names the 065 table
    const r = await json(await exp())
    expect(r.status).toBe(200)
    expect(r.body.changed).toBe(false)
    expect(r.body.estimate.revision).toBeUndefined()
    expect(r.body.estimate.alternates).toEqual([])
    expect(mockState.calls).toHaveLength(0)
  })
})

// ── /api/estimates/proposal-defaults ─────────────────────────────────────────
describe('/api/estimates/proposal-defaults', () => {
  beforeEach(() => resetMockState({ estimate_proposal_defaults: [{ id: 1, default_exclusions: 'Permits', default_clarifications: null }] }))
  test('GET for pm / principal / apm; others 403', async () => {
    for (const r of ['pm', 'principal', 'apm']) {
      as(r)
      const res = await json(await defaultsRoute.GET(req('/api/estimates/proposal-defaults', undefined, 'GET')))
      expect(res.status).toBe(200)
      expect(res.body.defaults.default_exclusions).toBe('Permits')
    }
    as('super')
    expect((await defaultsRoute.GET(req('/api/estimates/proposal-defaults', undefined, 'GET'))).status).toBe(403)
  })
  test('PUT for principal / pm only', async () => {
    as('apm')
    expect((await defaultsRoute.PUT(req('/api/estimates/proposal-defaults', { default_exclusions: 'X' }, 'PUT'))).status).toBe(403)
    as('pm')
    const r = await json(await defaultsRoute.PUT(req('/api/estimates/proposal-defaults', { default_exclusions: 'Permits\nBonds' }, 'PUT')))
    expect(r.status).toBe(200)
    expect(mockState.db.estimate_proposal_defaults[0]).toMatchObject({ default_exclusions: 'Permits\nBonds', updated_by: 'u-pm' })
    expect((await defaultsRoute.PUT(req('/api/estimates/proposal-defaults', { default_exclusions: 5 }, 'PUT'))).status).toBe(400)
  })
  test('table missing (before 065) → 503 friendly message', async () => {
    as('principal')
    mockState.failSelect = { estimate_proposal_defaults: 'relation "public.estimate_proposal_defaults" does not exist' }
    const r = await json(await defaultsRoute.GET(req('/api/estimates/proposal-defaults', undefined, 'GET')))
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 065/)
  })
})

// ── Convert to job ───────────────────────────────────────────────────────────
describe('convert to job: accepted alternates', () => {
  const EST = { id: 'E1', created_by: 'u-principal', updated_at: 'T1', job_id: null, project_name: 'P', markup_pct: 10, markup_flat: 0, taxable: false, tax_rate: 8.25, estimate_line_items: [{ id: 'l1', description: 'Framing', amount: 1000, sort_order: 0 }] }
  const ALTS = [
    { id: 'a1', estimate_id: 'E1', description: 'Upgrade tile', kind: 'add', amount: 500, accepted: true, sort_order: 0 },
    { id: 'a2', estimate_id: 'E1', description: 'Delete paint', kind: 'deduct', amount: 200, accepted: true, sort_order: 1 },
    { id: 'a3', estimate_id: 'E1', description: 'Skylights', kind: 'add', amount: 900, accepted: false, sort_order: 2 },
    { id: 'a4', estimate_id: 'E2', description: 'Other estimate', kind: 'add', amount: 7, accepted: true, sort_order: 0 },
  ]
  let rpcArgs
  const seed = alts => {
    resetMockState({ estimates: [{ ...EST }], profiles: [], ...(alts ? { estimate_alternates: alts } : {}) })
    rpcArgs = null
    mockState.rpc.convert_estimate_to_job = args => { rpcArgs = args; return { data: { job_id: 'J1' }, error: null } }
    as('principal')
  }
  const convert = () => toJobRoute.POST(req('/api/estimates/to-job', { action: 'convert', id: 'E1', expected_updated_at: 'T1', job_number: '2026-099' }))
  const sum = (rows, k) => Math.round(rows.reduce((t, r) => t + r[k], 0) * 100) / 100

  test('accepted add / deduct become budget lines and change the contract sum; unaccepted ignored', async () => {
    seed(ALTS)
    expect((await convert()).status).toBe(200)
    expect(rpcArgs.p_lines.map(l => [l.description, l.budget_amount, l.owner_amount])).toEqual([
      ['Framing', 1000, 1100],
      ['Alternate: Upgrade tile', 500, 500],
      ['Alternate: Delete paint', -200, -200],
    ])
    expect(rpcArgs.p_contract_value).toBe(1400)
    expect(sum(rpcArgs.p_lines, 'owner_amount')).toBe(rpcArgs.p_contract_value)
  })

  test('no alternates table (before 065) → converts exactly as today', async () => {
    seed(null)
    mockState.failSelect = { estimate_alternates: 'relation "public.estimate_alternates" does not exist' }
    expect((await convert()).status).toBe(200)
    expect(rpcArgs.p_lines.map(l => l.description)).toEqual(['Framing'])
    expect(rpcArgs.p_contract_value).toBe(1100)
  })

  test('lib: budget total (owner SOV) == contract sum with tax, flat markup and alternates', () => {
    const est = { markup_pct: 10, markup_flat: 250, taxable: true, tax_rate: 9.125 }
    const lines = [{ description: 'A', amount: 800, sort_order: 0 }, { description: 'B', amount: 200, markup_pct: 20, sort_order: 1 }]
    const lines2 = mapEstimateLinesToBudget(est, lines, ALTS.slice(0, 3))
    expect(sum(lines2, 'owner_amount')).toBe(estimateTotal(est, lines, ALTS.slice(0, 3)))
    // alternates move the owner SOV and the contract sum by the same amount
    const base = mapEstimateLinesToBudget(est, lines)
    expect(Math.round((sum(lines2, 'owner_amount') - sum(base, 'owner_amount')) * 100) / 100).toBe(300)
    expect(Math.round((sum(lines2, 'budget_amount') - sum(base, 'budget_amount')) * 100) / 100).toBe(300)
    expect(estimateTotal(est, lines)).toBe(estimateTotal(est, lines, []))
    expect(estimateTotal(est, lines, ALTS.slice(0, 3))).toBe(Math.round((estimateTotal(est, lines) + 300) * 100) / 100)
  })
})

// ── lib + page wiring ────────────────────────────────────────────────────────
describe('lib/estimate-proposal + page wiring', () => {
  test('exportPatch rules', () => {
    expect(P.exportPatch({ revision: 0, proposal_export_hash: null, proposal_date: null }, 'h1', '2026-11-10')).toEqual({ revision: 0, proposal_date: '2026-11-10', proposal_export_hash: 'h1' })
    expect(P.exportPatch({ revision: 3, proposal_export_hash: 'h1', proposal_date: '2026-01-01' }, 'h1', '2026-11-10')).toBeNull()
    expect(P.exportPatch({ revision: 3, proposal_export_hash: 'h1', proposal_date: '2026-01-01' }, 'h2', '2026-11-10')).toEqual({ revision: 4, proposal_date: '2026-11-10', proposal_export_hash: 'h2' })
  })
  test('hash is stable and ignores date / revision; accepted subtotal', () => {
    const e = { project_name: 'P', markup_pct: '10', valid_days: 30 }
    const h = P.proposalHash(e, [{ description: 'a', amount: '1', sort_order: 0 }], [])
    expect(P.proposalHash({ ...e, markup_pct: 10, proposal_date: '2026-01-01', revision: 9 }, [{ description: 'a', amount: 1, sort_order: 0 }], [])).toBe(h)
    expect(P.proposalHash({ ...e, valid_days: 31 }, [{ description: 'a', amount: 1, sort_order: 0 }], [])).not.toBe(h)
    expect(P.acceptedAlternateTotals([{ kind: 'add', amount: 5, accepted: true }, { kind: 'deduct', amount: '2', accepted: true }, { kind: 'add', amount: 9, accepted: false }])).toEqual({ add: 5, deduct: 2, net: 3 })
  })
  test('workspace exports through the route, saves first, keeps the synchronous window', () => {
    const src = read('app/components/estimating/EstimateWorkspace.js')
    expect(src).not.toContain('generatePDF({ ...estimate, ...form, estimate_line_items: lines })')
    const fn = src.slice(src.indexOf('function exportPdf()'), src.indexOf('function exportPdf()') + 2000)
    expect(fn).toMatch(/generatePDF\(async \(\) => \{/)
    expect(fn.indexOf('await save(false)')).toBeLessThan(fn.indexOf("'/api/estimates/export'"))
    expect(fn.slice(0, fn.indexOf('generatePDF('))).not.toMatch(/await/)
    expect(src).toContain('onClick={exportPdf}')
    // L4: an in-flight auto-save is awaited (inside the loader), then dirty is re-read.
    expect(fn.indexOf('await waitForSaveIdle()')).toBeGreaterThan(fn.indexOf('generatePDF('))
    expect(fn.indexOf('await waitForSaveIdle()')).toBeLessThan(fn.indexOf('await save(false)'))
    expect(fn).toMatch(/const st = saveStateRef\.current/)
    expect(fn).toMatch(/st\.dirty && canEdit && !isArchived/)
    const wait = src.slice(src.indexOf('async function waitForSaveIdle('), src.indexOf('function exportPdf()'))
    expect(wait).toMatch(/timeoutMs = 10000/)
    expect(wait).toMatch(/while \(savingRef\.current\)/)
    expect(src).toContain('onClick={exportPdf}')
    expect(src).toContain('Accepted alternates: +')
    expect(src).toContain('Use default list')
    expect(src).toContain('Edit default exclusions')
    const pdf = read('lib/generate-estimate-pdf.js')
    expect(pdf).toMatch(/export function generateEstimatePDF\(estimate\) \{\n\s+if \(typeof estimate === 'function'\)/)
    expect(pdf).not.toMatch(/^export async function generateEstimatePDF/m)
  })
  test('dashboard Export PDF uses the export route', () => {
    const dash = read('app/dashboard/page.js')
    expect(dash).toContain('onClick={() => exportEstimateProposal(est.id)}>Export PDF</button>')
    expect(dash).not.toContain('generateEstimatePDF(est)')
  })
  test('migration 065 is idempotent and complete', () => {
    const sql = read('migrations/065_estimate_proposal_sections.sql')
    for (const c of ['exclusions', 'clarifications', 'proposal_date', 'valid_days', 'revision', 'proposal_exported_at', 'proposal_export_hash']) expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\s`))
    expect(sql).toMatch(/valid_days\s+integer NOT NULL DEFAULT 30/)
    expect(sql).toMatch(/CHECK \(valid_days BETWEEN 1 AND 365\)/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.estimate_alternates/)
    expect(sql).toMatch(/kind\s+text NOT NULL CHECK \(kind IN \('add', 'deduct'\)\)/)
    expect(sql).toMatch(/amount\s+numeric\(12,2\) NOT NULL CHECK \(amount >= 0\)/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.estimate_proposal_defaults/)
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/)
    expect(count(sql, 'CREATE POLICY')).toBe(count(sql, 'DROP POLICY IF EXISTS'))
    expect(sql).toMatch(/-- ROLLBACK/)
  })
})
