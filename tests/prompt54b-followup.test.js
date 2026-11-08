/**
 * Prompt 54b follow-up: gaps A–G found after prompt 54, exercised through the real
 * /api/sales-orders and /api/signing-requests routes with DB/storage/auth/Resend
 * mocked. The migration-050 guard triggers are mirrored in tests/helpers/mb-fixture.js.
 * Nothing live, no migration applied.
 */
const { mockState, supabaseModule } = require('./helpers/mock-db')
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

const { ID, seed, as, addForms, jsonReq, getReq, out, pdf } = require('./helpers/mb-fixture')
const sales = require('../app/api/sales-orders/route')
const tokenRoute = require('../app/api/signing-requests/[token]/route')
const { sendDepositEmail, IDEMPOTENCY_WINDOW_MS } = require('../lib/mb-server')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const get = async qs => out(await sales.GET(getReq(`http://x/api/sales-orders?${qs}`)))
const order = (id = ID.O1) => mockState.db.sales_orders.find(o => o.id === id)
const wf = () => mockState.db.mb_order_workflow.find(w => w.order_id === ID.O1)
const snapshot = o => JSON.parse(JSON.stringify(o))
const orderWrites = id => mockState.calls.filter(c => c.table === 'sales_orders' && c.op === 'update' && (c.ids || []).includes(id))

beforeEach(() => seed())

// ── A ────────────────────────────────────────────────────────────────────────
describe('A. a non-MB order cannot be moved into metal buildings', () => {
  const sneaky = { division: 'metal_buildings', deposit_received: true, payment_status: 'paid', stage: 'completed', salesperson_id: ID.REP1, deposit_amount: 1000000 }

  test.each(['REP3', 'REP1', 'PM', 'OWNER', 'ROOF'])('%s: roofing → MB transition with workflow fields is refused; row unchanged', async who => {
    const before = snapshot(order(ID.R1))
    as(who)
    const r = await post({ action: 'update', id: ID.R1, fields: sneaky })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/cannot be moved into Metal Buildings/)
    expect(order(ID.R1)).toEqual(before)
    expect(orderWrites(ID.R1)).toHaveLength(0)
  })
  test('spelling variants of the division are refused too', async () => {
    as('PM')
    for (const division of [' metal_buildings ', 'METAL_BUILDINGS']) {
      expect((await post({ action: 'update', id: ID.R1, fields: { division, deposit_received: true } })).status).toBe(403)
    }
    expect(order(ID.R1)).toMatchObject({ division: 'commercial_roofing', deposit_received: false })
  })
  test('ordinary roofing saves are unchanged (incl. unchanged division and legacy fields)', async () => {
    as('ROOF')
    expect((await post({ action: 'update', id: ID.R1, fields: { customer_phone: '555', division: 'commercial_roofing' } })).status).toBe(200)
    as('PM')
    expect((await post({ action: 'update', id: ID.R1, fields: { roof_type: 'TPO', deposit_received: true, payment_status: 'deposit_received' } })).status).toBe(200)
    expect(order(ID.R1)).toMatchObject({ customer_phone: '555', roof_type: 'TPO', deposit_received: true, division: 'commercial_roofing' })
  })
})

