/**
 * Prompt 54c follow-up: remaining leftovers F (concurrent refund), B (receipt without
 * snapshot) and G (column-level schema preflight, convert_lead) through the real
 * /api/sales-orders and /api/signing-requests routes, with DB/storage/auth/Resend
 * mocked. Nothing live, no migration applied.
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
jest.mock('resend', () => ({ Resend: function () { return { emails: { send: (...a) => require('./helpers/mock-db').mockState.send(...a) } } } }))
jest.mock('../lib/sub-access', () => ({ canAccessSubcontract: async () => true, getSubContracts: async () => [] }))

const { ID, seed, as, addForms, jsonReq, getReq, out } = require('./helpers/mb-fixture')
const sales = require('../app/api/sales-orders/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const get = async qs => out(await sales.GET(getReq(`http://x/api/sales-orders?${qs}`)))
const order = (id = ID.O1) => mockState.db.sales_orders.find(o => o.id === id)
const wf = (id = ID.O1) => mockState.db.mb_order_workflow.find(w => w.order_id === id)
const orderWrites = id => mockState.calls.filter(c => c.table === 'sales_orders' && c.op === 'update' && (c.ids || []).includes(id))

beforeEach(() => seed())

// ── F ────────────────────────────────────────────────────────────────────────
describe('F. a refund racing a concurrent deposit still clears the receipt', () => {
  test('refund loads receipt=false, deposit completes (receipt + $10k snapshot), refund inserts → cleared', async () => {
    as('PM')
    let fired = false
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_order_payments' && op === 'insert' && !fired) {
        fired = true
        // The concurrent full deposit completes between the refund's order read and its insert.
        mockState.db.sales_order_payments.push({ id: 'dep-race', order_id: ID.O1, payment_type: 'deposit', amount: 10000, payment_date: '2026-11-04' })
        Object.assign(order(), { deposit_received: true, deposit_received_date: '2026-11-04', payment_status: 'deposit_received' })
        mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_receipt_source: 'payments', deposit_received_amount: 10000, deposit_received_amount_at: '2026-11-04T12:00:00Z' })
      }
    }
    expect(order().deposit_received).toBe(false) // what the refund request sees first
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
    expect(fired).toBe(true)
    expect(r.status).toBe(200)
    expect(order()).toMatchObject({ deposit_received: false, deposit_received_date: null })
    expect(r.body.deposit_received).toBe(order().deposit_received)
    expect(wf()).toMatchObject({ deposit_received_amount: null, deposit_received_amount_at: null })
    expect(mockState.db.sales_order_history.some(h => h.action === 'deposit_receipt_cleared')).toBe(true)
    as('OWNER')
    const c = (await get(`id=${ID.O1}`)).body.data.mb.commission
    expect(c.deposit_leg_cents).toBe(0)
    expect(c.flags).toContain('deposit_not_received')
    expect((await get('mb=commission_report')).body.rows.find(x => x.order_id === ID.O1).deposit_leg_cents).toBe(0)
  })
  test('a deposit racing another deposit: response matches the stored flag and a snapshot exists', async () => {
    as('PM')
    let fired = false
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_order_payments' && op === 'insert' && !fired) {
        fired = true
        // A concurrent checkbox receipt lands first (with its snapshot).
        Object.assign(order(), { deposit_received: true, payment_status: 'deposit_received' })
        mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_receipt_source: 'checkbox', deposit_received_amount: 10000 })
      }
    }
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(true)
    expect(order().deposit_received).toBe(true)
    expect(wf()).toMatchObject({ deposit_receipt_source: 'checkbox', deposit_received_amount: 10000 })
  })
})

// ── B ────────────────────────────────────────────────────────────────────────
describe('B. a deposit receipt never stands without its snapshot', () => {
  test('concurrent deposit_amount=0 after validation cannot win the flip: error, not received, no snapshot', async () => {
    as('PM')
    let fired = false
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_orders' && op === 'update' && !fired) { fired = true; order().deposit_amount = 0 }
    }
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(fired).toBe(true)
    expect(r.status).toBe(409)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.already).toBeUndefined()
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
    expect(wf()?.deposit_received_amount ?? null).toBeNull()
  })
  test('snapshot write fails AND the rollback fails → 500, never ok/already', async () => {
    as('PM')
    mockState.failWrite.mb_order_workflow = { insert: 'workflow write failed' }
    // The compensating sales_orders rollback (deposit_received → false) also fails.
    mockState.failWrite.sales_orders = (op, payload) => (op === 'update' && payload.deposit_received === false ? 'rollback failed' : null)
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(r.status).toBe(500)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.already).toBeUndefined()
    expect(r.body.error).toMatch(/Rolling the receipt back also failed/)
    expect(order().deposit_received).toBe(true) // the inconsistent state the 500 reports
    expect(wf()).toBeUndefined()
    // A later caller does not treat received-without-snapshot as healthy: it heals from
    // the locked, still-valid amount.
    mockState.failWrite = {}
    const again = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(again.status).toBe(200)
    expect(again.body.already).toBe(true)
    expect(wf()).toMatchObject({ deposit_received_amount: 10000 })
  })
  test('snapshot write fails, rollback succeeds → 500 and receipt reverted', async () => {
    as('PM')
    mockState.failWrite.mb_order_workflow = { insert: 'workflow write failed' }
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(r.status).toBe(500)
    expect(r.body.error).not.toMatch(/Rolling the receipt back also failed/)
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
  })
  test('received without a snapshot: healed from a valid amount; surfaced (409) when the live amount is invalid', async () => {
    Object.assign(order(), { deposit_received: true })
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_receipt_source: 'checkbox', deposit_received_amount: null })
    as('PM')
    // The request loads a valid amount, but the live row has none by the time it checks the receipt.
    let reads = 0
    Object.defineProperty(order(), 'deposit_amount', { configurable: true, enumerable: true, get: () => (++reads === 1 ? 10000 : null) })
    const bad = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(bad.status).toBe(409)
    expect(bad.body.already).toBeUndefined()
    expect(bad.body.error).toMatch(/no recorded received amount/)
    expect(wf().deposit_received_amount).toBeNull()
    // With a valid (locked) amount the same call heals the snapshot.
    Object.defineProperty(order(), 'deposit_amount', { configurable: true, enumerable: true, writable: true, value: 10000 })
    const ok = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(ok.status).toBe(200)
    expect(ok.body.already).toBe(true)
    expect(wf().deposit_received_amount).toBe(10000)
  })
})

// ── G ────────────────────────────────────────────────────────────────────────
describe('G. column-level schema preflight and convert_lead fail closed', () => {
  test('missing deposit_email_first_attempt_at: signing returns 503 and the signature is NOT claimed', async () => {
    await addForms(); as('REP1')
    expect((await post({ action: 'mb_send_for_signature', id: ID.O1 })).status).toBe(200)
    const row = mockState.db.signing_requests[0]
    mockState.missingSelectCols.mb_order_workflow = ['deposit_email_first_attempt_at']
    mockState.missingCols.mb_order_workflow = ['deposit_email_first_attempt_at']
    mockState.auth = null
    const before = mockState.calls.length
    const r = await out(await tokenRoute.POST(jsonReq('http://x', 'POST', { signature_text: 'Jane Doe' }), { params: { token: row.token } }))
    expect(r.status).toBe(503)
    expect(row.status).toBe('pending')
    expect(mockState.send).not.toHaveBeenCalled()
    expect(mockState.calls.slice(before).filter(c => c.op !== 'select')).toHaveLength(0)
  })
  test('missing deposit_received_amount: record_payment → 503 before the payment or receipt is written', async () => {
    mockState.missingSelectCols.mb_order_workflow = ['deposit_received_amount']
    mockState.missingCols.mb_order_workflow = ['deposit_received_amount']
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 050/)
    expect(mockState.db.sales_order_payments).toHaveLength(0)
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
    expect(orderWrites(ID.O1)).toHaveLength(0)
    // checkbox receipt fails closed the same way
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true })).status).toBe(503)
    expect(orderWrites(ID.O1)).toHaveLength(0)
  })
  test('missing deposit_received_amount_at blocks retry / turn-in / send-for-sign / supplier actions too', async () => {
    await addForms()
    mockState.db.signing_requests.push({ id: 'sr1', status: 'signed', sales_order_id: ID.O1, signed_doc_id: 'd' })
    mockState.missingSelectCols.mb_order_workflow = ['deposit_received_amount_at']
    as('PM')
    expect((await post({ action: 'mb_retry_completion', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: {} })).status).toBe(503)
    mockState.db.signing_requests = []
    expect((await post({ action: 'mb_send_for_signature', id: ID.O1 })).status).toBe(503)
    expect(mockState.calls.filter(c => c.op !== 'select' && c.table !== 'sales_stage_gate_log')).toHaveLength(0)
  })

  const lead = extra => { mockState.db.metal_building_leads = [{ id: 'mbl1', stage: 'qualified', contact_name: 'Lead Guy', contact_email: 'lead@example.com', estimate_value: 40000, assigned_to: ID.REP1, deposit_amount: 8000, deposit_received: true, ...extra }] }
  const newOrders = () => mockState.db.sales_orders.filter(o => o.source_lead_id === 'mbl1')

  test('office convert_lead with a received MB lead and the workflow table missing → 503, no order inserted', async () => {
    lead(); mockState.failSelect.mb_order_workflow = 'relation "public.mb_order_workflow" does not exist'
    as('PM')
    const r = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 050/)
    expect(newOrders()).toHaveLength(0)
  })
  test('office convert_lead with a required column missing → 503, no order inserted', async () => {
    lead(); mockState.missingSelectCols.mb_order_workflow = ['deposit_received_amount']
    as('PM')
    expect((await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })).status).toBe(503)
    expect(newOrders()).toHaveLength(0)
  })
  test('office convert_lead with schema present: received order carries its snapshot in the same request', async () => {
    lead(); as('PM')
    const r = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(r.status).toBe(200)
    expect(r.body.stage).toBe('quoted')
    expect(order(r.body.id)).toMatchObject({ deposit_received: true, deposit_amount: 8000, stage: 'quoted' })
    expect(wf(r.body.id)).toMatchObject({ deposit_received_amount: 8000, deposit_receipt_source: 'checkbox', deposit_receipt_marked_by: ID.PM })
  })
  test('office convert_lead: snapshot write fails → no received order left behind', async () => {
    lead(); as('PM')
    mockState.failWrite.mb_order_workflow = { insert: 'workflow write failed' }
    const r = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(r.status).toBe(500)
    expect(newOrders().filter(o => o.deposit_received === true)).toHaveLength(0)
    expect(newOrders()).toHaveLength(0) // the half-made order is removed
  })
  test('office convert_lead: received lead without a valid amount → order created NOT received, with a warning', async () => {
    lead({ deposit_amount: null }); as('PM')
    const r = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toMatch(/not carried over/)
    expect(order(r.body.id).deposit_received).toBe(false)
  })
  test('rep convert_lead never carries the receipt and needs no workflow schema', async () => {
    lead(); mockState.failSelect.mb_order_workflow = 'relation "public.mb_order_workflow" does not exist'
    as('REP1')
    const r = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(r.status).toBe(200)
    expect(order(r.body.id).deposit_received).toBe(false)
  })
})
