/**
 * Prompt 53 item 2: per-estimate sales tax rate (percentage points, default
 * 8.25), one shared estimate math helper, tax carried into converted budgets.
 */
const fs = require('fs')
const path = require('path')

// ── /api/estimates mock (simulates a DB with or without the tax_rate column) ──
let db
let writes
let hasTaxColumn = true
function mockQuery(table) {
  const filters = []
  let op = null
  let payload = null
  let selectAfter = false
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if ((op === 'update' || op === 'insert') && table === 'estimates' && !hasTaxColumn && payload && Object.prototype.hasOwnProperty.call(payload, 'tax_rate')) {
      return { data: null, error: { code: 'PGRST204', message: "Could not find the 'tax_rate' column of 'estimates' in the schema cache" } }
    }
    if (op === 'update') {
      const hit = rows()
      writes.push({ table, op, payload })
      hit.forEach(r => Object.assign(r, payload))
      return { data: selectAfter ? hit.map(r => ({ updated_at: r.updated_at })) : null, error: null }
    }
    if (op === 'insert') {
      writes.push({ table, op, payload })
      const arr = Array.isArray(payload) ? payload : [payload]
      db[table] = [...(db[table] || []), ...arr.map(r => ({ id: 'new1', ...r }))]
      return { data: selectAfter ? [{ id: 'new1', estimate_number: arr[0].estimate_number }] : null, error: null }
    }
    if (op === 'delete') { writes.push({ table, op }); return { data: null, error: null } }
    return { data: rows(), error: null }
  }
  const q = {
    select: () => { if (op) selectAfter = true; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    like: () => q, order: () => q, limit: () => q,
    insert: p => { op = 'insert'; payload = p; return q },
    update: p => { op = 'update'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    single: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: t => mockQuery(t) }) }))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => ({ userId: 'u1', role: 'principal' }),
  isPM: role => ['principal', 'pm', 'apm', 'super', 'admin'].includes(role),
}))
let mockOpenHtmlGetter = null
jest.mock('../lib/open-file', () => ({ openHtml: jest.fn(getter => { mockOpenHtmlGetter = getter }) }))

const {
  estimateBreakdown, calcTotal, validateTaxRate, effectiveTaxRate, formatTaxRate, taxLabel,
  normalizeTaxRateInput, isMissingTaxRateColumn, DEFAULT_TAX_RATE,
} = require('../lib/calc-total')
const { estimateTotal, mapEstimateLinesToBudget, planLink, round2 } = require('../lib/estimate-to-job')
const { estimateSavePayload, shouldOfferDraft } = require('../lib/estimate-save')
const { generateEstimatePDF } = require('../lib/generate-estimate-pdf')
const route = require('../app/api/estimates/route')

const LINES = [
  { description: 'Concrete', amount: 10000, markup_pct: null, markup_flat: null, sort_order: 0 },
  { description: 'Steel',    amount: 5000,  markup_pct: 0,    markup_flat: 250,  sort_order: 1 }, // explicit 0% override + flat
  { description: 'Paint',    amount: 2000,  markup_pct: 20,   markup_flat: null, sort_order: 2 },
]
const est = (extra = {}) => ({ markup_pct: 10, markup_flat: 500, taxable: true, estimate_line_items: LINES, ...extra })
// raw 17000; lines priced 11000 + 5250 + 2400 = 18650; + global flat 500 = 19150
const SUBTOTAL = 19150
const RAW = 17000

