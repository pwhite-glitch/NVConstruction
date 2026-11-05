/**
 * Budget line delete safety + CSV import parsing.
 *
 * DELETE /api/budget-items used to delete lines (or every line on a job)
 * even when direct costs, POs, SOV lines, pay app lines or GC entries pointed
 * at them. Now it returns 409 with what's attached and deletes nothing.
 */

let db
let mockAuth
let mockRpc
let deletes

function mockQuery(table) {
  const filters = []
  let range = null
  let op = 'select'
  let insertRows = null
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (db.__errors?.[table]) return { data: null, error: db.__errors[table] }
    if (op === 'delete') {
      const gone = rows()
      deletes.push({ table, ids: gone.map(r => r.id) })
      db[table] = (db[table] || []).filter(r => !gone.includes(r))
      return { data: null, error: null }
    }
    if (op === 'insert') {
      const added = insertRows.map((r, i) => ({ id: `new-${i}`, ...r }))
      db[table] = [...(db[table] || []), ...added]
      return { data: added.map(r => ({ id: r.id })), error: null }
    }
    let data = rows()
    if (range) data = data.slice(range[0], range[1] + 1)
    return { data, error: null }
  }
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    ilike: (c, v) => { filters.push(r => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase()); return q },
    range: (a, b) => { range = [a, b]; return q },
    delete: () => { op = 'delete'; return q },
    insert: r => { op = 'insert'; insertRows = Array.isArray(r) ? r : [r]; return q },
    update: () => q,
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data?.[0] ?? null })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockQuery(table),
    rpc: async (fn, args) => mockRpc(fn, args),
  }),
}))
jest.mock('../lib/server-auth', () => ({
  requirePM: async () => mockAuth,
}))

const route = require('../app/api/budget-items/route')
const { findBudgetLineReferences, buildReferencedConflict, rowIdentifier } = require('../lib/budget-line-refs')
const { parseBudgetCsv, parseAmount, splitCsvRow, toInsertRows } = require('../lib/budget-csv')

function seed() {
  deletes = []
  mockAuth = { userId: 'u1', role: 'pm', email: 'pm@x.com', error: null }
  mockRpc = async () => ({ data: [], error: null })
  db = {
    jobs: [{ id: 'job-1', pm_email: null }, { id: 'job-2', pm_email: null }],
    pm_job_assignments: [{ job_id: 'job-1', user_id: 'u1' }, { job_id: 'job-2', user_id: 'u1' }],
    budget_items: [
      { id: 'b1', job_id: 'job-1', cost_code: '02-000', description: 'Site Work' },
      { id: 'b2', job_id: 'job-1', cost_code: '06-100', description: 'Carpentry' },
      { id: 'b3', job_id: 'job-1', cost_code: '09-000', description: 'Finishes' },
      { id: 'c1', job_id: 'job-2', cost_code: '01-000', description: 'General' },
    ],
    direct_costs: [],
    purchase_orders: [],
    subcontracts: [],
    subcontract_sov_lines: [],
    aia_application_lines: [],
    general_conditions: [],
    employee_job_allocations: [],
    prime_change_orders: [],
  }
}
beforeEach(seed)

const del = body => route.DELETE(new Request('http://x/api/budget-items', {
  method: 'DELETE', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}))
const post = body => route.POST(new Request('http://x/api/budget-items', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}))
const ids = () => db.budget_items.map(b => b.id)