// ── B ────────────────────────────────────────────────────────────────────────
describe('B. received deposit amount is fixed; commission uses the received snapshot', () => {
  test('after the checkbox receipt nobody can change deposit_amount; commission stays on the received amount', async () => {
    as('PM')
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true, received_date: '2026-11-03' })).status).toBe(200)
    expect(wf()).toMatchObject({ deposit_received_amount: 10000, deposit_receipt_source: 'checkbox' })
    for (const who of ['REP1', 'PM', 'OWNER']) {
      as(who)
      const r = await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 1000000 } })
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/cannot change after the deposit is recorded received/)
    }
    expect(order().deposit_amount).toBe(10000)
    // Even if the live amount drifts (e.g. a legacy write), commission uses the snapshot.
    order().deposit_amount = 1000000
    as('OWNER')
    const c = (await get(`id=${ID.O1}`)).body.data.mb.commission
    expect(c).toMatchObject({ deposit_leg_cents: 1000000, base_cents: 1000000, salesman_pool_cents: 400000, deposit_basis: 'received_snapshot' })
    expect((await get('mb=commission_report')).body.rows.find(r => r.order_id === ID.O1).deposit_leg_cents).toBe(1000000)
    as('REP1')
    expect((await get(`id=${ID.O1}`)).body.data.mb.commission.my_commission_cents).toBe(400000)
    expect((await get('mb=commission_report')).body.totals.my_commission_cents).toBe(400000)
  })
  test('the DB guard also refuses a received-deposit amount change that slips past the API check', async () => {
    // The rep loads the order (not received), office marks it received, then the rep's write lands.
    as('REP1')
    let fired = false
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_orders' && op === 'update' && !fired) { fired = true; Object.assign(order(), { deposit_received: true, payment_status: 'deposit_received' }) }
    }
    const r = await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 1000000 } })
    expect(r.status).toBe(409)
    expect(order().deposit_amount).toBe(10000)
  })
  test('payment path takes the snapshot once; later syncs do not overwrite it', async () => {
    as('PM')
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000, payment_date: '2026-11-04' })
    expect(wf()).toMatchObject({ deposit_received_amount: 10000, deposit_receipt_source: 'payments' })
    const at = wf().deposit_received_amount_at
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 5000 })
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 2000 })
    expect(wf()).toMatchObject({ deposit_received_amount: 10000, deposit_received_amount_at: at })
    expect((await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 50000 } })).status).toBe(409)
  })
  test('un-marking clears the snapshot and the amount becomes editable again', async () => {
    as('PM')
    await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: false })).status).toBe(200)
    expect(wf().deposit_received_amount).toBeNull()
    expect((await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 12000 } })).status).toBe(200)
    await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(wf().deposit_received_amount).toBe(12000)
  })
  test('a failed snapshot write reverts the receipt (no "received" without its snapshot)', async () => {
    as('PM')
    mockState.failWrite.mb_order_workflow = { insert: 'workflow write failed' }
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(r.status).toBe(500)
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
  })
})

