/**
 * Prompt 65: sales-order Tasks and Updates use the same order-level access check as
 * /api/sales-orders and /api/sales-order-docs. Metal-building orders: office, or a
 * metal_rep on the order (salesperson or attribution). Roofing orders: role gate only.
 * Super may not write; super cannot read MB rows. Names come from the caller's profile.
 * DB/auth/notify mocked; nothing live.
 */
const { mockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => (mockState.auth ? mockState.auth : unauth()),
    requirePM: async () => (!mockState.auth ? unauth() : PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => ['subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator'].includes(r),
  }
})
const mockNotified = []
jest.mock('../lib/notify', () => ({ notify: async n => { mockNotified.push(n) } }))

const { ID, seed, as, jsonReq, getReq, out } = require('./helpers/mb-fixture')
const tasks = require('../app/api/sales-order-tasks/route')
const updates = require('../app/api/sales-order-updates/route')

const SUPER = '80000000-0000-4000-8000-000000000001'
const T1 = 'a0000000-0000-4000-8000-000000000001' // O1, created by REP1
const T2 = 'a0000000-0000-4000-8000-000000000002' // O2, created by REP3
const T3 = 'a0000000-0000-4000-8000-000000000003' // O1, created by PM
const TR = 'a0000000-0000-4000-8000-000000000004' // R1, created by ROOF
const U1 = 'b0000000-0000-4000-8000-000000000001' // O1 internal
const U2 = 'b0000000-0000-4000-8000-000000000002' // O1 customer-visible
const U3 = 'b0000000-0000-4000-8000-000000000003' // O2 internal
const UR = 'b0000000-0000-4000-8000-000000000004' // R1

const getTasks = async qs => out(await tasks.GET(getReq(`http://x/api/sales-order-tasks${qs ? `?${qs}` : ''}`)))
const postTasks = async body => out(await tasks.POST(jsonReq('http://x/api/sales-order-tasks', 'POST', body)))
const getUpdates = async qs => out(await updates.GET(getReq(`http://x/api/sales-order-updates${qs ? `?${qs}` : ''}`)))
const postUpdates = async body => out(await updates.POST(jsonReq('http://x/api/sales-order-updates', 'POST', body)))
const task = id => mockState.db.sales_order_tasks.find(t => t.id === id)
const writes = table => mockState.calls.filter(c => c.table === table && c.op !== 'select')
const asSuper = () => { mockState.auth = { userId: SUPER, email: 'super@nv.test', role: 'super', error: null } }

beforeEach(() => {
  mockNotified.length = 0
  seed({
    sales_order_tasks: [
      { id: T1, order_id: ID.O1, order_number: 'MB-2026-001', title: 'O1 task', status: 'open', assignee_id: ID.REP1, due_date: '2026-11-10', created_by: ID.REP1, created_by_name: 'REP1 Person', created_at: '2026-11-01T00:00:00Z' },
      { id: T2, order_id: ID.O2, order_number: 'MB-2026-002', title: 'O2 task', status: 'open', assignee_id: ID.REP1, due_date: '2026-11-11', created_by: ID.REP3, created_by_name: 'REP3 Person', created_at: '2026-11-01T00:00:00Z' },
      { id: T3, order_id: ID.O1, order_number: 'MB-2026-001', title: 'PM task', status: 'open', assignee_id: null, due_date: null, created_by: ID.PM, created_by_name: 'PM Person', created_at: '2026-11-01T00:00:00Z' },
      { id: TR, order_id: ID.R1, order_number: 'RF-2026-001', title: 'Roof task', status: 'open', assignee_id: null, due_date: null, created_by: ID.ROOF, created_by_name: 'ROOF Person', created_at: '2026-11-01T00:00:00Z' },
    ],
    sales_order_updates: [
      { id: U1, order_id: ID.O1, body: 'O1 internal', visible_to_customer: false, author_id: ID.PM, author_name: 'PM Person', created_at: '2026-11-01T00:00:00Z' },
      { id: U2, order_id: ID.O1, body: 'O1 public', visible_to_customer: true, author_id: ID.REP1, author_name: 'REP1 Person', created_at: '2026-11-02T00:00:00Z' },
      { id: U3, order_id: ID.O2, body: 'O2 internal', visible_to_customer: false, author_id: ID.REP3, author_name: 'REP3 Person', created_at: '2026-11-01T00:00:00Z' },
      { id: UR, order_id: ID.R1, body: 'Roof note', visible_to_customer: false, author_id: ID.ROOF, author_name: 'ROOF Person', created_at: '2026-11-01T00:00:00Z' },
    ],
  })
  mockState.db.profiles.push({ id: SUPER, full_name: 'SUPER Person', role: 'super' })
})

