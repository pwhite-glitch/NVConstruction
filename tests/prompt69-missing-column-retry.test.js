/**
 * Prompt 69 leftovers: the direct_costs missing-column retry drops ONLY the column the
 * database names (lib/missing-column-retry.js). Live has no `vendor` column but the job page
 * always sends it, so the old "strip every migration-022 column" retry also dropped
 * purchase_order_id (067) and is_credit. Also: a job move clears the PO link in the same
 * update; the Cash Flow tab warns when POs fail to load.
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({
  Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } },
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})

const { missingColumnName, isMissingColumnError, writeWithMissingColumnRetry, poLinkDropped } = require('../lib/missing-column-retry')
const directCosts = require('../app/api/direct-costs/route')
const review = require('../app/api/dc-review/route')

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const req = (method, body) => new Request('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const postDc = body => directCosts.POST(req('POST', body))
const putDc = body => directCosts.PUT(req('PUT', body))
const edit = body => review.POST(req('POST', { action: 'edit', ...body }))
const dcInserts = () => mockState.calls.filter(c => c.table === 'direct_costs' && c.op === 'insert')
const dcUpdates = () => mockState.calls.filter(c => c.table === 'direct_costs' && c.op === 'update')
const dc = id => mockState.db.direct_costs.find(r => r.id === id)

const pgrst = col => ({ code: 'PGRST204', message: `Could not find the '${col}' column of 'direct_costs' in the schema cache` })

// ── lib/missing-column-retry.js ─────────────────────────────────────────────
describe('missingColumnName / isMissingColumnError', () => {
  test('parses PGRST204 and 42703 shapes', () => {
    expect(missingColumnName(pgrst('vendor'))).toBe('vendor')
    expect(missingColumnName({ code: '42703', message: 'column "purchase_order_id" of relation "direct_costs" does not exist' })).toBe('purchase_order_id')
    expect(missingColumnName({ code: '42703', message: 'column "vendor" does not exist' })).toBe('vendor')
    expect(missingColumnName({ code: '42703', message: 'column direct_costs.is_credit does not exist' })).toBe('is_credit')
    expect(missingColumnName({ message: 'Could not query the database for the schema cache. Retrying.' })).toBeNull()
    expect(missingColumnName(null)).toBeNull()
  })

  test('only schema / missing-column errors trigger a retry', () => {
    expect(isMissingColumnError(pgrst('vendor'))).toBe(true)
    expect(isMissingColumnError({ code: '42703', message: 'x' })).toBe(true)
    expect(isMissingColumnError({ message: 'something about the schema cache' })).toBe(true)
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
  })
})

describe('writeWithMissingColumnRetry', () => {
  // A fake table missing the given columns; records every row it was sent.
  const fakeTable = missing => {
    const sent = []
    const run = async r => {
      sent.push(r)
      const col = (Array.isArray(r) ? r.flatMap(Object.keys) : Object.keys(r)).find(k => missing.includes(k))
      return col ? { data: null, error: pgrst(col) } : { data: [{ id: 'ok' }], error: null }
    }
    return { run, sent }
  }

  test('drops only the named column, one at a time', async () => {
    const t = fakeTable(['vendor', 'reviewed_by'])
    const row = { job_id: 'J1', amount: 5, vendor: 'x', reviewed_by: 'u', is_credit: true, purchase_order_id: 'PO1' }
    const res = await writeWithMissingColumnRetry(t.run, row, { fallbackCols: ['vendor', 'reviewed_by', 'is_credit', 'purchase_order_id'] })
    expect(res.error).toBeNull()
    expect(res.dropped).toEqual(['vendor', 'reviewed_by'])
    expect(res.row).toEqual({ job_id: 'J1', amount: 5, is_credit: true, purchase_order_id: 'PO1' })
    expect(t.sent).toHaveLength(3)
    expect(row).toHaveProperty('vendor') // input not mutated
  })

  test('no error → one call, nothing dropped', async () => {
    const t = fakeTable([])
    const res = await writeWithMissingColumnRetry(t.run, { a: 1 })
    expect(res).toMatchObject({ error: null, dropped: [] })
    expect(t.sent).toHaveLength(1)
  })

  test('unparseable schema error: old allowlist strip, but never purchase_order_id / is_credit / amount / job_id / status', async () => {
    const sent = []
    const run = async r => { sent.push(r); return 'vendor' in r ? { data: null, error: { message: 'schema cache is stale' } } : { data: [], error: null } }
    const row = { job_id: 'J1', status: 'approved', amount: 5, vendor: 'v', notif_sent_at: 't', is_credit: true, purchase_order_id: 'PO1' }
    const fallbackCols = ['vendor', 'notif_sent_at', 'is_credit', 'purchase_order_id', 'amount', 'job_id', 'status']
    const res = await writeWithMissingColumnRetry(run, row, { fallbackCols })
    expect(res.error).toBeNull()
    expect(res.dropped.sort()).toEqual(['notif_sent_at', 'vendor'])
    expect(res.row).toEqual({ job_id: 'J1', status: 'approved', amount: 5, is_credit: true, purchase_order_id: 'PO1' })
  })

  test('unparseable error with nothing strippable → surfaces after one call', async () => {
    let calls = 0
    const run = async () => { calls++; return { data: null, error: { message: 'schema cache is stale' } } }
    const res = await writeWithMissingColumnRetry(run, { amount: 1, purchase_order_id: 'PO1', is_credit: false }, { fallbackCols: ['vendor'] })
    expect(res.error.message).toMatch(/schema cache/)
    expect(res.dropped).toEqual([])
    expect(calls).toBe(1)
  })

  test('no infinite loop: a column that keeps being reported is not retried twice, and calls ≤ keys + 1', async () => {
    let calls = 0
    // Always blames vendor, even after it is gone.
    const run = async () => { calls++; return { data: null, error: pgrst('vendor') } }
    const res = await writeWithMissingColumnRetry(run, { vendor: 'v', description: 'd' }, { fallbackCols: ['vendor'] })
    expect(res.error.code).toBe('PGRST204')
    expect(res.dropped).toEqual(['vendor'])
    expect(calls).toBe(2)

    // Unparseable error that never clears: each pass strips something new, then stops.
    let n = 0
    const run2 = async () => { n++; return { data: null, error: { message: 'schema cache' } } }
    const row = { a: 1, b: 2, c: 3 }
    await writeWithMissingColumnRetry(run2, row, { fallbackCols: ['a', 'b', 'c'] })
    expect(n).toBeLessThanOrEqual(Object.keys(row).length + 1)
  })

  test('a named column not in the row, or a core column, is not stripped', async () => {
    let calls = 0
    const run = async () => { calls++; return { data: null, error: pgrst('drawn_aia_delta') } }
    expect((await writeWithMissingColumnRetry(run, { a: 1 })).dropped).toEqual([])
    expect(calls).toBe(1)
    const run2 = async r => ('amount' in r ? { data: null, error: pgrst('amount') } : { data: [], error: null })
    const res = await writeWithMissingColumnRetry(run2, { amount: 1, vendor: 'x' })
    expect(res.error.code).toBe('PGRST204')
    expect(res.dropped).toEqual([])
  })

  test('a named column that is not on the optional list → original error, no retry', async () => {
    // CSV bulk regression: an array spread into an object gives keys '0', '1', …
    let calls = 0
    const run = async () => { calls++; return { data: null, error: pgrst('0') } }
    const row = { 0: { amount: 1 }, 1: { amount: 2 }, receipt_url: null }
    const res = await writeWithMissingColumnRetry(run, row, { fallbackCols: ['vendor', 'purchase_order_id'] })
    expect(res.error).toEqual(pgrst('0'))
    expect(res.dropped).toEqual([])
    expect(res.row).toEqual(row)
    expect(calls).toBe(1)
  })

  test('is_credit / amount / job_id / status are never dropped, even when listed', async () => {
    for (const col of ['is_credit', 'amount', 'job_id', 'status']) {
      let calls = 0
      const run = async () => { calls++; return { data: null, error: pgrst(col) } }
      const res = await writeWithMissingColumnRetry(run, { [col]: 1, vendor: 'x' }, { fallbackCols: [col, 'vendor'] })
      expect(res.error.message).toMatch(col)
      expect(res.dropped).toEqual([])
      expect(calls).toBe(1)
    }
  })

  test('purchase_order_id: dropped by name when listed, never by the unparsed fallback', async () => {
    const t = fakeTable(['purchase_order_id'])
    const res = await writeWithMissingColumnRetry(t.run, { amount: 1, purchase_order_id: 'PO1' }, { fallbackCols: ['purchase_order_id'] })
    expect(res).toMatchObject({ error: null, dropped: ['purchase_order_id'], row: { amount: 1 } })
    let calls = 0
    const run = async () => { calls++; return { data: null, error: { message: 'schema cache' } } }
    const res2 = await writeWithMissingColumnRetry(run, { amount: 1, purchase_order_id: 'PO1' }, { fallbackCols: ['purchase_order_id'] })
    expect(res2.dropped).toEqual([])
    expect(calls).toBe(1)
  })

  test('array of rows: the named optional column is dropped from EVERY row', async () => {
    const t = fakeTable(['vendor'])
    const rows = [{ amount: 1, vendor: 'a' }, { amount: 2 }, { amount: 3, vendor: null }]
    const res = await writeWithMissingColumnRetry(t.run, rows, { fallbackCols: ['vendor'] })
    expect(res.error).toBeNull()
    expect(res.dropped).toEqual(['vendor'])
    expect(t.sent).toHaveLength(2)
    expect(t.sent[1]).toEqual([{ amount: 1 }, { amount: 2 }, { amount: 3 }])
    expect(rows[0]).toHaveProperty('vendor') // input not mutated
    expect(poLinkDropped([{ purchase_order_id: null }, { purchase_order_id: 'PO1' }], ['purchase_order_id'])).toBe(true)
    expect(poLinkDropped([{ purchase_order_id: null }, {}], ['purchase_order_id'])).toBe(false)
  })

  test('other errors are returned untouched, no retry', async () => {
    let calls = 0
    const run = async () => { calls++; return { data: null, error: { code: '23503', message: 'violates foreign key constraint' } } }
    const res = await writeWithMissingColumnRetry(run, { purchase_order_id: 'PO1' })
    expect(res.error.code).toBe('23503')
    expect(calls).toBe(1)
  })

  test('poLinkDropped only when a link was asked for', () => {
    expect(poLinkDropped({ purchase_order_id: 'PO1' }, ['purchase_order_id'])).toBe(true)
    expect(poLinkDropped({ purchase_order_id: null }, ['purchase_order_id'])).toBe(false)
    expect(poLinkDropped({ purchase_order_id: 'PO1' }, ['vendor'])).toBe(false)
  })
})

// ── Routes with the live schema (no vendor column) ──────────────────────────
function seed() {
  resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', pm_email: null }, { id: 'J2', job_number: '202', project_name: 'Elm', pm_email: null }],
    pm_job_assignments: [],
    profiles: [],
    budget_items: [{ id: 'L1', job_id: 'J1' }],
    owner_reimb_invoice_lines: [],
    purchase_orders: [
      { id: 'PO1', job_id: 'J1', status: 'issued', payment_type: 'reimbursement', amount: 1000 },
      { id: 'PO2', job_id: 'J2', status: 'issued', payment_type: 'reimbursement', amount: 500 },
    ],
    direct_costs: [
      { id: 'appr', job_id: 'J1', status: 'approved', amount: 200, budget_item_id: null, description: 'Lumber', draw_request_id: null, drawn_application_id: null, purchase_order_id: null },
      { id: 'linked', job_id: 'J1', status: 'approved', amount: 300, budget_item_id: null, description: 'Survey', draw_request_id: null, drawn_application_id: null, purchase_order_id: 'PO1' },
    ],
  })
  mockState.auth = { userId: 'own1', role: 'principal', error: null }
}

// What app/jobdetail/page.js rowData sends (vendor always present).
const pageRow = (over = {}) => ({ job_id: 'J1', submitted_by: 'own1', cost_date: '2026-11-09', description: '360 Survey', vendor: null, category: 'Materials', amount: 1000, status: 'approved', is_credit: true, purchase_order_id: 'PO1', ...over })

describe('POST /api/direct-costs with live schema', () => {
  beforeEach(seed)

  test('vendor missing + PO column present → PO link and is_credit kept', async () => {
    mockState.missingCols = { direct_costs: ['vendor'] }
    const res = await postDc(pageRow())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(dcInserts()).toHaveLength(1)
    const p = dcInserts()[0].payload
    expect(p).not.toHaveProperty('vendor')
    expect(p).toMatchObject({ purchase_order_id: 'PO1', is_credit: true, amount: 1000, description: '360 Survey' })
  })

  test('vendor + PO column missing → both dropped, ok with po_link_saved false', async () => {
    mockState.missingCols = { direct_costs: ['vendor', 'purchase_order_id'] }
    const res = await postDc(pageRow())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, po_link_saved: false })
    const p = dcInserts()[0].payload
    expect(p).not.toHaveProperty('vendor')
    expect(p).not.toHaveProperty('purchase_order_id')
    expect(p).toMatchObject({ is_credit: true, amount: 1000 })
  })

  test('no link requested and the PO column is missing → plain ok', async () => {
    mockState.missingCols = { direct_costs: ['vendor', 'purchase_order_id'] }
    const res = await postDc(pageRow({ purchase_order_id: undefined }))
    expect(await res.json()).toEqual({ ok: true })
  })

  test('unparseable schema error: strips the 022 columns but keeps PO link and is_credit', async () => {
    mockState.failWrite = { direct_costs: (op, payload) => (op === 'insert' && 'vendor' in payload ? { message: 'schema cache reload in progress' } : null) }
    const res = await postDc(pageRow())
    expect(res.status).toBe(200)
    const p = dcInserts()[0].payload
    expect(p).not.toHaveProperty('vendor')
    expect(p).toMatchObject({ purchase_order_id: 'PO1', is_credit: true })
  })

  test('CSV bulk (2-row array, vendor missing) → 2 rows inserted, no stray keys', async () => {
    mockState.missingCols = { direct_costs: ['vendor'] }
    // What app/jobdetail/page.js submitCsvImport sends (plus vendor, to exercise the retry).
    const csv = [1, 2].map(i => ({ job_id: 'J1', submitted_by: 'own1', cost_date: '2026-11-0' + i, description: 'csv' + i, category: 'Materials', amount: i * 10, notes: null, budget_item_id: null, status: 'approved', vendor: 'V' + i }))
    const before = mockState.db.direct_costs.length
    const res = await postDc(csv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const ins = dcInserts()
    expect(ins).toHaveLength(1)
    expect(Array.isArray(ins[0].payload)).toBe(true)
    expect(ins[0].payload).toHaveLength(2)
    for (const p of ins[0].payload) {
      expect(p).not.toHaveProperty('vendor')
      expect(p).not.toHaveProperty('receipt_url')
      expect(p).not.toHaveProperty('0')
    }
    expect(mockState.db.direct_costs.length).toBe(before + 2)
    expect(mockState.db.direct_costs.slice(-2).map(r => [r.description, r.amount, r.job_id])).toEqual([['csv1', 10, 'J1'], ['csv2', 20, 'J1']])
  })

  test('CSV bulk with a requested PO link and the 067 column missing → po_link_saved false', async () => {
    mockState.missingCols = { direct_costs: ['purchase_order_id'] }
    const res = await postDc([pageRow({ purchase_order_id: null, vendor: undefined }), pageRow({ vendor: undefined })])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, po_link_saved: false })
    expect(dcInserts()[0].payload.every(p => !('purchase_order_id' in p))).toBe(true)
  })

  test('CSV bulk: a link to another job\'s PO in any row → 400, nothing inserted', async () => {
    const res = await postDc([pageRow({ purchase_order_id: null }), pageRow({ purchase_order_id: 'PO2' })])
    expect(res.status).toBe(400)
    expect(dcInserts()).toHaveLength(0)
  })

  test('malformed purchase_order_id → 400 with a clear message (create and edit)', async () => {
    mockState.failSelect = { purchase_orders: 'invalid input syntax for type uuid: "abc"' }
    let res = await postDc(pageRow({ purchase_order_id: 'abc' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid purchase order/)
    expect(dcInserts()).toHaveLength(0)
    res = await edit({ id: 'appr', purchase_order_id: 'abc' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid purchase order/)
    expect(dcUpdates()).toHaveLength(0)
  })

  test('a non-schema error still surfaces as 500, nothing inserted', async () => {
    let attempts = 0
    mockState.failWrite = { direct_costs: op => (op === 'insert' ? (attempts++, { code: '23514', message: 'violates check constraint' }) : null) }
    const res = await postDc(pageRow())
    expect(res.status).toBe(500)
    expect(attempts).toBe(1)
    expect(dcInserts()).toHaveLength(0)
  })
})

describe('dc-review edit with live schema', () => {
  beforeEach(seed)

  test('vendor missing + PO column present → link saved', async () => {
    mockState.missingCols = { direct_costs: ['vendor'] }
    const res = await edit({ id: 'appr', vendor: '', description: 'Lumber 2x4', purchase_order_id: 'PO1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(dc('appr')).toMatchObject({ purchase_order_id: 'PO1', description: 'Lumber 2x4' })
    expect(dc('appr')).not.toHaveProperty('vendor')
  })

  test('vendor + reviewed_* + PO column missing → rest saved, po_link_saved false', async () => {
    mockState.missingCols = { direct_costs: ['vendor', 'reviewed_by', 'reviewed_at', 'purchase_order_id'] }
    const res = await edit({ id: 'appr', vendor: '', description: 'Lumber 2x4', purchase_order_id: 'PO1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, po_link_saved: false })
    expect(dc('appr').description).toBe('Lumber 2x4')
    expect(dc('appr').purchase_order_id).toBeNull()
  })

  test('approve still works when reviewed_by / reviewed_at are missing', async () => {
    mockState.db.direct_costs.push({ id: 'pend', job_id: 'J1', status: 'pending', amount: 50, budget_item_id: 'L1', receipt_url: 'r.jpg', description: 'x', draw_request_id: null, drawn_application_id: null })
    mockState.missingCols = { direct_costs: ['vendor', 'reviewed_by', 'reviewed_at'] }
    const res = await review.POST(req('POST', { action: 'approve', id: 'pend' }))
    expect(res.status).toBe(200)
    expect(dc('pend').status).toBe('approved')
  })
})

describe('PUT job move clears the PO link in the same update', () => {
  beforeEach(seed)

  test('one update carries job_id and purchase_order_id: null', async () => {
    const res = await putDc({ id: 'linked', job_id: 'J2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(dcUpdates()).toHaveLength(1)
    expect(dcUpdates()[0].payload).toMatchObject({ job_id: 'J2', purchase_order_id: null })
    expect(dc('linked')).toMatchObject({ job_id: 'J2', purchase_order_id: null })
  })

  test('before 067: the move lands in one write without the key', async () => {
    mockState.missingCols = { direct_costs: ['purchase_order_id'] }
    const res = await putDc({ id: 'appr', job_id: 'J2' })
    expect(res.status).toBe(200)
    expect(dcUpdates()).toHaveLength(1)
    expect(dcUpdates()[0].payload).not.toHaveProperty('purchase_order_id')
    expect(dc('appr').job_id).toBe('J2')
  })

  test('budget-line change only (no move) does not touch purchase_order_id', async () => {
    const res = await putDc({ id: 'linked', budget_item_id: 'L1' })
    expect(res.status).toBe(200)
    expect(dcUpdates()[0].payload).not.toHaveProperty('purchase_order_id')
    expect(dc('linked').purchase_order_id).toBe('PO1')
  })
})

// ── Source checks ───────────────────────────────────────────────────────────
describe('page / route wiring', () => {
  const page = read('app/jobdetail/page.js')

  test('routes no longer group-strip purchase_order_id', () => {
    for (const f of ['app/api/direct-costs/route.js', 'app/api/dc-review/route.js']) {
      const src = read(f)
      expect(src).toMatch(/writeWithMissingColumnRetry/)
      const set = src.match(/const NEW_022_COLS = \[[^\]]*\]/)[0]
      expect(set).not.toMatch(/purchase_order_id/)
    }
  })

  test('job page tells the PM when the PO link was not saved', () => {
    expect(page).toMatch(/needs migration 067/)
    expect(page).toMatch(/json\.po_link_saved === false/)
    expect(page).toMatch(/editResult\.po_link_saved === false/)
  })

  test('Cash Flow POs out card warns when POs could not load', () => {
    expect(page).toMatch(/setPoLoadError\(true\)/)
    const start = page.indexOf("{activeTab === 'cashflow' && (() => {")
    expect(page.slice(start, start + 12000)).toMatch(/poLoadError && <div[^>]*>⚠ POs couldn't load/)
  })

  test('cash outlook keeps only linked direct costs (filtered in JS: prompt51 test stub has no .not())', () => {
    expect(read('app/api/cash-outlook/route.js')).toMatch(/dcRes\.data\.filter\(dc => dc\.purchase_order_id\)/)
  })
})