describe('shared estimate math', () => {
  test('legacy missing / null / blank rate calculates at 8.25', () => {
    for (const legacy of [est(), est({ tax_rate: null }), est({ tax_rate: undefined }), est({ tax_rate: '' })]) {
      expect(effectiveTaxRate(legacy)).toBe(8.25)
      expect(calcTotal(legacy)).toBeCloseTo(SUBTOTAL + RAW * 0.0825, 6)
    }
  })
  test('actual 9.125 and 9 rates', () => {
    expect(estimateBreakdown(est({ tax_rate: 9.125 })).tax).toBeCloseTo(RAW * 0.09125, 6)
    expect(estimateBreakdown(est({ tax_rate: 9 })).tax).toBeCloseTo(1530, 6)
    expect(estimateBreakdown(est({ tax_rate: '9.125' })).tax).toBeCloseTo(1551.25, 6)
  })
  test('explicit zero is 0%, never the default', () => {
    const b = estimateBreakdown(est({ tax_rate: 0 }))
    expect(b.taxRate).toBe(0)
    expect(b.tax).toBe(0)
    expect(b.total).toBe(SUBTOTAL)
  })
  test('taxable false → no tax whatever the rate', () => {
    expect(estimateBreakdown(est({ taxable: false, tax_rate: 9.125 })).tax).toBe(0)
    expect(calcTotal(est({ taxable: false, tax_rate: 9.125 }))).toBe(SUBTOTAL)
  })
  test('tax is on raw cost and NOT marked up; overrides and flats preserved', () => {
    const b = estimateBreakdown(est({ tax_rate: 9.125 }))
    expect(b.raw).toBe(RAW)
    expect(b.subtotal).toBe(SUBTOTAL)
    expect(b.markup).toBe(SUBTOTAL - RAW)
    expect(b.tax).toBeCloseTo(RAW * 9.125 / 100, 6) // not (raw * markup) * rate
    expect(b.total).toBeCloseTo(SUBTOTAL + 1551.25, 6)
  })
  test('validation: finite, nonnegative, ≤ 20, blank not coerced to 0', () => {
    expect(validateTaxRate(9.125)).toEqual({ value: 9.125 })
    expect(validateTaxRate('9')).toEqual({ value: 9 })
    expect(validateTaxRate(0)).toEqual({ value: 0 })
    expect(validateTaxRate('0')).toEqual({ value: 0 })
    for (const bad of ['', '   ', null, undefined, NaN, Infinity, -1, '-0.5', 20.01, 100, 'abc', '9.1.2', '1e3', {}, [], true]) {
      expect(validateTaxRate(bad).error).toBeTruthy()
    }
  })
  test('labels keep full precision', () => {
    expect(formatTaxRate(9.125)).toBe('9.125')
    expect(formatTaxRate(9)).toBe('9')
    expect(formatTaxRate(8.25)).toBe('8.25')
    expect(taxLabel(est({ tax_rate: 9.125 }))).toBe('Sales tax on raw cost (9.125%, not marked up)')
    expect(taxLabel(estimateBreakdown(est({ tax_rate: 9 })))).toBe('Sales tax on raw cost (9%, not marked up)')
    expect(taxLabel({})).toContain('8.25%')
  })
  test('missing-column detection', () => {
    expect(isMissingTaxRateColumn({ code: 'PGRST204', message: "Could not find the 'tax_rate' column" })).toBe(true)
    expect(isMissingTaxRateColumn({ code: '42703', message: 'column "tax_rate" does not exist' })).toBe(true)
    expect(isMissingTaxRateColumn({ code: '23514', message: 'violates check constraint estimates_tax_rate_range' })).toBe(false)
    expect(isMissingTaxRateColumn({ message: 'markup_flat missing' })).toBe(false)
  })
})

