/**
 * Prompt 75 — PO editing for commercial + residential (in-memory DB, mocked auth/storage).
 *  - PUT on a CLOSED PO: only a status change is allowed (409 for any other column,
 *    items (even []), or a new attachment; nothing written).
 *  - DELETE: draft only (409 otherwise, row kept).
 *  - change_log rows (entity_type 'purchase_order') for vendor_name / payment_type /
 *    budget_item_id / amount / status / line_items; no no-op rows.
 *  - Confirm helpers (lib/po-edit-guards) and UI/source wiring on both job pages.
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
jest.mock('../lib/central-date', () => ({ ...jest.requireActual('../lib/central-date'), todayCentral: () => '2026-11-10' }))

const po = require('../app/api/purchase-orders/route')
const { poEditConfirmMessages, confirmPOEdit, editFormAmount, editFormFromPO, RECEIVED_EDIT_WARNING, CLOSED_LOCKED_MESSAGE, PO_DRAW_AMOUNT_WARNING } = require('../lib/po-edit-guards')

const J1 = 'job-1'
const req = (method, body) => new Request('http://x/api/purchase-orders', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const as = (role, extra = {}) => { mockState.auth = { userId: `u-${role}`, email: `${role}@nv.com`, role, error: null, ...extra } }
const json = async r => ({ status: r.status, body: await r.json() })
const writes = () => mockState.calls.filter(c => ['update', 'insert', 'delete', 'upload'].includes(c.op))
const logs = () => mockState.db.change_log || []
const row = id => mockState.db.purchase_orders.find(p => p.id === id)

const base = { job_id: J1, vendor_name: 'Acme', payment_type: 'check', budget_item_id: 'b1', amount: 100, notes: 'n', description: 'd', attachment_url: `${J1}/a.pdf`, draw_request_id: null }
function seed() {
  resetMockState({
    jobs: [{ id: J1, job_number: '7469', project_name: 'House', job_type: 'residential' }],
    pm_job_assignments: [],
    profiles: [{ id: 'u-principal', full_name: 'Peyton Owner' }],
    purchase_orders: [
      { ...base, id: 'pD', po_number: 'PO-7469-001', status: 'draft' },
      { ...base, id: 'pI', po_number: 'PO-7469-002', status: 'issued' },
      { ...base, id: 'pR', po_number: 'PO-7469-003', status: 'received' },
      { ...base, id: 'pC', po_number: 'PO-7469-004', status: 'closed' },
    ],
    purchase_order_items: ['pD', 'pI', 'pR', 'pC'].map(pid => ({ id: `${pid}-i1`, po_id: pid, description: 'Lumber', qty: 1, unit: 'ls', unit_price: 100, amount: 100, sort_order: 0 })),
    budget_items: [{ id: 'b1', job_id: J1, cost_code: '01', description: 'Framing' }, { id: 'b2', job_id: J1, cost_code: '02', description: 'Roofing' }],
    draw_requests: [{ id: 'd1', job_id: J1, draw_number: 1, title: 'Draw 1' }],
    change_log: [],
  })
  as('principal')
}
beforeEach(seed)

describe('PUT on a closed PO', () => {
  test.each([
    ['notes', { notes: 'changed' }],
    ['vendor_name', { vendor_name: 'Other' }],
    ['payment_type', { payment_type: 'reimbursement' }],
    ['budget_item_id', { budget_item_id: 'b2' }],
    ['budget_item_id cleared', { budget_item_id: null }],
    ['description', { description: 'x' }],
    ['draw_request_id', { draw_request_id: 'd1' }],
    ['items', { items: [{ description: 'New', qty: 2, unit_price: 5 }] }],
    ['empty items', { items: [] }],
    ['status plus a body edit', { status: 'issued', notes: 'sneak' }],
  ])('%s → 409, nothing written', async (_label, fields) => {
    const before = JSON.parse(JSON.stringify(row('pC')))
    const r = await json(await po.PUT(req('PUT', { id: 'pC', ...fields })))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('This purchase order is closed and cannot be edited.')
    expect(writes()).toEqual([])
    expect(row('pC')).toEqual(before)
    expect(mockState.db.purchase_order_items.filter(i => i.po_id === 'pC')).toHaveLength(1)
    expect(logs()).toEqual([])
  })

  test('new attachment upload → 409, nothing uploaded', async () => {
    const fd = new FormData()
    fd.append('file', new File(['%PDF'], 'q.pdf', { type: 'application/pdf' }))
    fd.append('data', JSON.stringify({ id: 'pC' }))
    const r = await po.PUT(new Request('http://x/api/purchase-orders', { method: 'PUT', body: fd }))
    expect(r.status).toBe(409)
    expect(writes()).toEqual([])
    expect(row('pC').attachment_url).toBe(`${J1}/a.pdf`)
  })

  test('the gate uses the STORED status, not body.status', async () => {
    // Claiming status 'issued' in the same request does not unlock a body edit.
    expect((await po.PUT(req('PUT', { id: 'pC', status: 'draft', vendor_name: 'X' }))).status).toBe(409)
    expect(row('pC').vendor_name).toBe('Acme')
  })

  test('status-only reopen works and is logged (po_number / same job_id ignored)', async () => {
    const r = await json(await po.PUT(req('PUT', { id: 'pC', status: 'issued', po_number: 'HACK', job_id: J1 })))
    expect(r.status).toBe(200)
    expect(row('pC')).toMatchObject({ status: 'issued', issued_date: '2026-11-10', po_number: 'PO-7469-004', vendor_name: 'Acme' })
    expect(logs()).toHaveLength(1)
    expect(logs()[0]).toMatchObject({ job_id: J1, entity_type: 'purchase_order', entity_id: 'pC', field_name: 'status', old_value: 'closed', new_value: 'issued', changed_by: 'u-principal', changed_by_name: 'Peyton Owner' })
  })

  test('status-only closed → received is allowed', async () => {
    expect((await po.PUT(req('PUT', { id: 'pC', status: 'received' }))).status).toBe(200)
    expect(row('pC').status).toBe('received')
  })

  test('status-only closed → closed is a 200 with no change_log row', async () => {
    expect((await po.PUT(req('PUT', { id: 'pC', status: 'closed' }))).status).toBe(200)
    expect(logs()).toEqual([])
  })
})

describe('PUT on draft / issued / received still edits', () => {
  test.each(['pD', 'pI', 'pR'])('%s: body field edit → 200', async id => {
    const r = await po.PUT(req('PUT', { id, notes: 'ok', vendor_name: 'Beta', items: [{ description: 'Nails', qty: 3, unit_price: 10 }] }))
    expect(r.status).toBe(200)
    expect(row(id)).toMatchObject({ notes: 'ok', vendor_name: 'Beta', amount: 30 })
  })

  test('po_number in the body is never written', async () => {
    expect((await po.PUT(req('PUT', { id: 'pI', po_number: 'PO-HACK', notes: 'x' }))).status).toBe(200)
    expect(row('pI').po_number).toBe('PO-7469-002')
  })
})

describe('DELETE is draft only', () => {
  test('draft → 200 and removed', async () => {
    expect((await po.DELETE(req('DELETE', { id: 'pD' }))).status).toBe(200)
    expect(row('pD')).toBeUndefined()
  })
  test.each(['pI', 'pR', 'pC'])('%s → 409, row kept', async id => {
    const r = await json(await po.DELETE(req('DELETE', { id })))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('Only draft purchase orders can be deleted.')
    expect(row(id)).toBeTruthy()
    expect(writes()).toEqual([])
  })
})

describe('change_log', () => {
  const sameLines = [{ description: 'Lumber', qty: 1, unit: 'ls', unit_price: 100 }]

  test('vendor / payment_type / budget line / amount / status / line items each logged once', async () => {
    const r = await po.PUT(req('PUT', {
      id: 'pI', vendor_name: 'Beta', payment_type: 'reimbursement', budget_item_id: 'b2', status: 'received',
      items: [{ description: 'Lumber', qty: 2, unit: 'ls', unit_price: 100 }, { description: 'Nails', qty: 1, unit_price: 5 }],
    }))
    expect(r.status).toBe(200)
    const byField = Object.fromEntries(logs().map(l => [l.field_name, l]))
    expect(Object.keys(byField).sort()).toEqual(['amount', 'budget_item_id', 'line_items', 'payment_type', 'status', 'vendor_name'])
    expect(logs().every(l => l.entity_type === 'purchase_order' && l.entity_id === 'pI' && l.job_id === J1 && l.changed_by === 'u-principal')).toBe(true)
    expect(byField.vendor_name).toMatchObject({ old_value: 'Acme', new_value: 'Beta' })
    expect(byField.payment_type).toMatchObject({ old_value: 'check', new_value: 'reimbursement' })
    expect(byField.budget_item_id).toMatchObject({ old_value: 'b1', new_value: 'b2' })
    expect(byField.status).toMatchObject({ old_value: 'issued', new_value: 'received' })
    expect(byField.amount).toMatchObject({ old_value: '100', new_value: '205' })
    expect(byField.line_items).toMatchObject({ old_value: '1 lines / 100', new_value: '2 lines / 205' })
  })

  test('an identical re-save writes no change_log rows', async () => {
    const r = await po.PUT(req('PUT', { id: 'pI', vendor_name: 'Acme', payment_type: 'check', budget_item_id: 'b1', notes: 'n', description: 'd', items: sameLines }))
    expect(r.status).toBe(200)
    expect(logs()).toEqual([])
  })

  test('same count and total but a different line still gets one line_items row (no amount row)', async () => {
    await po.PUT(req('PUT', { id: 'pI', items: [{ description: 'Plywood', qty: 1, unit: 'ls', unit_price: 100 }] }))
    expect(logs().map(l => l.field_name)).toEqual(['line_items'])
    expect(logs()[0].old_value).not.toBe(logs()[0].new_value)
  })

  test('clearing the budget line is logged as old → null', async () => {
    await po.PUT(req('PUT', { id: 'pR', budget_item_id: null }))
    expect(logs()).toHaveLength(1)
    expect(logs()[0]).toMatchObject({ field_name: 'budget_item_id', old_value: 'b1', new_value: null })
  })

  test('notes / description only edits are not logged', async () => {
    await po.PUT(req('PUT', { id: 'pD', notes: 'new', description: 'new' }))
    expect(logs()).toEqual([])
  })

  test('payment_type not logged when the column is missing (it was not saved)', async () => {
    mockState.missingCols.purchase_orders = ['payment_type']
    const r = await json(await po.PUT(req('PUT', { id: 'pI', payment_type: 'reimbursement', notes: 'kept' })))
    expect(r.body.warning).toBeTruthy()
    expect(logs()).toEqual([])
  })

  test('a failed update writes no change_log', async () => {
    mockState.missingCols.purchase_orders = ['vendor_name']
    expect((await po.PUT(req('PUT', { id: 'pI', vendor_name: 'Z' }))).status).toBe(500)
    expect(logs()).toEqual([])
  })

  test('a change_log insert failure does not fail the PUT', async () => {
    mockState.failWrite = { change_log: { insert: 'nope' } }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await po.PUT(req('PUT', { id: 'pI', vendor_name: 'Z' }))).status).toBe(200)
    expect(row('pI').vendor_name).toBe('Z')
    spy.mockRestore()
  })
})

describe('confirm helpers (lib/po-edit-guards)', () => {
  const poRow = { ...base, id: 'x', status: 'issued', purchase_order_items: [{ description: 'Lumber', qty: 1, unit: 'ls', unit_price: 100 }] }

  test('no changes → no confirms', () => {
    expect(poEditConfirmMessages(poRow, editFormFromPO(poRow))).toEqual([])
    expect(poEditConfirmMessages({ ...poRow, draw_request_id: 'd1' }, editFormFromPO(poRow))).toEqual([])
  })

  test('payment_type flip either way explains the cash outlook', () => {
    const toReimb = poEditConfirmMessages(poRow, { ...editFormFromPO(poRow), payment_type: 'reimbursement' })
    expect(toReimb).toHaveLength(1)
    expect(toReimb[0]).toMatch(/NV pays the vendor/)
    expect(toReimb[0]).toMatch(/cash out/)
    const toCheck = poEditConfirmMessages({ ...poRow, payment_type: 'reimbursement' }, editFormFromPO(poRow))
    expect(toCheck[0]).toMatch(/owner writes the check/)
    // null stored payment_type is treated as 'check' (no false confirm)
    expect(poEditConfirmMessages({ ...poRow, payment_type: null }, editFormFromPO(poRow))).toEqual([])
  })

  test('budget line change, set and clear all confirm committed-cost movement', () => {
    expect(poEditConfirmMessages(poRow, { ...editFormFromPO(poRow), budget_item_id: 'b2' })[0]).toMatch(/committed cost/)
    expect(poEditConfirmMessages(poRow, { ...editFormFromPO(poRow), budget_item_id: '' })[0]).toMatch(/committed cost/)
    expect(poEditConfirmMessages({ ...poRow, budget_item_id: null }, { ...editFormFromPO(poRow), budget_item_id: 'b1' })[0]).toMatch(/committed cost/)
  })

  test('amount change only warns when the PO is on a draw', () => {
    const form = { ...editFormFromPO(poRow), items: [{ description: 'Lumber', qty: '2', unit_price: '100' }] }
    expect(editFormAmount(form)).toBe(200)
    expect(poEditConfirmMessages(poRow, form)).toEqual([])
    expect(poEditConfirmMessages({ ...poRow, draw_request_id: 'd1' }, form)).toEqual([PO_DRAW_AMOUNT_WARNING])
  })

  test('confirmPOEdit stops at the first Cancel', () => {
    const form = { ...editFormFromPO(poRow), payment_type: 'reimbursement', budget_item_id: 'b2' }
    const seen = []
    expect(confirmPOEdit(poRow, form, m => { seen.push(m); return false })).toBe(false)
    expect(seen).toHaveLength(1)
    expect(confirmPOEdit(poRow, form, () => true)).toBe(true)
  })

  test('copy', () => {
    expect(RECEIVED_EDIT_WARNING).toBe('This PO is marked received. Editing it can change committed cost and cash outlook. Edit anyway?')
    expect(CLOSED_LOCKED_MESSAGE).toMatch(/Closed — editing locked/)
  })
})

describe('source wiring', () => {
  const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

  test('residential page has the PO tab, shared forms and authFetch handlers', () => {
    const res = src('app/residentialjobdetail/page.js')
    expect(res).toContain("{ key: 'po', label: 'Purchase Orders'")
    expect(res).toContain("visibleTab === 'po'")
    expect(res).toContain("import NewPOForm from '../jobdetail/NewPOForm'")
    expect(res).toContain("import EditPOForm from '../jobdetail/EditPOForm'")
    expect(res).toContain("import PaymentTypeSelector from '../jobdetail/PaymentTypeSelector'")
    expect(res).toContain("import { authFetch } from '../../lib/client-fetch'")
    expect(res).toMatch(/async function savePOEdit\(\)[\s\S]{0,300}confirmPOEdit\(/)
    expect(res).toMatch(/authFetch\(`\/api\/purchase-orders\?job_id=/)
    for (const k of ['btnSmall:', 'btnSmallOrange:', 'btnSmallGreen:', 'btnSmallRed:']) expect(res).toContain(k)
    // received: Close PO + Edit behind the warning; closed: locked message only
    const recv = res.slice(res.indexOf("{po.status === 'received' && <>"), res.indexOf("{po.status === 'closed' &&"))
    expect(recv).toContain('Close PO')
    expect(recv).toContain('window.confirm(RECEIVED_EDIT_WARNING)')
    expect(res).toContain("{po.status === 'closed' && <span style={{ fontSize: '12px', color: '#6b7280' }}>{CLOSED_LOCKED_MESSAGE}</span>}")
  })

  test('commercial page: received has Close PO and Edit; closed shows lock; save confirms before the PUT', () => {
    const com = src('app/jobdetail/page.js')
    const recv = com.slice(com.indexOf("{po.status === 'received' && <>"), com.indexOf("{po.status === 'closed' &&"))
    expect(recv).toContain('Close PO')
    expect(recv).toContain('>Edit</button>')
    expect(recv.indexOf('window.confirm(RECEIVED_EDIT_WARNING)')).toBeLessThan(recv.indexOf('setEditingPOId(po.id)'))
    expect(com).toContain('{CLOSED_LOCKED_MESSAGE}')
    const save = com.slice(com.indexOf('async function savePOEdit()'), com.indexOf('async function openPOAttachment'))
    expect(save.indexOf('confirmPOEdit(')).toBeGreaterThan(-1)
    expect(save.indexOf('confirmPOEdit(')).toBeLessThan(save.indexOf('authFetch('))
    // existing actions kept
    for (const t of ['Issue PO', 'Mark Received', 'Cancel PO', 'Close PO', '>Delete</button>']) expect(com).toContain(t)
  })

  test('route logs changes and checks closed / draft status', () => {
    const route = src('app/api/purchase-orders/route.js')
    expect(route).toContain("import { logChange } from '../../../lib/change-log'")
    expect(route).toContain("entity_type: 'purchase_order'")
    expect(route).toContain("po.status === 'closed'")
    expect(route).toContain("po.status !== 'draft'")
    // purchase_order stays server-only (not on the browser allow-list)
    expect(src('lib/change-log.js')).not.toMatch(/CLIENT_LOG_ENTITY_TYPES = new Set\([^)]*purchase_order/)
  })

  test('no migration 067 edits and no 071+ migrations', () => {
    const files = fs.readdirSync(path.join(__dirname, '../migrations'))
    expect(files.filter(f => /^07[1-9]/.test(f))).toEqual([])
  })
})