describe('1. no session', () => {
  test('401 on GET and POST of both routes', async () => {
    as(null)
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(401)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'x' })).status).toBe(401)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(401)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(401)
    expect(writes('sales_order_tasks')).toHaveLength(0)
    expect(writes('sales_order_updates')).toHaveLength(0)
  })
})

describe('2. tasks GET requires order_id', () => {
  test('no order_id → 400 and no tasks returned', async () => {
    for (const key of ['REP1', 'PM', 'OWNER']) {
      as(key)
      const r = await getTasks('')
      expect(r.status).toBe(400)
      expect(r.body.tasks).toBeUndefined()
    }
  })
  test('my_work=true without order_id → 400, not a cross-order list', async () => {
    as('REP1')
    const r = await getTasks('my_work=true')
    expect(r.status).toBe(400)
    expect(r.body.tasks).toBeUndefined()
    const r2 = await getTasks(`assignee_id=${ID.REP1}`)
    expect(r2.status).toBe(400)
  })
  test('missing order → 404', async () => {
    as('PM')
    expect((await getTasks('order_id=50000000-0000-4000-8000-0000000000ff')).status).toBe(404)
    expect((await getUpdates('order_id=50000000-0000-4000-8000-0000000000ff')).status).toBe(404)
  })
})

describe('3–4. metal_rep scoped to their order', () => {
  test('REP3 (not on O1) → 403 on tasks and updates; no internal notes leak', async () => {
    as('REP3')
    const t = await getTasks(`order_id=${ID.O1}`)
    expect(t.status).toBe(403)
    expect(t.body.error).toBe('You are not on this order.')
    expect(t.body.tasks).toBeUndefined()
    const u = await getUpdates(`order_id=${ID.O1}`)
    expect(u.status).toBe(403)
    expect(u.body.updates).toBeUndefined()
  })
  test('REP1 (salesperson on O1) → 200, only O1 rows', async () => {
    as('REP1')
    const t = await getTasks(`order_id=${ID.O1}`)
    expect(t.status).toBe(200)
    expect(t.body.tasks.map(x => x.id).sort()).toEqual([T1, T3].sort())
    const mine = await getTasks(`order_id=${ID.O1}&my_work=true`)
    expect(mine.body.tasks.map(x => x.id)).toEqual([T1]) // T2 is assigned to REP1 but on O2
    const u = await getUpdates(`order_id=${ID.O1}`)
    expect(u.status).toBe(200)
    expect(u.body.updates.map(x => x.id).sort()).toEqual([U1, U2].sort())
  })
})

describe('5. roofing_rep', () => {
  test('MB order O1 → 403 on GET and POST', async () => {
    as('ROOF')
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'x' })).status).toBe(403)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(403)
    expect(writes('sales_order_tasks')).toHaveLength(0)
    expect(writes('sales_order_updates')).toHaveLength(0)
  })
  test('roofing order R1 → GET/create 200', async () => {
    as('ROOF')
    const t = await getTasks(`order_id=${ID.R1}`)
    expect(t.status).toBe(200)
    expect(t.body.tasks.map(x => x.id)).toEqual([TR])
    const u = await getUpdates(`order_id=${ID.R1}`)
    expect(u.status).toBe(200)
    expect(u.body.updates.map(x => x.id)).toEqual([UR])
    const c = await postTasks({ action: 'create', order_id: ID.R1, title: 'Roof thing' })
    expect(c.status).toBe(200)
    expect(task(c.body.id)).toMatchObject({ order_id: ID.R1, order_number: 'RF-2026-001', created_by: ID.ROOF, created_by_name: 'ROOF Person' })
    expect((await postUpdates({ action: 'create', order_id: ID.R1, body: 'Roof update' })).status).toBe(200)
  })
})

describe('6. office', () => {
  test.each(['PM', 'OWNER'])('%s can GET/create on O1 without being the salesperson', async key => {
    as(key)
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(200)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(200)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'Office task' })).status).toBe(200)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'Office note' })).status).toBe(200)
  })
})

describe('7. attribution', () => {
  test('REP2 without attribution → 403', async () => {
    as('REP2')
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'x' })).status).toBe(403)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(403)
  })
  test('REP2 with attribution on O1 → 200', async () => {
    mockState.db.sales_attribution.push({ order_id: ID.O1, salesperson_id: ID.REP2 })
    as('REP2')
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(200)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(200)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'x' })).status).toBe(200)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(200)
  })
})

