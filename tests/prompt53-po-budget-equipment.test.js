/**
 * Prompt 53 items 1, 4, 6 (in-memory DB, mocked auth/storage, nothing real written):
 *  1. /api/purchase-orders: denyUnlessOnJob everywhere (assigned/unassigned super, PM/APM,
 *     Owner/admin), unscoped list Owner/admin only, attachment signing always resolves the
 *     PO's real job, upload folder comes from the saved PO (not body.job_id), missing PO /
 *     DB errors fail closed.
 *  4. /api/budget-items PUT: allowlist (no job_id/unknown/audit fields), fields shape,
 *     finite money (zero/negative CO credits fine), real-job guard, POST guard, DELETE refs.
 *  6. /api/company-equipment DELETE: principal/pm only, open/ongoing usage refused with a
 *     count, lookup failure refuses, retired rows kept and resolvable, pickers active-only.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')
jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})
jest.mock('../lib/central-date', () => ({ ...jest.requireActual('../lib/central-date'), todayCentral: () => '2026-11-09' }))

const po = require('../app/api/purchase-orders/route')
const budget = require('../app/api/budget-items/route')
const equipment = require('../app/api/company-equipment/route')
const { validateBudgetFields, BUDGET_EDITABLE_FIELDS } = require('../lib/budget-fields')
const { isOpenUse, equipmentLabel, equipmentInUse } = require('../lib/equipment-usage')

const J1 = 'job-1'
const J2 = 'job-2'
const req = (method, url, body) => new Request(`http://x${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null, ...extra } }
const json = async r => ({ status: r.status, body: await r.json() })
const writes = () => mockState.calls.filter(c => ['update', 'insert', 'delete'].includes(c.op))

function seed() {
  resetMockState({
    jobs: [
      { id: J1, job_number: '7469', project_name: 'Braum Conway', pm_email: 'pm@nv.com' },
      { id: J2, job_number: '7470', project_name: 'Other', pm_email: null },
    ],
    // super assigned to J1 only; apm assigned to J1 only
    pm_job_assignments: [{ id: 'a1', job_id: J1, user_id: 'u-super' }, { id: 'a2', job_id: J1, user_id: 'u-apm' }],
    purchase_orders: [
      { id: 'po1', job_id: J1, po_number: 'PO-7469-001', vendor_name: 'Acme', status: 'draft', attachment_url: `${J1}/a.pdf` },
      { id: 'po2', job_id: J2, po_number: 'PO-7470-001', vendor_name: 'Beta', status: 'issued', attachment_url: `${J2}/b.pdf` },
    ],
    purchase_order_items: [],
    budget_items: [
      { id: 'b1', job_id: J1, cost_code: '02', description: 'Site', budget_amount: 1000, owner_amount: 1200 },
      { id: 'b2', job_id: J2, cost_code: '03', description: 'Concrete', budget_amount: 500, owner_amount: 600 },
    ],
    draw_requests: [{ id: 'd1', job_id: J1 }, { id: 'd2', job_id: J2 }],
    company_equipment: [
      { id: 'eq1', name: 'Skid steer', category: 'Earth', active: true },
      { id: 'eq2', name: 'Lull', category: 'Lift', active: true },
      { id: 'eq3', name: 'Old truck', category: null, active: false },
    ],
    lookahead_activities: [],
  })
}
beforeEach(seed)

// ─────────────────────────── 1. Purchase orders ───────────────────────────
describe('1. purchase orders job guards', () => {
  test.each([
    ['principal', 200], ['admin', 200], ['pm', 200], ['apm', 200], ['super', 200],
  ])('%s scoped GET on an assigned (or global) job', async (role, status) => {
    as(role)
    const r = await po.GET(req('GET', `/api/purchase-orders?job_id=${J1}`))
    expect(r.status).toBe(status)
  })

  test.each(['pm', 'apm', 'super'])('%s on an unassigned job is refused (GET, POST, PUT, DELETE)', async role => {
    as(role)
    expect((await po.GET(req('GET', `/api/purchase-orders?job_id=${J2}`))).status).toBe(403)
    expect((await po.POST(req('POST', '/api/purchase-orders', { job_id: J2, vendor_name: 'X' }))).status).toBe(403)
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po2', notes: 'hi' }))).status).toBe(403)
    expect((await po.DELETE(req('DELETE', '/api/purchase-orders', { id: 'po2' }))).status).toBe(403)
    expect(writes()).toEqual([])
    expect(mockState.db.purchase_orders.find(p => p.id === 'po2').notes).toBeUndefined()
  })

  test('assigned super can edit and delete a PO on their job', async () => {
    as('super')
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', notes: 'ok' }))).status).toBe(200)
    expect(mockState.db.purchase_orders.find(p => p.id === 'po1').notes).toBe('ok')
    expect((await po.DELETE(req('DELETE', '/api/purchase-orders', { id: 'po1' }))).status).toBe(200)
    expect(mockState.db.purchase_orders.find(p => p.id === 'po1')).toBeUndefined()
  })

  test('unscoped GET: Owner/admin list all; PM/APM/super get a clear 403', async () => {
    for (const role of ['principal', 'admin']) {
      as(role)
      const { status, body } = await json(await po.GET(req('GET', '/api/purchase-orders')))
      expect(status).toBe(200)
      expect(body.purchase_orders).toHaveLength(2)
    }
    for (const role of ['pm', 'apm', 'super']) {
      as(role)
      const { status, body } = await json(await po.GET(req('GET', '/api/purchase-orders')))
      expect(status).toBe(403)
      expect(body.error).toMatch(/Owner or Admin/)
    }
  })

  test('sign: unknown path refused for every role, even Owner/admin', async () => {
    for (const role of ['principal', 'admin', 'pm', 'super']) {
      as(role)
      const r = await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent('anything/secret.pdf')}`))
      expect(r.status).toBe(404)
    }
  })

  test('sign: resolves the PO and checks its job (super/apm unassigned denied, assigned ok, Owner ok)', async () => {
    as('super')
    expect((await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent(`${J2}/b.pdf`)}`))).status).toBe(403)
    const ok = await json(await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent(`${J1}/a.pdf`)}`)))
    expect(ok.status).toBe(200)
    expect(ok.body.signedUrl).toContain(`${J1}/a.pdf`)
    as('apm')
    expect((await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent(`${J2}/b.pdf`)}`))).status).toBe(403)
    as('principal')
    expect((await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent(`${J2}/b.pdf`)}`))).status).toBe(200)
  })

  test('sign: PO lookup DB error fails closed', async () => {
    as('principal')
    mockState.failSelect.purchase_orders = 'boom'
    const r = await po.GET(req('GET', `/api/purchase-orders?sign=${encodeURIComponent(`${J1}/a.pdf`)}`))
    expect(r.status).toBe(500)
  })

  test('PUT: missing PO is 404, lookup error is 500, nothing written', async () => {
    as('principal')
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'nope', notes: 'x' }))).status).toBe(404)
    expect((await po.DELETE(req('DELETE', '/api/purchase-orders', { id: 'nope' }))).status).toBe(404)
    mockState.failSelect.purchase_orders = 'down'
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', notes: 'x' }))).status).toBe(500)
    expect((await po.DELETE(req('DELETE', '/api/purchase-orders', { id: 'po1' }))).status).toBe(500)
    expect(writes()).toEqual([])
  })

  test('PUT: forged body.job_id cannot choose the upload folder or move the PO', async () => {
    // Prompt 78: the attachment is uploaded directly to Storage; its receipt binds the saved PO and its job.
    const { mintUpload } = require('./helpers/upload-receipt')
    as('super') // assigned to J1 only
    const up = await mintUpload({ target: 'po-attachment', subject: 'u-super', ctx: { job: J1, rec: 'po1' }, name: 'quote.pdf', store: mockState })
    const r = await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', job_id: J1, notes: 'new quote', attachment: up.attachment }))
    expect(r.status).toBe(200)
    const saved = mockState.db.purchase_orders.find(p => p.id === 'po1')
    expect(saved.attachment_url).toBe(up.path)
    expect(saved.attachment_url.startsWith(`${J1}/`)).toBe(true)
    expect(saved.job_id).toBe(J1)

    // A body job_id pointing elsewhere is a reassignment attempt: refused, nothing written.
    as('principal')
    const up2 = await mintUpload({ target: 'po-attachment', subject: 'u-principal', ctx: { job: J2, rec: 'po1' }, name: 'q2.pdf', store: mockState })
    const before = mockState.calls.length
    const r2 = await json(await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', job_id: J2, attachment: up2.attachment })))
    expect(r2.status).toBe(400)
    expect(mockState.calls.length).toBe(before)
    expect(mockState.db.purchase_orders.find(p => p.id === 'po1').job_id).toBe(J1)
    expect(mockState.db.purchase_orders.find(p => p.id === 'po1').attachment_url).toBe(up.path)
  })

  test('PUT/POST: budget line or draw from another job is refused', async () => {
    as('principal')
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', budget_item_id: 'b2' }))).status).toBe(400)
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', draw_request_id: 'd2' }))).status).toBe(400)
    expect((await po.POST(req('POST', '/api/purchase-orders', { job_id: J1, vendor_name: 'X', budget_item_id: 'b2' }))).status).toBe(400)
    expect((await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', budget_item_id: 'b1', draw_request_id: 'd1' }))).status).toBe(200)
  })

  test('PUT: database update error is reported, not success', async () => {
    as('principal')
    mockState.missingCols.purchase_orders = ['notes']
    const r = await json(await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', notes: 'x' })))
    expect(r.status).toBe(500)
  })

  test('payment_type missing-column compatibility still saves the rest with a warning', async () => {
    as('principal')
    mockState.missingCols.purchase_orders = ['payment_type']
    const r = await json(await po.PUT(req('PUT', '/api/purchase-orders', { id: 'po1', payment_type: 'direct', notes: 'kept' })))
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeTruthy()
    expect(mockState.db.purchase_orders.find(p => p.id === 'po1').notes).toBe('kept')
  })

  test('POST: creates on an assigned job with the job number', async () => {
    as('pm')
    const r = await json(await po.POST(req('POST', '/api/purchase-orders', { job_id: J1, vendor_name: 'New', items: [{ description: 'a', qty: 2, unit_price: 5 }] })))
    expect(r.status).toBe(200)
    expect(r.body.purchase_order.po_number).toBe('PO-7469-002')
    expect(r.body.purchase_order.amount).toBe(10)
  })
})

// ─────────────────────────── 4. Budget items ───────────────────────────
describe('4. budget-items PUT allowlist and real-job guard', () => {
  test('allowlist matches the existing edit callers', () => {
    expect(BUDGET_EDITABLE_FIELDS.sort()).toEqual(['budget_amount', 'cost_code', 'description', 'forecast_eac', 'owner_amount', 'roll_into_gc'])
  })

  test.each([
    [{ job_id: J2 }, /moved/],
    [{ id: 'b9' }, /not editable/],
    [{ created_at: 'x' }, /not editable/],
    [{ increment: { budget_amount: 5 } }, /not editable/],
    [{ budget_amount: 5, approved_by: 'me' }, /not editable/],
  ])('rejects %j', async (fields, msg) => {
    as('principal')
    const r = await json(await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields })))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(msg)
    expect(writes()).toEqual([])
    expect(mockState.db.budget_items.find(b => b.id === 'b1').job_id).toBe(J1)
  })

  test.each([[null], [[1, 2]], ['str'], [{}]])('rejects a bad fields value %j', async fields => {
    as('principal')
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields }))).status).toBe(400)
  })

  test.each([
    [{ budget_amount: 'abc' }], [{ budget_amount: null }], [{ owner_amount: '12' }], [{ forecast_eac: 'x' }], [{ roll_into_gc: 'yes' }],
  ])('rejects non-finite / wrong-type value %j', async fields => {
    as('principal')
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields }))).status).toBe(400)
  })

  test('NaN/Infinity rejected by the validator (JSON cannot carry them)', () => {
    expect(validateBudgetFields({ budget_amount: NaN }).error).toBeTruthy()
    expect(validateBudgetFields({ owner_amount: Infinity }).error).toBeTruthy()
  })

  test('zero and negative CO adjustments are valid; owner_amount null clears; partial edit keeps others', async () => {
    as('pm')
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields: { budget_amount: -250, owner_amount: 0 } }))).status).toBe(200)
    let b1 = mockState.db.budget_items.find(b => b.id === 'b1')
    expect(b1).toMatchObject({ budget_amount: -250, owner_amount: 0, description: 'Site', cost_code: '02' })
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields: { description: 'Sitework' } }))).status).toBe(200)
    b1 = mockState.db.budget_items.find(b => b.id === 'b1')
    expect(b1).toMatchObject({ budget_amount: -250, description: 'Sitework' })
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields: { owner_amount: null } }))).status).toBe(200)
    expect(mockState.db.budget_items.find(b => b.id === 'b1').owner_amount).toBeNull()
  })

  test('missing line is 404; lookup error is 500', async () => {
    as('principal')
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'nope', fields: { description: 'x' } }))).status).toBe(404)
    mockState.failSelect.budget_items = 'down'
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields: { description: 'x' } }))).status).toBe(500)
  })

  test('wrong-job / unassigned super and PM/APM denied on PUT, POST and DELETE', async () => {
    for (const role of ['super', 'apm']) {
      as(role)
      expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b2', fields: { description: 'x' } }))).status).toBe(403)
      expect((await budget.POST(req('POST', '/api/budget-items', [{ job_id: J1, budget_amount: 1 }, { job_id: J2, budget_amount: 1 }]))).status).toBe(403)
      expect((await budget.DELETE(req('DELETE', '/api/budget-items', { id: 'b2' }))).status).toBe(403)
      expect((await budget.DELETE(req('DELETE', '/api/budget-items', { job_id: J2 }))).status).toBe(403)
    }
    expect(writes()).toEqual([])
    as('super')
    expect((await budget.PUT(req('PUT', '/api/budget-items', { id: 'b1', fields: { description: 'ok' } }))).status).toBe(200)
  })

  test('POST requires a job on every row and keeps finite-number rules', async () => {
    as('principal')
    expect((await budget.POST(req('POST', '/api/budget-items', [{ budget_amount: 1 }]))).status).toBe(400)
    expect((await budget.POST(req('POST', '/api/budget-items', [{ job_id: J1, budget_amount: 'x' }]))).status).toBe(400)
    expect((await budget.POST(req('POST', '/api/budget-items', [{ job_id: J1 }]))).status).toBe(400)
    expect((await budget.POST(req('POST', '/api/budget-items', []))).status).toBe(400)
    expect((await budget.POST(req('POST', '/api/budget-items', { job_id: J1, budget_amount: -10, description: 'credit' }))).status).toBe(200)
  })

  test('DELETE reference guard still refuses a referenced line', async () => {
    as('principal')
    mockState.db.purchase_orders.push({ id: 'po9', job_id: J1, budget_item_id: 'b1', po_number: 'PO-9' })
    mockState.rpc = {}
    const r = await budget.DELETE(req('DELETE', '/api/budget-items', { id: 'b1' }))
    expect(r.status).toBe(409)
    expect(mockState.db.budget_items.find(b => b.id === 'b1')).toBeTruthy()
  })
})

// ─────────────────────────── 6. Company equipment ───────────────────────────
describe('6. company equipment retirement', () => {
  const act = (id, extra) => ({ id, lookahead_id: 'la1', lookaheads: { job_id: J1 }, company_equipment_ids: ['eq1'], ...extra })

  test.each(['apm', 'super', 'admin'])('%s cannot retire (Owner/PM only)', async role => {
    as(role)
    const r = await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq2' }))
    expect(r.status).toBe(403)
    expect(mockState.db.company_equipment.find(e => e.id === 'eq2').active).toBe(true)
  })

  test.each(['principal', 'pm'])('%s retires unused equipment; the row is kept, not deleted', async role => {
    as(role)
    const r = await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq2' }))
    expect(r.status).toBe(200)
    const row = mockState.db.company_equipment.find(e => e.id === 'eq2')
    expect(row).toBeTruthy()
    expect(row.active).toBe(false)
    expect(mockState.calls.some(c => c.table === 'company_equipment' && c.op === 'delete')).toBe(false)
  })

  test('future, ongoing multi-day, in-progress, delayed and undated/legacy-status use all count', async () => {
    mockState.db.lookahead_activities = [
      act('f', { planned_date: '2026-11-12', status: 'not_started' }),
      act('m', { planned_date: '2026-11-02', end_date: '2026-11-11', status: null }), // ongoing multi-day, legacy null status
      act('p', { planned_date: '2026-10-01', status: 'in_progress' }),
      act('d', { planned_date: '2026-10-05', status: 'delayed' }),
      act('u', { planned_date: null }),
      act('done', { planned_date: '2026-11-20', status: 'done' }),
      act('past', { planned_date: '2026-11-01', status: 'not_started' }),
      act('other', { planned_date: '2026-11-20', company_equipment_ids: ['eq2'] }),
    ]
    as('principal')
    const r = await json(await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq1' })))
    expect(r.status).toBe(409)
    expect(r.body.in_use).toBe(5)
    expect(r.body.jobs.map(j => j.job_number)).toEqual(['7469'])
    expect(mockState.db.company_equipment.find(e => e.id === 'eq1').active).toBe(true)
  })

  test('a PM sees only their jobs in the refusal; other jobs are just counted', async () => {
    mockState.db.lookahead_activities = [
      act('a', { planned_date: '2026-11-12' }),
      act('b', { planned_date: '2026-11-13', lookaheads: { job_id: J2 } }),
    ]
    as('pm', { userId: 'u-pm-x', email: 'pm@nv.com' }) // pm_email on J1 only
    const r = await json(await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq1' })))
    expect(r.status).toBe(409)
    expect(r.body.jobs.map(j => j.id)).toEqual([J1])
    expect(r.body.other_jobs).toBe(1)
    expect(JSON.stringify(r.body)).not.toContain('Other')
  })

  test('usage lookup failure refuses retirement', async () => {
    as('principal')
    mockState.failSelect.lookahead_activities = 'timeout'
    const r = await json(await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq1' })))
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/not retired/)
    expect(mockState.db.company_equipment.find(e => e.id === 'eq1').active).toBe(true)
  })

  test('missing equipment 404; already retired is a no-op', async () => {
    as('pm')
    expect((await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'zzz' }))).status).toBe(404)
    const r = await json(await equipment.DELETE(req('DELETE', '/api/company-equipment', { id: 'eq3' })))
    expect(r.body.already_retired).toBe(true)
    expect(writes()).toEqual([])
  })

  test('GET is active-only by default; include_retired=1 adds retired rows for name resolution', async () => {
    as('super')
    const active = await json(await equipment.GET(req('GET', '/api/company-equipment')))
    expect(active.body.data.map(e => e.id).sort()).toEqual(['eq1', 'eq2'])
    const all = await json(await equipment.GET(req('GET', '/api/company-equipment?include_retired=1')))
    expect(all.body.data.map(e => e.id).sort()).toEqual(['eq1', 'eq2', 'eq3'])
  })

  test('retired names resolve marked Retired; unknown ids are blank (caller labels them)', () => {
    const list = mockState.db.company_equipment
    expect(equipmentLabel(list, 'eq3')).toBe('Old truck (Retired)')
    expect(equipmentLabel(list, 'eq1')).toBe('Skid steer')
    expect(equipmentLabel(list, 'nope')).toBe('')
  })

  test('isOpenUse: done and finished-in-the-past are not open', () => {
    expect(isOpenUse({ company_equipment_ids: ['e'], planned_date: '2026-11-01', status: 'done' }, 'e', '2026-11-09')).toBe(false)
    expect(isOpenUse({ company_equipment_ids: ['e'], planned_date: '2026-11-01', end_date: '2026-11-08' }, 'e', '2026-11-09')).toBe(false)
    expect(isOpenUse({ company_equipment_ids: ['e'], planned_date: '2026-11-01', end_date: '2026-11-09' }, 'e', '2026-11-09')).toBe(true)
    expect(isOpenUse({ company_equipment_ids: ['x'], planned_date: '2026-12-01' }, 'e', '2026-11-09')).toBe(false)
  })

  test('equipmentInUse pages past 1000 rows', async () => {
    const page = n => Array.from({ length: n }, (_, i) => ({ id: `${n}-${i}`, company_equipment_ids: ['e'], planned_date: '2026-12-01', lookaheads: { job_id: J1 } }))
    let call = 0
    const db = { from: () => { const q = { select: () => q, or: () => q, order: () => q, range: () => Promise.resolve({ data: call++ === 0 ? page(3) : page(1), error: null }) }; return q } }
    const r = await equipmentInUse(db, 'e', '2026-11-09', 3)
    expect(r.count).toBe(4)
  })

  // UI wiring: the job page confirms before retiring, gates the button to Owner/PM,
  // feeds pickers active rows only, and resolves badge names from the full list.
  test('job detail UI: confirm, Owner/PM-only button, active-only picker, retired badge names', () => {
    const page = fs.readFileSync(path.join(__dirname, '../app/jobdetail/page.js'), 'utf8')
    const modal = fs.readFileSync(path.join(__dirname, '../app/jobdetail/LookaheadActivityModal.js'), 'utf8')
    expect(page).toMatch(/import \{ equipmentLabel \} from '\.\.\/\.\.\/lib\/equipment-usage'/)
    const del = page.slice(page.indexOf('async function deleteEquipment'), page.indexOf('async function deleteEquipment') + 900)
    expect(del.indexOf('window.confirm')).toBeGreaterThan(-1)
    expect(del.indexOf('window.confirm')).toBeLessThan(del.indexOf("fetch('/api/company-equipment'"))
    expect(page).toMatch(/atLeastPM\(userRole\) && <button onClick=\{\(\) => deleteEquipment/)
    expect(page).toMatch(/companyEquipment=\{activeCompanyEquipment\}/)
    expect(page).toMatch(/equipmentLabel\(companyEquipment, eid\)/)
    expect(page).toMatch(/activeCompanyEquipment\.map\(eq =>/)
    expect(modal).toMatch(/\(Retired\)/)
  })
})