// ── C ────────────────────────────────────────────────────────────────────────
describe('C. uncertain deposit email never re-sent past the idempotency window without the Owner', () => {
  const db = () => supabaseModule.createClient()
  const resend = () => ({ emails: { send: (...a) => mockState.send(...a) } })
  const ago = ms => new Date(Date.now() - ms).toISOString()
  const PAYLOAD = { from: 'NV <x@y>', to: 'jane@example.com', subject: 'Deposit due', html: '<p>saved</p>', text: 'saved' }
  const row = extra => mockState.db.mb_order_workflow.push({
    order_id: ID.O1, signing_request_id: 'sr1', deposit_email_key: 'mb-deposit-sr1', deposit_email_key_gen: 0, deposit_email_attempts: 1,
    deposit_email_to: 'jane@example.com', deposit_email_amount: 10000, deposit_email_payload: PAYLOAD, ...extra,
  })

  test('failed/uncertain older than the window: no provider call (even if the latest retry was recent)', async () => {
    row({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_first_attempt_at: ago(48 * 3600e3), deposit_email_claimed_at: ago(3600e3) })
    const r = await sendDepositEmail(db(), resend(), { orderId: ID.O1, retry: true })
    expect(r.error).toMatch(/23 hours/)
    expect(mockState.send).not.toHaveBeenCalled()
    expect(wf()).toMatchObject({ deposit_email_status: 'failed', deposit_email_attempts: 1 })
    // Through the route: office retry refused (502), still no provider call
    as('PM')
    mockState.db.signing_requests.push({ id: 'sr1', status: 'signed', sales_order_id: ID.O1, signed_doc_id: 'd', deposit_amount_snapshot: 10000, signer_email: 'jane@example.com' })
    const p = await post({ action: 'mb_retry_completion', id: ID.O1 })
    expect(p.status).toBe(502)
    expect(mockState.send).not.toHaveBeenCalled()
  })
  test('legacy uncertain row without first-attempt time falls back to its claim time', async () => {
    row({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_claimed_at: ago(30 * 3600e3) })
    expect((await sendDepositEmail(db(), resend(), { orderId: ID.O1 })).error).toMatch(/23 hours/)
    expect(mockState.send).not.toHaveBeenCalled()
  })
  test('Owner force after the window sends once and starts a new window', async () => {
    row({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_first_attempt_at: ago(48 * 3600e3), deposit_email_claimed_at: ago(48 * 3600e3) })
    const r = await sendDepositEmail(db(), resend(), { orderId: ID.O1, retry: true, forceUncertain: true })
    expect(r.status).toBe('sent')
    expect(mockState.send).toHaveBeenCalledTimes(1)
    expect(Date.now() - new Date(wf().deposit_email_first_attempt_at)).toBeLessThan(60e3)
  })
  test('inside the window: same key, same saved payload, first-attempt time not overwritten', async () => {
    const first = ago(2 * 3600e3)
    row({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_first_attempt_at: first, deposit_email_claimed_at: first })
    mockState.db.company_payment_settings[0].payment_instructions = 'CHANGED'
    const r = await sendDepositEmail(db(), resend(), { orderId: ID.O1, retry: true })
    expect(r.status).toBe('sent')
    expect(mockState.sent).toHaveLength(1)
    expect(mockState.sent[0].opts.idempotencyKey).toBe('mb-deposit-sr1:0')
    expect(mockState.sent[0].msg).toEqual(PAYLOAD)
    expect(wf().deposit_email_first_attempt_at).toBe(first)
  })
  test('a definite rejection may retry with a NEW key even long afterwards', async () => {
    row({ deposit_email_status: 'failed', deposit_email_failure_kind: 'rejected', deposit_email_key_gen: 1, deposit_email_payload: null, deposit_email_first_attempt_at: null, deposit_email_claimed_at: ago(72 * 3600e3) })
    const r = await sendDepositEmail(db(), resend(), { orderId: ID.O1, retry: true })
    expect(r.status).toBe('sent')
    expect(mockState.sent[0].opts.idempotencyKey).toBe('mb-deposit-sr1:1')
  })
  test('rejection bumps the generation and clears the first-attempt time; uncertain keeps it', async () => {
    row({ deposit_email_status: 'queued', deposit_email_attempts: 0, deposit_email_payload: null })
    mockState.send = jest.fn(async () => { throw new Error('socket hang up') })
    await sendDepositEmail(db(), resend(), { orderId: ID.O1 })
    const firstAt = wf().deposit_email_first_attempt_at
    expect(wf()).toMatchObject({ deposit_email_status: 'failed', deposit_email_failure_kind: 'uncertain', deposit_email_key_gen: 0 })
    expect(firstAt).toBeTruthy()
    mockState.send = jest.fn(async () => ({ data: null, error: { statusCode: 422, message: 'bad to' } }))
    await sendDepositEmail(db(), resend(), { orderId: ID.O1, retry: true })
    expect(wf()).toMatchObject({ deposit_email_failure_kind: 'rejected', deposit_email_key_gen: 1, deposit_email_first_attempt_at: null, deposit_email_payload: null })
    expect(IDEMPOTENCY_WINDOW_MS).toBe(23 * 3600e3)
  })
})

// ── D ────────────────────────────────────────────────────────────────────────
describe('D. signing locks hold against a concurrent request', () => {
  test('a pending request that appears after validation makes the deposit update fail (409), amount unchanged', async () => {
    await addForms()
    let fired = false
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_orders' && op === 'update' && !fired) {
        fired = true // the API already looked: no request. Now one lands with a different snapshot.
        mockState.db.signing_requests.push({ id: 'sr-race', token: 'race', status: 'pending', sales_order_id: ID.O1, sales_doc_id: ID.CFORM, deposit_amount_snapshot: 5000, signer_email: 'jane@example.com', signer_name: 'Jane Doe' })
      }
    }
    const r = await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 12000 } })
    expect(fired).toBe(true)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/locked/)
    expect(order().deposit_amount).toBe(10000)
  })
  test('same race on customer email; an unrelated field save still works with a request out', async () => {
    await addForms()
    mockState.beforeWrite = (table, op) => {
      if (table === 'sales_orders' && op === 'update' && !mockState.db.signing_requests.length) mockState.db.signing_requests.push({ id: 'sr-race', status: 'pending', sales_order_id: ID.O1 })
    }
    expect((await post({ action: 'update', id: ID.O1, fields: { customer_email: 'new@example.com' } })).status).toBe(409)
    expect(order().customer_email).toBe('jane@example.com')
    expect((await post({ action: 'update', id: ID.O1, fields: { customer_phone: '555' } })).status).toBe(200)
  })
  test('send-for-sign re-reads the order right before insert: a change in between is refused', async () => {
    const bytes = await addForms()
    const key = `sales-docs/${ID.O1}/2_client-form.pdf`
    delete mockState.files[key]
    Object.defineProperty(mockState.files, key, { configurable: true, enumerable: true, get() { order().deposit_amount = 12000; return bytes } })
    const r = await post({ action: 'mb_send_for_signature', id: ID.O1 })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/order changed/)
    expect(mockState.db.signing_requests).toHaveLength(0)
  })
  test('a change landing at insert time is refused by the DB guard (409, no request)', async () => {
    await addForms()
    mockState.beforeWrite = (table, op) => { if (table === 'signing_requests' && op === 'insert') order().deposit_amount = 12000 }
    const r = await post({ action: 'mb_send_for_signature', id: ID.O1 })
    expect(r.status).toBe(409)
    expect(mockState.db.signing_requests).toHaveLength(0)
  })
  test('a concurrent send hitting the unique pending index returns the existing 409, not a 500', async () => {
    await addForms()
    mockState.beforeWrite = (table, op) => {
      if (table === 'signing_requests' && op === 'insert' && !mockState.db.signing_requests.length) {
        mockState.db.signing_requests.push({ id: 'other', token: 'o', status: 'pending', sales_order_id: ID.O1, sales_doc_id: ID.CFORM, deposit_amount_snapshot: 10000 })
      }
    }
    const r = await post({ action: 'mb_send_for_signature', id: ID.O1 })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/Another signature request was just created/)
    expect(mockState.db.signing_requests).toHaveLength(1)
  })
})