describe('8–9. names come from the profile, not the body', () => {
  test('update author_name and history actor_name ignore a forged author_name', async () => {
    as('REP1')
    const r = await postUpdates({ action: 'create', order_id: ID.O1, body: 'Hi', visible_to_customer: true, author_name: 'Forged Customer' })
    expect(r.status).toBe(200)
    const row = mockState.db.sales_order_updates.find(u => u.id === r.body.id)
    expect(row).toMatchObject({ author_id: ID.REP1, author_name: 'REP1 Person', visible_to_customer: true, update_type: 'note', order_id: ID.O1 })
    const h = mockState.db.sales_order_history.filter(x => x.details?.update_id === r.body.id)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ actor_id: ID.REP1, actor_name: 'REP1 Person', action: 'customer_update_posted' })
    expect(JSON.stringify(mockState.db)).not.toContain('Forged Customer')
  })
  test('task created_by_name and history actor_name ignore a forged actor_name', async () => {
    as('REP1')
    const r = await postTasks({ action: 'create', order_id: ID.O1, title: 'New', actor_name: 'Forged', assignee_id: ID.PM, assignee_name: 'PM Person' })
    expect(r.status).toBe(200)
    expect(task(r.body.id)).toMatchObject({ created_by: ID.REP1, created_by_name: 'REP1 Person', order_number: 'MB-2026-001', status: 'open' })
    const h = mockState.db.sales_order_history.filter(x => x.details?.task_id === r.body.id)
    expect(h[0]).toMatchObject({ action: 'task_created', actor_name: 'REP1 Person' })
    expect(JSON.stringify(mockState.db)).not.toContain('Forged')
    expect(mockNotified).toHaveLength(1)
    expect(mockNotified[0]).toMatchObject({ recipient_id: ID.PM, entity_id: ID.O1 })
  })
  test('task completion history uses the profile name', async () => {
    as('REP1')
    expect((await postTasks({ action: 'update', id: T1, fields: { status: 'done' }, actor_name: 'Forged' })).status).toBe(200)
    const h = mockState.db.sales_order_history.find(x => x.action === 'task_completed')
    expect(h).toMatchObject({ order_id: ID.O1, actor_name: 'REP1 Person' })
  })
})

describe('10–11. task update', () => {
  test('REP3 updating an O1 task → 403, row unchanged', async () => {
    as('REP3')
    const before = { ...task(T1) }
    const r = await postTasks({ action: 'update', id: T1, fields: { title: 'hijack', status: 'done' } })
    expect(r.status).toBe(403)
    expect(task(T1)).toEqual(before)
    expect(writes('sales_order_tasks')).toHaveLength(0)
  })
  test('extra fields are dropped; server sets completed_at / updated_at', async () => {
    as('REP1')
    const r = await postTasks({ action: 'update', id: T1, fields: { status: 'done', created_by: ID.REP3, order_id: ID.O2, order_number: 'HACK', completed_at: '1999-01-01', created_by_name: 'X', id: 'other', created_at: '1999-01-01' } })
    expect(r.status).toBe(200)
    const t = task(T1)
    expect(t).toMatchObject({ status: 'done', created_by: ID.REP1, order_id: ID.O1, order_number: 'MB-2026-001', created_by_name: 'REP1 Person', created_at: '2026-11-01T00:00:00Z' })
    expect(t.completed_at).not.toBe('1999-01-01')
    expect(typeof t.updated_at).toBe('string')
    const payload = writes('sales_order_tasks')[0].payload
    expect(Object.keys(payload).sort()).toEqual(['completed_at', 'status', 'updated_at'])
  })
  test('allow-listed fields update', async () => {
    as('REP1')
    const fields = { title: 'T', description: 'D', assignee_id: ID.PM, assignee_name: 'PM Person', due_date: '2026-12-01', priority: 'high', status: 'in_progress' }
    expect((await postTasks({ action: 'update', id: T1, fields })).status).toBe(200)
    expect(task(T1)).toMatchObject(fields)
    expect(task(T1).completed_at).toBeUndefined()
  })
  test('fields missing or not an object → 400', async () => {
    as('REP1')
    expect((await postTasks({ action: 'update', id: T1 })).status).toBe(400)
    expect((await postTasks({ action: 'update', id: T1, fields: ['status'] })).status).toBe(400)
    expect((await postTasks({ action: 'update', id: T1, fields: 'done' })).status).toBe(400)
    expect(writes('sales_order_tasks')).toHaveLength(0)
  })
})

