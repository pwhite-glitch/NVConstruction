/**
 * Tests for base vs change-order SOV lines (lib/sov-lines.js) and the sub-portal
 * SOV route that uses them. Reproduces the Braum's Little Rock case: a CO was
 * approved before the sub set up their schedule, leaving a contract whose only
 * SOV line is "CO: ...".
 */

let db

function mockQuery(table) {
  const filters = []
  let op = null
  let payload = null
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `new${db[table].length + 1}`, ...r }))
      db[table].push(...list)
      return { data: list, error: null }
    }
    if (op === 'update') {
      rows().forEach(r => Object.assign(r, payload))
      return { data: null, error: null }
    }
    return { data: rows(), error: null }
  }
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    insert: p => { op = 'insert'; payload = p; return q },
    update: p => { op = 'update'; payload = p; return q },
    single: () => Promise.resolve(run()).then(r => ({ ...r, data: r.data?.[0] ?? null })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: table => mockQuery(table) }),
}))
jest.mock('../lib/server-auth', () => ({
  requireAuth: async () => ({ userId: 'josh', role: 'sub_pm' }),
}))
jest.mock('../lib/sub-access', () => ({
  billingContext: async () => ({
    job: { can_bill: true },
    contracts: [{ id: 'rogers', description: 'Site work', contract_value: 242148.02, retainage_pct: 10 }],
  }),
}))

const { isCoLine, contractsWithBaseSov, coLineRow, insertCoLine, hasCoLine, addCoSovLine } = require('../lib/sov-lines')
const sovRoute = require('../app/api/sub-portal/sov/route')

const coLine = { id: 'co1', subcontract_id: 'rogers', description: 'CO: 3" SCH 40 PVC', scheduled_value: 1457.7, sort_order: 1 }

function seed(lines = [coLine]) {
  db = { subcontract_sov_lines: lines.map(l => ({ ...l })), billing_sov_lines: [] }
}

const req = (method, body) => new Request('http://x/api/sub-portal/sov?job_id=7543', {
  method,
  ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
})

describe('isCoLine / contractsWithBaseSov', () => {
  test('recognises CO lines by change_order_id or legacy "CO: " prefix', () => {
    expect(isCoLine({ description: 'CO: extra fill' })).toBe(true)
    expect(isCoLine({ description: 'Extra fill', change_order_id: 'x' })).toBe(true)
    expect(isCoLine({ description: 'Mobilization' })).toBe(false)
    expect(isCoLine({ description: 'COncrete' })).toBe(false)
  })

  test('a contract with only CO lines has no base SOV', () => {
    const set = contractsWithBaseSov([coLine, { subcontract_id: 'other', description: 'Mobilization' }])
    expect(set.has('rogers')).toBe(false)
    expect(set.has('other')).toBe(true)
  })

  test('coLineRow links the CO', () => {
    expect(coLineRow({ id: 'c9', subcontract_id: 's', description: 'Rock', amount: '100.50' }, 4))
      .toEqual({ subcontract_id: 's', change_order_id: 'c9', description: 'CO: Rock', scheduled_value: 100.5, sort_order: 4 })
  })
})

describe('insertCoLine', () => {
  test('retries without change_order_id when the column is missing (migration 030 not applied)', async () => {
    const inserted = []
    const client = {
      from: () => ({
        insert: row => {
          inserted.push(row)
          return Promise.resolve('change_order_id' in row
            ? { error: { message: "Could not find the 'change_order_id' column of 'subcontract_sov_lines'" } }
            : { error: null })
        },
      }),
    }
    const res = await insertCoLine(client, coLineRow({ id: 'c1', subcontract_id: 's', description: 'x', amount: 1 }, 1))
    expect(res.error).toBeNull()
    expect(inserted).toHaveLength(2)
    expect(inserted[1]).not.toHaveProperty('change_order_id')
  })
})