// ── E ────────────────────────────────────────────────────────────────────────
describe('E. MB stage / purchasing / convert-lead cannot skip signing and turn-in', () => {
  const contractDoc = (orderId = ID.O1) => mockState.db.sales_order_docs.push({ id: `c-${orderId}`, order_id: orderId, category: 'contract', file_name: 'contract.pdf', storage_path: `${orderId}/c.pdf` })
  const signed = () => mockState.db.signing_requests.push({ id: 'sr-s', status: 'signed', sales_order_id: ID.O1, sales_doc_id: ID.CFORM, deposit_amount_snapshot: 10000 })
  const turnedIn = (extra = {}) => mockState.db.mb_order_workflow.push({ order_id: ID.O1, supplier_turned_in_at: '2026-11-05T00:00:00Z', ...extra })
  const stage = (s, extra = {}) => post({ action: 'set_stage', id: ID.O1, stage: s, ...extra })

  test('contract_signed: a generic contract doc is not enough; office override does not bypass', async () => {
    contractDoc()
    as('REP1'); expect((await stage('contract_signed')).status).toBe(422)
    for (const who of ['PM', 'OWNER']) {
      as(who)
      const r = await stage('contract_signed', { override_reason: 'customer signed on paper' })
      expect(r.status).toBe(422)
      expect(r.body.override_allowed).toBe(false)
      expect(r.body.blockers.join(' ')).toMatch(/signed by the customer/)
    }
    expect(order()).toMatchObject({ stage: 'quoted' })
    expect(order().contract_signed_at).toBeUndefined()
    expect(order().signed_contract_value).toBeUndefined()
  })
  test('contract_signed succeeds once a native signed request exists', async () => {
    signed(); as('REP1')
    expect((await stage('contract_signed')).status).toBe(200)
    expect(order().stage).toBe('contract_signed')
    expect(order().contract_signed_at).toBeTruthy()
  })
  test('order_placed: a hand-built confirmed supplier row is not enough; override does not bypass; turn-in is', async () => {
    signed(); order().stage = 'contract_signed'
    mockState.db.sales_supplier_orders.push({ id: 'so-x', order_id: ID.O1, status: 'confirmed', confirmation_number: 'C-1' })
    as('REP1'); expect((await stage('order_placed')).status).toBe(422)
    as('OWNER'); expect((await stage('order_placed', { override_reason: 'we called them' })).status).toBe(422)
    expect(order().stage).toBe('contract_signed')
    turnedIn()
    as('REP1'); expect((await stage('order_placed')).status).toBe(200)
    expect(order().stage).toBe('order_placed')
  })
  test('jumping past the gates (quoted → scheduled/completed) is refused even with override', async () => {
    as('OWNER')
    for (const s of ['order_placed', 'scheduled', 'installed', 'completed']) {
      expect((await stage(s, { override_reason: 'skip' })).status).toBe(422)
    }
    expect(order().stage).toBe('quoted')
    // lead/quoted/on_hold/cancelled remain free moves
    expect((await stage('lead')).status).toBe(200)
  })
  test('create_supplier_order is refused before turn-in; nothing is created', async () => {
    as('REP1')
    const r = await post({ action: 'create_supplier_order', id: ID.O1, fields: { supplier_name: 'Acme', status: 'confirmed', confirmation_number: 'C-1' } })
    expect(r.status).toBe(409)
    as('OWNER')
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: { status: 'delivered' } })).status).toBe(409)
    expect(mockState.db.sales_supplier_orders).toHaveLength(0)
    expect(order().delivery_status).toBeUndefined()
  })
  test('update_supplier_order on an MB order before turn-in is refused; after turn-in it works but audit fields stay', async () => {
    mockState.db.sales_supplier_orders.push({ id: 'legacy', order_id: ID.O1, status: 'pending' })
    as('PM')
    expect((await post({ action: 'update_supplier_order', supplier_order_id: 'legacy', fields: { status: 'confirmed', confirmation_number: 'C-9' } })).status).toBe(409)
    expect(mockState.db.sales_supplier_orders[0].status).toBe('pending')
    mockState.db.sales_supplier_orders.push({ id: 'turnin-row', order_id: ID.O1, status: 'submitted', supplier_id: ID.SUP, supplier_name: 'Acme Steel', ordered_at: '2026-11-05T00:00:00Z' })
    turnedIn({ supplier_order_row_id: 'turnin-row' })
    expect((await post({ action: 'update_supplier_order', supplier_order_id: 'turnin-row', fields: { supplier_id: ID.SUP2 } })).status).toBe(409)
    expect((await post({ action: 'update_supplier_order', supplier_order_id: 'turnin-row', fields: { ordered_at: '2026-01-01T00:00:00Z' } })).status).toBe(409)
    const ok = await post({ action: 'update_supplier_order', supplier_order_id: 'turnin-row', fields: { status: 'confirmed', confirmation_number: 'C-2', supplier_name: 'Acme Steel' } })
    expect(ok.status).toBe(200)
    expect(mockState.db.sales_supplier_orders.find(s => s.id === 'turnin-row')).toMatchObject({ status: 'confirmed', confirmation_number: 'C-2', supplier_id: ID.SUP, ordered_at: '2026-11-05T00:00:00Z' })
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: { supplier_name: 'Trim Co', status: 'pending' } })).status).toBe(200)
    expect(mockState.send).not.toHaveBeenCalled() // no supplier email
  })
  test('convert_lead (MB): won lead starts as quoted with no contract stamps; roofing unchanged', async () => {
    mockState.db.metal_building_leads = [{ id: 'mbl1', stage: 'won', won_date: '2026-10-01', contact_name: 'Lead Guy', contact_email: 'lead@example.com', estimate_value: 40000, assigned_to: ID.REP1 }]
    mockState.db.roofing_leads = [{ id: 'rl1', stage: 'won', won_date: '2026-10-01', contact_name: 'Roof Lead', estimate_value: 9000, assigned_to: ID.ROOF }]
    as('PM')
    const m = await post({ action: 'convert_lead', lead_id: 'mbl1', division: 'metal_buildings' })
    expect(m.status).toBe(200)
    expect(m.body.stage).toBe('quoted')
    const mo = order(m.body.id)
    expect(mo.stage).toBe('quoted')
    for (const k of ['contract_signed_at', 'won_at', 'signed_salesperson_id', 'signed_salesperson_name', 'signed_contract_value']) expect(mo[k]).toBeUndefined()
    expect(mockState.db.sales_attribution.filter(a => a.order_id === m.body.id)).toHaveLength(0)
    const r = await post({ action: 'convert_lead', lead_id: 'rl1', division: 'commercial_roofing' })
    expect(r.body.stage).toBe('contract_signed')
    expect(order(r.body.id)).toMatchObject({ stage: 'contract_signed', signed_contract_value: 9000 })
    expect(order(r.body.id).contract_signed_at).toBeTruthy()
  })
  test('roofing control: old contract-doc and supplier-order gates still apply (and still allow override)', async () => {
    as('ROOF')
    const go = (s, extra = {}) => post({ action: 'set_stage', id: ID.R1, stage: s, ...extra })
    expect((await go('contract_signed')).status).toBe(422)
    contractDoc(ID.R1)
    expect((await go('contract_signed')).status).toBe(200)
    expect((await go('order_placed')).status).toBe(422)
    expect((await post({ action: 'create_supplier_order', id: ID.R1, fields: { status: 'confirmed', confirmation_number: 'R-1' } })).status).toBe(200)
    expect((await go('order_placed')).status).toBe(200)
    order(ID.R1).stage = 'quoted'
    mockState.db.sales_order_docs = []
    as('PM')
    expect((await go('contract_signed', { override_reason: 'paper contract in file' })).status).toBe(200)
  })
})

