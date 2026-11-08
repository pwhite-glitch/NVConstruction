/**
 * Prompt 54d follow-up: remaining leftovers F (deposit sync racing a full refund),
 * B (later payments must heal/surface received-without-snapshot) and G (preflight
 * probes every mb_order_workflow column) through the real /api/sales-orders and
 * /api/signing-requests routes, with DB/storage/auth/Resend mocked. Nothing live,
 * no migration applied.
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

const fs = require('fs')
const path = require('path')
const { ID, seed, as, addForms, jsonReq, getReq, out } = require('./helpers/mb-fixture')
const { WORKFLOW_COLUMNS } = require('../lib/mb-server')
const sales = require('../app/api/sales-orders/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const get = async qs => out(await sales.GET(getReq(`http://x/api/sales-orders?${qs}`)))
const order = (id = ID.O1) => mockState.db.sales_orders.find(o => o.id === id)
const wf = (id = ID.O1) => mockState.db.mb_order_workflow.find(w => w.order_id === id)
const orderWrites = id => mockState.calls.filter(c => c.table === 'sales_orders' && c.op === 'update' && (c.ids || []).includes(id))
const netDeposits = () => mockState.db.sales_order_payments.reduce((s, p) => s + (p.payment_type === 'deposit' ? p.amount : p.payment_type === 'refund' ? -p.amount : 0), 0)

beforeEach(() => seed())

// ── F ────────────────────────────────────────────────────────────────────────
describe('F. a deposit sync paused before its receipt flip cannot outlive a completed refund', () => {
  test('deposit decides "received", full refund completes, deposit resumes → not received, no snapshot, no deposit commission', async () => {
    as('PM')
    let refund = null
    mockState.pauseWrite = async (table, op, payload) => {
      // The deposit request has inserted its payment, loaded deposit-only payments and
      // decided to mark received; pause it right before the receipt flip.
      if (!refund && table === 'sales_orders' && op === 'update' && payload?.deposit_received === true) {
        expect(order().deposit_received).toBe(false)
        refund = await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
      }
    }
    const dep = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    mockState.pauseWrite = null
    expect(refund).not.toBeNull()
    // The refund ran to completion while the receipt was still false.
    expect(refund.status).toBe(200)
    expect(refund.body.deposit_received).toBe(false)
    // The deposit resumed, but the final state follows the payments as they are now.
    expect(netDeposits()).toBe(0)
    expect(dep.status).toBe(200)
    expect(dep.body.deposit_received).toBe(false)
    expect(order()).toMatchObject({ deposit_received: false, deposit_received_date: null })
    expect(wf()?.deposit_received_amount ?? null).toBeNull()
    expect(wf()?.deposit_received_amount_at ?? null).toBeNull()
    as('OWNER')
    const c = (await get(`id=${ID.O1}`)).body.data.mb.commission
    expect(c.deposit_leg_cents).toBe(0)
    expect(c.flags).toContain('deposit_not_received')
    expect((await get('mb=commission_report')).body.rows.find(x => x.order_id === ID.O1).deposit_leg_cents).toBe(0)
  })

  test('without a race, a full deposit is still marked received with its snapshot', async () => {
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(true)
    expect(order().deposit_received).toBe(true)
    expect(wf()).toMatchObject({ deposit_receipt_source: 'payments', deposit_received_amount: 10000 })
  })
})

// ── B ────────────────────────────────────────────────────────────────────────
describe('B. later payments never treat received-without-snapshot as healthy', () => {
  const receivedNoSnapshot = () => { Object.assign(order(), { deposit_received: true, deposit_received_date: '2026-11-03', payment_status: 'deposit_received' }) }

  test.each(['progress', 'deposit'])('a later %s payment heals the missing snapshot from the locked, valid amount', async type => {
    receivedNoSnapshot(); as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: type, amount: 10000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(true)
    expect(order().deposit_received).toBe(true)
    expect(wf()).toMatchObject({ deposit_received_amount: 10000 })
  })

  test.each(['progress', 'deposit'])('a later %s payment with no valid amount to heal from → 409, not success', async type => {
    receivedNoSnapshot(); order().deposit_amount = null; as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: type, amount: 5000 })
    expect(r.status).toBe(409)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.error).toMatch(/no recorded received amount/)
    expect(wf()?.deposit_received_amount ?? null).toBeNull()
  })

  test('a later payment whose snapshot write fails → 500, not success', async () => {
    receivedNoSnapshot(); as('PM')
    mockState.failWrite.mb_order_workflow = { insert: 'workflow write failed' }
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 5000 })
    expect(r.status).toBe(500)
    expect(r.body.ok).toBeUndefined()
    expect(r.body.error).toMatch(/received amount could not be recorded/)
  })

  test('a received order WITH its snapshot is left as is (no rewrite of the snapshot)', async () => {
    receivedNoSnapshot()
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_receipt_source: 'checkbox', deposit_received_amount: 10000, deposit_received_amount_at: '2026-11-03T12:00:00Z' })
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 5000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(true)
    expect(wf()).toMatchObject({ deposit_received_amount: 10000, deposit_received_amount_at: '2026-11-03T12:00:00Z' })
  })
})

// ── G ────────────────────────────────────────────────────────────────────────
describe('G. the preflight probes every mb_order_workflow column from migration 050', () => {
  test('WORKFLOW_COLUMNS matches the 050 CREATE TABLE column list exactly', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/050_metal_building_order_workflow.sql'), 'utf8')
    const body = sql.match(/CREATE TABLE IF NOT EXISTS public\.mb_order_workflow \(([\s\S]*?)\n\);/)[1]
    const cols = body.split('\n').map(l => l.replace(/--.*$/, '').trim()).filter(Boolean).map(l => l.split(/\s+/)[0])
    expect([...WORKFLOW_COLUMNS].sort()).toEqual([...cols].sort())
  })

  test('missing deposit_email_to: token POST → 503, signature stays pending, nothing written', async () => {
    await addForms(); as('REP1')
    expect((await post({ action: 'mb_send_for_signature', id: ID.O1 })).status).toBe(200)
    const row = mockState.db.signing_requests[0]
    mockState.missingSelectCols.mb_order_workflow = ['deposit_email_to']
    mockState.missingCols.mb_order_workflow = ['deposit_email_to']
    mockState.auth = null
    const before = mockState.calls.length
    const r = await out(await tokenRoute.POST(jsonReq('http://x', 'POST', { signature_text: 'Jane Doe' }), { params: { token: row.token } }))
    expect(r.status).toBe(503)
    expect(row.status).toBe('pending')
    expect(mockState.send).not.toHaveBeenCalled()
    expect(mockState.calls.slice(before).filter(c => c.op !== 'select')).toHaveLength(0)
  })

  test('missing deposit_receipt_marked_by: checkbox and payment → 503 before any receipt/payment write', async () => {
    mockState.missingSelectCols.mb_order_workflow = ['deposit_receipt_marked_by']
    mockState.missingCols.mb_order_workflow = ['deposit_receipt_marked_by']
    as('PM')
    const cb = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(cb.status).toBe(503)
    expect(cb.body.error).toMatch(/migration 050/)
    const pay = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(pay.status).toBe(503)
    expect(mockState.db.sales_order_payments).toHaveLength(0)
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
    expect(orderWrites(ID.O1)).toHaveLength(0)
    expect(wf()).toBeUndefined()
  })

  test.each(['deposit_email_provider_id', 'deposit_receipt_marked_by_name', 'supplier_turned_in_doc_id', 'signing_request_id'])('missing %s also fails closed (retry / turn-in / convert_lead)', async col => {
    await addForms()
    mockState.db.signing_requests.push({ id: 'sr1', status: 'signed', sales_order_id: ID.O1, signed_doc_id: 'd' })
    mockState.db.metal_building_leads = [{ id: 'mbl1', stage: 'qualified', contact_name: 'Lead Guy', contact_email: 'lead@example.com', estimate_value: 40000, assigned_to: ID.REP1, deposit_amount: 8000, deposit_received: true }]
    mockState.missingSelectCols.mb_order_workflow = [col]
    as('PM')
    expect((await post({ action: 'mb_retry_completion', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: {} })).status).toBe(503)
    expect((await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })).status).toBe(503)
    expect(mockState.db.sales_orders.filter(o => o.source_lead_id === 'mbl1')).toHaveLength(0)
    expect(mockState.calls.filter(c => c.op !== 'select' && c.table !== 'sales_stage_gate_log')).toHaveLength(0)
  })
})