describe('DELETE one budget line', () => {
  test('unreferenced line is deleted', async () => {
    const res = await del({ id: 'b3' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 1 })
    expect(ids()).toEqual(['b1', 'b2', 'c1'])
  })

  test('line with direct costs is not deleted: 409 lists what is attached', async () => {
    db.direct_costs = [
      { id: 'dc1', budget_item_id: 'b1', description: 'Gravel' },
      { id: 'dc2', budget_item_id: 'b1', description: 'Rebar' },
      { id: 'dc3', budget_item_id: 'b2', description: 'Other line' },
    ]
    db.purchase_orders = [{ id: 'po1', budget_item_id: 'b1', po_number: 'PO-12' }]
    const res = await del({ id: 'b1' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('budget_line_referenced')
    expect(body.references).toHaveLength(1)
    expect(body.references[0].budget_item_id).toBe('b1')
    const att = Object.fromEntries(body.references[0].attachments.map(a => [a.source_table, a]))
    expect(att.direct_costs).toMatchObject({ count: 2, identifiers: ['Gravel', 'Rebar'] })
    expect(att.purchase_orders).toMatchObject({ count: 1, identifiers: ['PO-12'] })
    expect(body.error).toMatch(/2 direct costs \(Gravel, Rebar\)/)
    expect(body.error).toMatch(/1 purchase orders \(PO-12\)/)
    expect(deletes).toEqual([])
    expect(ids()).toContain('b1')
  })

  test.each([
    ['subcontract_sov_lines', { id: 's1', budget_item_id: 'b2', description: 'Framing SOV' }],
    ['aia_application_lines', { id: 'a1', budget_item_id: 'b2' }],
    ['general_conditions', { id: 'g1', budget_item_id: 'b2', description: 'Super salary' }],
    ['employee_job_allocations', { id: 'e1', budget_item_id: 'b2' }],
  ])('blocked by %s', async (table, row) => {
    db[table] = [row]
    const res = await del({ id: 'b2' })
    expect(res.status).toBe(409)
    expect((await res.json()).references[0].attachments[0].source_table).toBe(table)
    expect(ids()).toContain('b2')
  })

  test('blocked by JSON allocations on a subcontract', async () => {
    db.subcontracts = [{ id: 'sc1', job_id: 'job-1', vendor_name: 'ACME Framing', budget_item_id: null,
      budget_allocations: [{ budget_item_id: 'b2', amount: 100 }] }]
    const res = await del({ id: 'b2' })
    expect(res.status).toBe(409)
    const a = (await res.json()).references[0].attachments[0]
    expect(a).toMatchObject({ source_table: 'subcontracts', source_column: 'budget_allocations', identifiers: ['ACME Framing'] })
  })

  test('blocked by prime change order SOV stored as JSON text', async () => {
    db.prime_change_orders = [{ id: 'pco1', job_id: 'job-1', description: 'CO 1', sov: JSON.stringify([{ budget_item_id: 'b3', amount: 5 }]) }]
    const res = await del({ id: 'b3' })
    expect(res.status).toBe(409)
  })

  test('a missing table/column is skipped, any other query error fails closed', async () => {
    db.__errors = { general_conditions: { code: '42703', message: 'column general_conditions.budget_item_id does not exist' } }
    expect((await del({ id: 'b3' })).status).toBe(200)

    seed()
    db.__errors = { direct_costs: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const res = await del({ id: 'b3' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Could not check direct costs/)
    expect(ids()).toContain('b3')
  })

  test('keeps the job-access guard', async () => {
    db.pm_job_assignments = []
    const res = await del({ id: 'b3' })
    expect(res.status).toBe(403)
    expect(ids()).toContain('b3')
  })

  test('unknown line is 404', async () => {
    mockAuth = { userId: 'u1', role: 'admin', error: null }
    expect((await del({ id: 'nope' })).status).toBe(404)
  })
})

describe('DELETE all budget lines on a job', () => {
  test('nothing referenced: deletes only that job\'s lines', async () => {
    const res = await del({ job_id: 'job-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 3 })
    expect(ids()).toEqual(['c1'])
  })

  test('blocked if any line is referenced; lists which lines', async () => {
    db.direct_costs = [{ id: 'dc1', budget_item_id: 'b2', description: 'Lumber' }]
    db.subcontract_sov_lines = [{ id: 's1', budget_item_id: 'b3', description: 'Paint SOV' }]
    db.direct_costs.push({ id: 'dcx', budget_item_id: 'c1', description: 'Other job' })
    const res = await del({ job_id: 'job-1' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.references.map(r => r.budget_item_id).sort()).toEqual(['b2', 'b3'])
    expect(body.error).toMatch(/2 budget lines have records attached, so nothing was deleted/)
    expect(body.error).toMatch(/06-100 — Carpentry: 1 direct costs \(Lumber\)/)
    expect(body.error).toMatch(/09-000 — Finishes: 1 subcontract sov lines \(Paint SOV\)/)
    expect(deletes).toEqual([])
    expect(ids()).toEqual(['b1', 'b2', 'b3', 'c1'])
  })

  test('blocked by the SQL backstop when it sees references the per-line check missed', async () => {
    mockRpc = async (fn, args) => {
      expect(fn).toBe('budget_line_references')
      expect(args).toEqual({ p_job_id: 'job-1' })
      return { data: [{ source_table: 'warranty_items', source_column: 'budget_line', ref_count: 2 }], error: null }
    }
    const res = await del({ job_id: 'job-1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/warranty_items \(budget_line\): 2 row/)
    expect(ids()).toHaveLength(4)
  })

  test('backstop missing (migration 039 not applied) does not block; other RPC errors do', async () => {
    mockRpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    expect((await del({ job_id: 'job-1' })).status).toBe(200)

    seed()
    mockRpc = async () => ({ data: null, error: { code: 'XX000', message: 'boom' } })
    expect((await del({ job_id: 'job-1' })).status).toBe(500)
    expect(ids()).toHaveLength(4)
  })

  test('keeps the job-access guard', async () => {
    db.pm_job_assignments = []
    expect((await del({ job_id: 'job-1' })).status).toBe(403)
    expect(ids()).toHaveLength(4)
  })
})

describe('POST budget lines', () => {
  test('returns the inserted count', async () => {
    const res = await post([
      { job_id: 'job-1', description: 'A', budget_amount: 10, owner_amount: null },
      { job_id: 'job-1', description: 'B', budget_amount: 20, owner_amount: 22 },
    ])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, inserted: 2 })
  })

  test('rejects non-numeric amounts with the row number; inserts nothing', async () => {
    const before = db.budget_items.length
    const res = await post([
      { job_id: 'job-1', description: 'A', budget_amount: 10 },
      { job_id: 'job-1', description: 'B', budget_amount: '12abc' },
    ])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Row 2: budget amount must be a number/)
    expect(db.budget_items.length).toBe(before)
  })
})

describe('reference helpers', () => {
  test('findBudgetLineReferences returns {} for no ids', async () => {
    expect(await findBudgetLineReferences({}, 'job-1', [])).toEqual({ refs: {}, error: null })
  })
  test('rowIdentifier prefers numbers, then names, then description', () => {
    expect(rowIdentifier({ id: 'x', po_number: 'PO-1', description: 'd' })).toBe('PO-1')
    expect(rowIdentifier({ id: 'x', vendor_name: 'ACME' })).toBe('ACME')
    expect(rowIdentifier({ id: 'abcdef123456' })).toBe('id abcdef12')
  })
  test('buildReferencedConflict for a single line', () => {
    const out = buildReferencedConflict([{ id: 'b1', cost_code: '02', description: 'Site' }],
      { b1: [{ source_table: 'direct_costs', source_column: 'budget_item_id', label: 'Direct costs', count: 7, identifiers: ['a', 'b'] }] })
    expect(out.error).toMatch(/^This budget line can't be deleted/)
    expect(out.error).toMatch(/02 — Site: 7 direct costs \(a, b, …\)/)
  })
})

// ── CSV ─────────────────────────────────────────────────────────────────────
describe('budget CSV parsing', () => {
  test('parseAmount', () => {
    expect(parseAmount('$1,234.50')).toBe(1234.5)
    expect(parseAmount(' 500 ')).toBe(500)
    expect(parseAmount('(250.00)')).toBe(-250)
    expect(parseAmount('-3')).toBe(-3)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
    expect(parseAmount('abc')).toBeNaN()
    expect(parseAmount('12abc')).toBeNaN()
    expect(parseAmount('1.2.3')).toBeNaN()
    expect(parseAmount('TBD')).toBeNaN()
  })

  test('splitCsvRow handles quoted commas and escaped quotes', () => {
    expect(splitCsvRow('03-000,"Concrete, footings","$1,000"')).toEqual(['03-000', 'Concrete, footings', '$1,000'])
    expect(splitCsvRow('a,"say ""hi""",1')).toEqual(['a', 'say "hi"', '1'])
  })

  test('skips a header row, parses good rows, reports bad amounts by line', () => {
    const csv = [
      'Cost Code,Description,Amount,Owner Amount',
      '02-000,Site work,"$5,000",5500',
      '',
      '03-000,Concrete,TBD,',
      '04-000,Masonry,,',
      '05-000,,100,',
      '06-000,Carpentry,700,abc',
    ].join('\r\n')
    const out = parseBudgetCsv(csv)
    expect(out.headerSkipped).toBe(true)
    expect(out.valid).toEqual([expect.objectContaining({ line: 2, cost_code: '02-000', description: 'Site work', budget_amount: 5000, owner_amount: 5500 })])
    expect(out.invalid.map(r => [r.line, r.errors])).toEqual([
      [4, ['Budget amount "TBD" is not a number']],
      [5, ['Budget amount is missing']],
      [6, ['Description is missing']],
      [7, ['Owner amount "abc" is not a number']],
    ])
  })

  test('no header: first row is data', () => {
    const out = parseBudgetCsv('01-000,General,100')
    expect(out.headerSkipped).toBe(false)
    expect(out.valid).toHaveLength(1)
  })

  test('first row with a bad amount is an error, not silently dropped as a header', () => {
    const out = parseBudgetCsv('01-000,General,n/a\n02-000,Site,5')
    expect(out.headerSkipped).toBe(false)
    expect(out.invalid.map(r => r.line)).toEqual([1])
  })

  test('warns on cost codes already on the job and repeated in the file', () => {
    const out = parseBudgetCsv('02-000,Site,1\n03-000,Concrete,2\n03-000 ,Concrete 2,3', [{ cost_code: '02-000' }, { cost_code: null }])
    expect(out.duplicates.map(r => [r.line, r.warnings])).toEqual([
      [1, ['Cost code 02-000 already exists on this job']],
      [3, ['Cost code 03-000 also appears on line 2']],
    ])
    expect(out.invalid).toEqual([])
  })

  test('toInsertRows appends after existing sort_order', () => {
    const { valid } = parseBudgetCsv('a,One,1\nb,Two,2,3')
    expect(toInsertRows(valid, 'job-1', [{ sort_order: 4 }, { sort_order: null }])).toEqual([
      { job_id: 'job-1', cost_code: 'a', description: 'One', budget_amount: 1, owner_amount: null, sort_order: 5 },
      { job_id: 'job-1', cost_code: 'b', description: 'Two', budget_amount: 2, owner_amount: 3, sort_order: 6 },
    ])
    expect(toInsertRows(valid, 'job-1', [])[0].sort_order).toBe(0)
  })
})