// ── F ────────────────────────────────────────────────────────────────────────
describe('F. refunds clear a payment-sourced (or refunded) deposit receipt', () => {
  test('$10,000 deposit then $10,000 refund → not received, commission deposit leg $0, no synthetic payment', async () => {
    as('PM')
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(order().deposit_received).toBe(true)
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
    expect(r.status).toBe(200)
    expect(r.body.deposit_received).toBe(false)
    expect(order()).toMatchObject({ deposit_received: false, deposit_received_date: null })
    expect(order().payment_status).not.toMatch(/deposit_received|paid/)
    expect(wf().deposit_received_amount).toBeNull()
    expect(mockState.db.sales_order_payments).toHaveLength(2)
    expect(mockState.db.sales_order_history.some(h => h.action === 'deposit_receipt_cleared')).toBe(true)
    as('OWNER')
    const c = (await get(`id=${ID.O1}`)).body.data.mb.commission
    expect(c.deposit_leg_cents).toBe(0)
    expect(c.flags).toContain('deposit_not_received')
  })
  test('partial refund of a payment-sourced receipt also clears it', async () => {
    as('PM')
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 1 })
    expect(order().deposit_received).toBe(false)
  })
  test('checkbox receipt with no deposit/refund rows stays; a later refund clears it', async () => {
    as('PM')
    await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 3000 })
    expect(order().deposit_received).toBe(true)
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 10000 })
    expect(order().deposit_received).toBe(false)
  })
})