describe('conversion / link budget carries actual tax once', () => {
  test('estimateTotal matches the shared helper (rounded)', () => {
    for (const r of [undefined, 0, 9, 9.125]) {
      const e = est({ tax_rate: r })
      expect(estimateTotal(e, LINES)).toBe(round2(calcTotal(e)))
    }
  })
  test('one sales-tax line, cost = owner = tax, reconciles with contract total', () => {
    const e = est({ tax_rate: 9.125 })
    const mapped = mapEstimateLinesToBudget(e, LINES)
    const taxLines = mapped.filter(l => /^Sales tax/.test(l.description))
    expect(taxLines).toHaveLength(1)
    expect(taxLines[0]).toMatchObject({ description: 'Sales tax (9.125% on raw cost)', budget_amount: 1551.25, owner_amount: 1551.25, cost_code: null, sort_order: 3 })
    const ownerSum = mapped.reduce((a, l) => a + l.owner_amount, 0)
    const costSum = mapped.reduce((a, l) => a + l.budget_amount, 0)
    expect(round2(ownerSum + e.markup_flat)).toBe(estimateTotal(e, LINES)) // global flat stays contract-only, as before
    expect(round2(costSum)).toBe(RAW + 1551.25)
  })
  test('no tax line when not taxable or rate 0; legacy null rate → 8.25 line', () => {
    expect(mapEstimateLinesToBudget(est({ taxable: false }), LINES)).toHaveLength(3)
    expect(mapEstimateLinesToBudget(est({ tax_rate: 0 }), LINES)).toHaveLength(3)
    const legacy = mapEstimateLinesToBudget(est({ tax_rate: null }), LINES)
    expect(legacy[3]).toMatchObject({ description: 'Sales tax (8.25% on raw cost)', budget_amount: 1402.5 })
  })
  test('planLink: contract total includes tax exactly once and lines include the tax line', () => {
    const e = est({ tax_rate: 9 })
    const { plan } = planLink({ estimate: e, estimateLines: LINES, job: { contract_value: 0 }, jobLines: [], opts: { contract_action: 'set' } })
    expect(plan.contract_value).toBe(round2(SUBTOTAL + 1530))
    expect(plan.lines.filter(l => /^Sales tax/.test(l.description))).toHaveLength(1)
  })
  test('dashboard legacy convertToJob uses the shared mapping, not its own global multiplier', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/dashboard/page.js'), 'utf8')
    const fn = src.slice(src.indexOf('async function convertToJob(estimate)'), src.indexOf('async function convertToJob(estimate)') + 2500)
    expect(fn).toContain('estimateTotal(estimate, lines)')
    expect(fn).toContain('mapEstimateLinesToBudget(estimate, lines)')
    expect(fn).not.toMatch(/markupMult|0\.0825/)
  })
  test('no hard-coded 8.25% math or "applied before markup" label remains in estimate UI', () => {
    for (const f of ['app/dashboard/page.js', 'app/components/estimating/EstimateWorkspace.js', 'app/components/estimating/EstimatorHome.js', 'lib/generate-estimate-pdf.js', 'lib/estimate-to-job.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      expect(src).not.toMatch(/0\.0825/)
      expect(src).not.toMatch(/applied before markup/)
      expect(src).not.toMatch(/Sales [Tt]ax \(8\.25%\)/)
    }
  })
})

describe('save payload / drafts', () => {
  const form = { project_name: 'P', markup_pct: '10', markup_flat: '500', taxable: true, status: 'lead' }
  test('rate propagates; missing → 8.25; 0 stays 0; invalid passes through for rejection', () => {
    expect(estimateSavePayload({ ...form, tax_rate: '9.125' }, [], 'e1').fields.tax_rate).toBe(9.125)
    expect(estimateSavePayload(form, [], 'e1').fields.tax_rate).toBe(DEFAULT_TAX_RATE)
    expect(estimateSavePayload({ ...form, tax_rate: null }, [], 'e1').fields.tax_rate).toBe(8.25)
    expect(estimateSavePayload({ ...form, tax_rate: 0 }, [], 'e1').fields.tax_rate).toBe(0)
    expect(estimateSavePayload({ ...form, tax_rate: '0' }, [], 'e1').fields.tax_rate).toBe(0)
    const cleared = estimateSavePayload({ ...form, tax_rate: '' }, [], 'e1').fields.tax_rate
    expect(validateTaxRate(cleared).error).toBeTruthy()
    expect(normalizeTaxRateInput('-3')).toBe('-3')
  })
  test('draft with a changed rate is offered; legacy draft vs legacy row is not', () => {
    const row = { id: 'e1', updated_at: '2026-11-01T00:00:00Z', ...form, markup_pct: 10, markup_flat: 500, tax_rate: 8.25, estimate_line_items: [] }
    expect(shouldOfferDraft({ base_updated_at: row.updated_at, form: { ...row, tax_rate: '9.125' }, lines: [] }, row)).toBe(true)
    const { tax_rate: _x, ...legacyRow } = row
    expect(shouldOfferDraft({ base_updated_at: row.updated_at, form: { ...legacyRow }, lines: [] }, legacyRow)).toBe(false)
    expect(shouldOfferDraft({ base_updated_at: row.updated_at, form: { ...legacyRow }, lines: [] }, row)).toBe(false)
  })
})

