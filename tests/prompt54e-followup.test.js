/**
 * Prompt 54e follow-up: remaining reconciliation holes, exercised through the real
 * /api/sales-orders route with DB/auth/Resend mocked (nothing live, no migration applied):
 *   F  a received-amount snapshot written after a concurrent refund cleared the receipt
 *      must not survive (deposit marker write, and B-style snapshot heal)
 *   PS an older payment sync must not overwrite a newer "paid" payment_status
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

const { ID, seed, as, jsonReq, getReq, out } = require('./helpers/mb-fixture')
const sales = require('../app/api/sales-orders/route')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const get = async qs => out(await sales.GET(getReq(`http://x/api/sales-orders?${qs}`)))
const order = (id = ID.O1) => mockState.db.sales_orders.find(o => o.id === id)
const wf = (id = ID.O1) => mockState.db.mb_order_workflow.find(w => w.order_id === id)
const netDeposits = () => mockState.db.sales_order_payments.reduce((s, p) => s + (p.payment_type === 'deposit' ? p.amount : p.payment_type === 'refund' ? -p.amount : 0), 0)
const totalPaid = () => mockState.db.sales_order_payments.reduce((s, p) => s + (p.payment_type === 'refund' ? -p.amount : p.amount), 0)

beforeEach(() => seed())

async function expectNotReceivedNoSnapshotNoCommission() {
  expect(netDeposits()).toBe(0)
  expect(order()).toMatchObject({ deposit_received: false, deposit_received_date: null })
  expect(wf()?.deposit_received_amount ?? null).toBeNull()
  expect(wf()?.deposit_received_amount_at ?? null).toBeNull()
  as('OWNER')
  const c = (await get(`id=${ID.O1}`)).body.data.mb.commission
  expect(c.deposit_leg_cents).toBe(0)
  expect(c.flags).toContain('deposit_not_received')
  expect((await get('mb=commission_report')).body.rows.find(x => x.order_id === ID.O1).deposit_leg_cents).toBe(0)
}

describe('F. a snapshot written after a concurrent receipt clear is not left behind', () => {
  test('interleaving 1: deposit wins the flip, full refund completes before the marker/snapshot write, deposit resumes', async () => {
    as('PM')
    let started = false
    let refund = null
    mockState.pauseWrite = async (table, op, payload) => {
      // The deposit request has flipped received=true and is about to insert the
      // workflow marker + snapshot.
      if (!started && table === 'mb_order_workflow' && op === 'insert' && payload?.deposit_receipt_source === 'payments') {
        started = true
        expect(order().deposit_received).toBe(true)
        expect(wf()).toBeUndefined()
        refund = await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
      }
    }
    const dep = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    mockState.pauseWrite = null
    expect(started).toBe(true)
    expect(refund.status).toBe(200)
    expect(refund.body.deposit_received).toBe(false)
    expect(dep.status).toBe(200)
    expect(dep.body.deposit_received).toBe(false)
    await expectNotReceivedNoSnapshotNoCommission()
  })

  test('interleaving 2: snapshot heal decided on a live receipt, full refund completes before the heal insert, heal resumes', async () => {
    as('PM')
    Object.assign(order(), { deposit_received: true, payment_status: 'deposit_received' })
    mockState.db.sales_order_payments.push({ order_id: ID.O1, payment_type: 'deposit', amount: 10000 })
    let started = false
    let refund = null
    mockState.pauseWrite = async (table, op, payload) => {
      // ensureReceiptSnapshot saw received=true with no snapshot and is about to insert one.
      if (!started && table === 'mb_order_workflow' && op === 'insert' && payload?.deposit_received_amount === 10000 && !payload.deposit_receipt_source) {
        started = true
        expect(order().deposit_received).toBe(true)
        refund = await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
      }
    }
    const prog = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 1000 })
    mockState.pauseWrite = null
    expect(started).toBe(true)
    expect(refund.status).toBe(200)
    expect(refund.body.deposit_received).toBe(false)
    expect(prog.status).toBe(200)
    expect(prog.body.deposit_received).toBe(false)
    await expectNotReceivedNoSnapshotNoCommission()
  })

  test('a pre-existing orphan snapshot on a not-received order is removed by the next payment', async () => {
    as('PM')
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_email_attempts: 0, deposit_email_key_gen: 0, deposit_receipt_source: 'payments', deposit_received_amount: 10000, deposit_received_amount_at: '2026-11-01T00:00:00.000Z' })
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 1000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(false)
    expect(wf().deposit_received_amount).toBeNull()
    expect(wf().deposit_received_amount_at).toBeNull()
  })

  test('a healthy received order keeps its snapshot (no regression)', async () => {
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(true)
    expect(wf()).toMatchObject({ deposit_receipt_source: 'payments', deposit_received_amount: 10000 })
    expect(wf().deposit_received_amount_at).toBeTruthy()
  })
})

describe('PS. an older payment sync cannot overwrite a newer paid status', () => {
  test('$1,000 progress paused before its status write, $39,000 progress completes (paid), first resumes → stored and returned paid', async () => {
    as('PM')
    Object.assign(order(), { deposit_received: true, deposit_received_date: '2026-11-01', payment_status: 'deposit_received' })
    mockState.db.sales_order_payments.push({ order_id: ID.O1, payment_type: 'deposit', amount: 10000 })
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_email_attempts: 0, deposit_email_key_gen: 0, deposit_receipt_source: 'payments', deposit_received_amount: 10000, deposit_received_amount_at: '2026-11-01T00:00:00.000Z' })
    let started = false
    let other = null
    mockState.pauseWrite = async (table, op, payload) => {
      // The $1,000 sync computed deposit_received and is about to write it.
      if (!started && table === 'sales_orders' && op === 'update' && payload?.payment_status === 'deposit_received' && !('deposit_received' in payload)) {
        started = true
        other = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 39000 })
        expect(order().payment_status).toBe('paid')
      }
    }
    const first = await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 1000 })
    mockState.pauseWrite = null
    expect(started).toBe(true)
    expect(totalPaid()).toBe(50000)
    expect(other.status).toBe(200)
    expect(other.body.new_payment_status).toBe('paid')
    expect(first.status).toBe(200)
    expect(first.body.new_payment_status).toBe('paid')
    expect(order().payment_status).toBe('paid')
    expect(order().deposit_received).toBe(true)
    expect(wf().deposit_received_amount).toBe(10000)
  })
})