describe('addCoSovLine (CO approval, any direction)', () => {
  const client = { from: table => mockQuery(table) }
  const base = { id: 'b1', subcontract_id: 'rogers', description: 'Mobilization', scheduled_value: 1000, sort_order: 3 }
  const co = (over = {}) => ({ id: 'co9', subcontract_id: 'rogers', description: 'Extra rock', amount: '250.00', direction: 'pm_to_sub', ...over })

  test.each(['pm_to_sub', 'sub_to_pm'])('inserts a linked CO line for a %s CO, after existing lines', async direction => {
    seed([base])
    const res = await addCoSovLine(client, co({ direction }))
    expect(res).toEqual({ inserted: true, skipped: false, error: null })
    const added = db.subcontract_sov_lines.find(l => l.change_order_id === 'co9')
    expect(added).toMatchObject({ subcontract_id: 'rogers', description: 'CO: Extra rock', scheduled_value: 250, sort_order: 4 })
  })

  test('skips when a line is already linked by change_order_id', async () => {
    seed([base, { id: 'x', subcontract_id: 'rogers', change_order_id: 'co9', description: 'CO: renamed later', scheduled_value: 250, sort_order: 4 }])
    const res = await addCoSovLine(client, co())
    expect(res.skipped).toBe(true)
    expect(db.subcontract_sov_lines).toHaveLength(2)
  })

  test('skips when a legacy "CO: <description>" line exists on that subcontract', async () => {
    seed([base, { id: 'x', subcontract_id: 'rogers', description: 'CO: Extra rock', scheduled_value: 250, sort_order: 4 }])
    const res = await addCoSovLine(client, co())
    expect(res.skipped).toBe(true)
    expect(db.subcontract_sov_lines).toHaveLength(2)
  })

  test('a matching description on a different subcontract does not block the insert', () => {
    expect(hasCoLine([{ subcontract_id: 'other', description: 'CO: Extra rock' }], co())).toBe(false)
  })

  test('approving twice only adds one line', async () => {
    seed([base])
    await addCoSovLine(client, co())
    const again = await addCoSovLine(client, co())
    expect(again.skipped).toBe(true)
    expect(db.subcontract_sov_lines.filter(isCoLine)).toHaveLength(1)
  })

  test('negative (deduct) amounts are inserted', async () => {
    seed([base])
    const res = await addCoSovLine(client, co({ amount: '-125.5' }))
    expect(res.inserted).toBe(true)
    expect(db.subcontract_sov_lines.find(l => l.change_order_id === 'co9').scheduled_value).toBe(-125.5)
  })

  test('skips COs with no subcontract or a zero/blank amount', async () => {
    seed([base])
    for (const c of [co({ subcontract_id: null }), co({ amount: 0 }), co({ amount: '' }), co({ amount: null })]) {
      expect((await addCoSovLine(client, c)).inserted).toBe(false)
    }
    expect(db.subcontract_sov_lines).toHaveLength(1)
  })

  test('returns the insert error instead of swallowing it', async () => {
    const failing = {
      from: () => ({
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: { message: 'permission denied' } }),
      }),
    }
    const res = await addCoSovLine(failing, co())
    expect(res.inserted).toBe(false)
    expect(res.error.message).toBe('permission denied')
  })
})

describe('sub-portal SOV route', () => {
  test('GET: contract with only a CO line reports has_sov false', async () => {
    seed()
    const json = await (await sovRoute.GET(req('GET'))).json()
    expect(json.contracts[0].has_sov).toBe(false)
  })

  test('POST: base schedule can be created alongside an existing CO line, and sorts first', async () => {
    seed()
    const res = await sovRoute.POST(req('POST', {
      job_id: 'J', subcontract_id: 'rogers',
      lines: [{ description: 'Mobilization', amount: '42148.02' }, { description: 'Earthwork', amount: '200000' }],
    }))
    expect(res.status).toBe(200)
    const lines = [...db.subcontract_sov_lines].sort((a, b) => a.sort_order - b.sort_order)
    expect(lines.map(l => l.description)).toEqual(['Mobilization', 'Earthwork', 'CO: 3" SCH 40 PVC'])
    const json = await (await sovRoute.GET(req('GET'))).json()
    expect(json.contracts[0].has_sov).toBe(true)
  })

  test('POST: base lines must total the base contract value, not including COs', async () => {
    seed()
    const res = await sovRoute.POST(req('POST', {
      job_id: 'J', subcontract_id: 'rogers',
      lines: [{ description: 'Everything', amount: String(242148.02 + 1457.7) }],
    }))
    expect(res.status).toBe(400)
  })

  test('POST: refuses when a base schedule already exists', async () => {
    seed([coLine, { id: 'b1', subcontract_id: 'rogers', description: 'Mobilization', scheduled_value: 242148.02, sort_order: 1 }])
    const res = await sovRoute.POST(req('POST', {
      job_id: 'J', subcontract_id: 'rogers', lines: [{ description: 'All', amount: '242148.02' }],
    }))
    expect(res.status).toBe(409)
  })
})