describe('12. task delete', () => {
  test('metal_rep on the order who did not create the task → 403, row remains', async () => {
    as('REP1')
    const r = await postTasks({ action: 'delete', id: T3 })
    expect(r.status).toBe(403)
    expect(task(T3)).toBeDefined()
  })
  test('metal_rep deleting their own task → 200', async () => {
    as('REP1')
    expect((await postTasks({ action: 'delete', id: T1 })).status).toBe(200)
    expect(task(T1)).toBeUndefined()
  })
  test('REP3: O1 task (not on order) → 403; own task on O2 → 200', async () => {
    as('REP3')
    expect((await postTasks({ action: 'delete', id: T1 })).status).toBe(403)
    expect(task(T1)).toBeDefined()
    expect((await postTasks({ action: 'delete', id: T2 })).status).toBe(200)
  })
  test('office deleting someone else\'s task on O1 → 200', async () => {
    as('PM')
    expect((await postTasks({ action: 'delete', id: T1 })).status).toBe(200)
    expect(task(T1)).toBeUndefined()
  })
})

describe('13. super', () => {
  test('super POST create/update/delete → 403 on both routes', async () => {
    asSuper()
    for (const order_id of [ID.O1, ID.R1]) {
      expect((await postTasks({ action: 'create', order_id, title: 'x' })).status).toBe(403)
      expect((await postUpdates({ action: 'create', order_id, body: 'x' })).status).toBe(403)
    }
    for (const id of [T1, TR]) {
      expect((await postTasks({ action: 'update', id, fields: { status: 'done' } })).status).toBe(403)
      expect((await postTasks({ action: 'delete', id })).status).toBe(403)
    }
    expect((await postUpdates({ action: 'delete', id: U1 })).status).toBe(403)
    expect((await postUpdates({ action: 'delete', id: UR })).status).toBe(403)
    expect(writes('sales_order_tasks')).toHaveLength(0)
    expect(writes('sales_order_updates')).toHaveLength(0)
    expect(writes('sales_order_history')).toHaveLength(0)
  })
  test('super GET of MB tasks/updates → 403; roofing GET still allowed', async () => {
    asSuper()
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(403)
    expect((await getTasks(`order_id=${ID.R1}`)).status).toBe(200)
    expect((await getUpdates(`order_id=${ID.R1}`)).status).toBe(200)
  })
})

describe('14. attribution read failure fails closed', () => {
  test('MB order → 500 on GET and POST, nothing written', async () => {
    mockState.failSelect.sales_attribution = 'boom'
    as('REP1')
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(500)
    expect((await getUpdates(`order_id=${ID.O1}`)).status).toBe(500)
    expect((await postTasks({ action: 'create', order_id: ID.O1, title: 'x' })).status).toBe(500)
    expect((await postTasks({ action: 'update', id: T1, fields: { status: 'done' } })).status).toBe(500)
    expect((await postTasks({ action: 'delete', id: T1 })).status).toBe(500)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(500)
    as('PM')
    expect((await postUpdates({ action: 'delete', id: U1 })).status).toBe(500)
    expect(writes('sales_order_tasks')).toHaveLength(0)
    expect(writes('sales_order_updates')).toHaveLength(0)
  })
  test('order read failure → 500', async () => {
    mockState.failSelect.sales_orders = 'boom'
    as('PM')
    expect((await getTasks(`order_id=${ID.O1}`)).status).toBe(500)
    expect((await postUpdates({ action: 'create', order_id: ID.O1, body: 'x' })).status).toBe(500)
  })
})

describe('15. missing rows → 404, nothing written', () => {
  const MISSING = 'f0000000-0000-4000-8000-000000000000'
  test('task update/delete', async () => {
    as('PM')
    expect((await postTasks({ action: 'update', id: MISSING, fields: { status: 'done' } })).status).toBe(404)
    expect((await postTasks({ action: 'delete', id: MISSING })).status).toBe(404)
    expect((await postTasks({ action: 'create', order_id: MISSING, title: 'x' })).status).toBe(404)
    expect(writes('sales_order_tasks')).toHaveLength(0)
    expect(writes('sales_order_history')).toHaveLength(0)
  })
  test('update delete / create on missing order', async () => {
    as('PM')
    expect((await postUpdates({ action: 'delete', id: MISSING })).status).toBe(404)
    expect((await postUpdates({ action: 'create', order_id: MISSING, body: 'x' })).status).toBe(404)
    expect(writes('sales_order_updates')).toHaveLength(0)
  })
})

describe('updates delete', () => {
  test('office-only still; office deletes on an order they can work', async () => {
    as('REP1')
    expect((await postUpdates({ action: 'delete', id: U1 })).status).toBe(403)
    as('ROOF')
    expect((await postUpdates({ action: 'delete', id: UR })).status).toBe(403)
    as('ADMIN')
    expect((await postUpdates({ action: 'delete', id: U1 })).status).toBe(200)
    expect(mockState.db.sales_order_updates.find(u => u.id === U1)).toBeUndefined()
  })
})