// ── G ────────────────────────────────────────────────────────────────────────
describe('G. missing migration fails closed before any mutation', () => {
  const missing = () => { mockState.failSelect.mb_order_workflow = 'relation "public.mb_order_workflow" does not exist' }

  test('mb_record_deposit → 503, deposit_received untouched', async () => {
    missing(); as('PM')
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 050/)
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'none' })
    expect(orderWrites(ID.O1)).toHaveLength(0)
  })
  test('record_payment on MB → 503 before the payment or status is written', async () => {
    missing(); as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(503)
    expect(mockState.db.sales_order_payments).toHaveLength(0)
    expect(order().deposit_received).toBe(false)
    // roofing payments do not depend on it
    expect((await post({ action: 'record_payment', id: ID.R1, payment_type: 'deposit', amount: 10 })).status).toBe(200)
  })
  test('retry / turn-in / send-for-sign / stage gate → 503, nothing written', async () => {
    await addForms()
    mockState.db.signing_requests.push({ id: 'sr1', status: 'signed', sales_order_id: ID.O1, signed_doc_id: 'd' })
    missing(); as('PM')
    expect((await post({ action: 'mb_retry_completion', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).status).toBe(503)
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: {} })).status).toBe(503)
    const st = await post({ action: 'set_stage', id: ID.O1, stage: 'order_placed', override_reason: 'x' })
    expect(st.status).toBe(422)
    expect(st.body.blockers.join(' ')).toMatch(/migration 050/)
    expect(order().stage).toBe('quoted')
    mockState.db.signing_requests = []
    expect((await post({ action: 'mb_send_for_signature', id: ID.O1 })).status).toBe(503)
    expect(mockState.send).not.toHaveBeenCalled()
    expect(mockState.calls.filter(c => c.op !== 'select' && c.table !== 'sales_stage_gate_log')).toHaveLength(0)
  })
  test('signing completion: workflow table missing → 503 and the signature is NOT claimed', async () => {
    await addForms(); as('REP1')
    await post({ action: 'mb_send_for_signature', id: ID.O1 })
    const row = mockState.db.signing_requests[0]
    missing(); mockState.auth = null
    const r = await out(await tokenRoute.POST(jsonReq('http://x', 'POST', { signature_text: 'Jane Doe' }), { params: { token: row.token } }))
    expect(r.status).toBe(503)
    expect(row.status).toBe('pending')
    expect(mockState.send).not.toHaveBeenCalled()
  })
})