describe('PDF uses the shared math and actual label', () => {
  test('9.125% printed unrounded, totals match', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('no logo')))
    generateEstimatePDF({ ...est({ tax_rate: 9.125 }), project_name: 'Braum\'s Conway', created_at: '2026-11-01' })
    const html = await mockOpenHtmlGetter()
    expect(html).toContain('Sales tax on raw cost (9.125%, not marked up)')
    expect(html).not.toContain('9.13%')
    expect(html).toContain('$1,551.25')
    expect(html).toContain('$' + (SUBTOTAL + 1551.25).toLocaleString('en-US', { minimumFractionDigits: 2 }))
    expect(html).toContain('management@nvim.co') // contact text untouched
  })
})

describe('/api/estimates tax_rate validation and pre-migration behavior', () => {
  const req = body => ({ json: async () => body })
  beforeEach(() => {
    hasTaxColumn = true
    writes = []
    db = { estimates: [{ id: 'e1', created_by: 'u1', allowed_users: [], updated_at: 'T1' }], estimate_line_items: [] }
  })
  const update = fields => route.POST(req({ action: 'update', id: 'e1', expected_updated_at: 'T1', fields, line_items: [] }))

  test.each([['abc'], [-1], [25], [''], [null]])('rejects invalid rate %p with 400 and no write', async bad => {
    const res = await update({ project_name: 'P', tax_rate: bad })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_tax_rate')
    expect(writes).toHaveLength(0)
  })
  test('saves a valid rate as a number (explicit 0 kept)', async () => {
    let res = await update({ tax_rate: '9.125' })
    expect(res.status).toBe(200)
    expect(writes[0].payload.tax_rate).toBe(9.125)
    db.estimates[0].updated_at = 'T1'
    res = await update({ tax_rate: 0 })
    expect(res.status).toBe(200)
    expect(writes[1].payload.tax_rate).toBe(0)
  })
  test('column missing: default rate retries without tax_rate; custom rate refused clearly (not 409)', async () => {
    hasTaxColumn = false
    let res = await update({ project_name: 'P', tax_rate: 8.25 })
    expect(res.status).toBe(200)
    expect(writes[0].payload).not.toHaveProperty('tax_rate')
    db.estimates[0].updated_at = 'T1'
    res = await update({ project_name: 'P', tax_rate: 9.125 })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('migration_missing')
    expect(body.error).toMatch(/048_estimate_tax_rate/)
  })
  test('create validates and stores the rate', async () => {
    let res = await route.POST(req({ action: 'create', fields: { project_name: 'P', tax_rate: 'x' } }))
    expect(res.status).toBe(400)
    res = await route.POST(req({ action: 'create', fields: { project_name: 'P', tax_rate: 9 } }))
    expect(res.status).toBe(200)
    expect(writes.find(w => w.op === 'insert').payload.tax_rate).toBe(9)
  })
})

describe('migration 048', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/048_estimate_tax_rate.sql'), 'utf8')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  test('additive column with 8.25 default and range check; no data rewrite', () => {
    expect(code).toMatch(/ALTER TABLE estimates ADD COLUMN IF NOT EXISTS tax_rate numeric\(6,4\) DEFAULT 8\.25/)
    expect(code).toMatch(/tax_rate >= 0 AND tax_rate <= 20/)
    expect(code).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i)
  })
  test('applied migrations untouched (git sees no diff)', () => {
    const { execSync } = require('child_process')
    const out = execSync('git diff --name-only HEAD -- migrations/042* migrations/044* migrations/045* migrations/046* migrations/047*', { cwd: path.join(__dirname, '..') }).toString().trim()
    expect(out).toBe('')
  })
})
