/**
 * Prompt 54: metal-building sales-order workflow through the real API routes
 * (/api/sales-orders, /api/sales-order-docs) with DB/storage/auth/Resend mocked.
 * Covers: scope (MB only, roofing unchanged), supplier + two forms, send-for-sign
 * gates and authorization, generic update/create/stage/supplier bypasses, deposit
 * receipt paths, supplier turn-in, Owner settings, concrete, commission projection
 * and report privacy. No live services, no migration applied.
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

const { ID, INSTRUCTIONS, seed, as, addForms, jsonReq, getReq, out, sha, pdf } = require('./helpers/mb-fixture')
const sales = require('../app/api/sales-orders/route')
const docsRoute = require('../app/api/sales-order-docs/route')
const { computeMbCommission } = require('../lib/mb-commission')

const post = async body => out(await sales.POST(jsonReq('http://x/api/sales-orders', 'POST', body)))
const get = async qs => out(await sales.GET(getReq(`http://x/api/sales-orders?${qs}`)))
const order = (id = ID.O1) => mockState.db.sales_orders.find(o => o.id === id)
const writes = table => mockState.calls.filter(c => c.table === table && c.op !== 'select')

function upload({ orderId = ID.O1, category = 'general', name = 'f.pdf', bytes = Buffer.from('%PDF-1.4 x'), type = 'application/pdf', meta = {} } = {}) {
  const fd = new FormData()
  fd.append('file', new File([bytes], name, { type }))
  fd.append('data', JSON.stringify({ order_id: orderId, category, ...meta }))
  return docsRoute.POST(new Request('http://x/api/sales-order-docs', { method: 'POST', body: fd })).then(out)
}

beforeEach(() => seed())

// ── 1. Scope + forms ───────────────────────────────────────────────────────────
describe('scope: metal buildings only; roofing unchanged', () => {
  test('roofing create still spreads fields as before; MB create is allow-listed', async () => {
    as('ROOF')
    const r = await post({ action: 'create', fields: { division: 'commercial_roofing', customer_name: 'Roof Co', stage: 'contract_signed', roof_type: 'TPO' } })
    expect(r.status).toBe(200)
    const created = mockState.db.sales_orders.find(o => o.id === r.body.id)
    expect(created).toMatchObject({ division: 'commercial_roofing', stage: 'contract_signed', roof_type: 'TPO' })
    as('REP1')
    expect((await post({ action: 'create', fields: { division: 'metal_buildings', customer_name: 'X', payment_status: 'paid' } })).status).toBe(403)
    const ok = await post({ action: 'create', fields: { division: 'metal_buildings', customer_name: 'X', salesperson_id: ID.REP1 } })
    expect(ok.status).toBe(200)
    expect(mockState.db.sales_orders.find(o => o.id === ok.body.id)).toMatchObject({ salesperson_id: ID.REP1, stage: 'lead' })
  })
  test('roofing generic update still accepts its old fields (incl. deposit checkbox)', async () => {
    as('PM')
    const r = await post({ action: 'update', id: ID.R1, fields: { deposit_received: true, payment_status: 'deposit_received', roof_type: 'EPDM' } })
    expect(r.status).toBe(200)
    expect(order(ID.R1)).toMatchObject({ deposit_received: true, payment_status: 'deposit_received', roof_type: 'EPDM' })
  })
  test('roofing record_payment keeps the legacy status rule', async () => {
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.R1, payment_type: 'deposit', amount: 1 })
    expect(r.body.new_payment_status).toBe('deposit_received')
    expect(order(ID.R1).deposit_received).toBe(false) // legacy path never touched the boolean
  })
  test('all seven old categories still upload on roofing and MB; new ones only on MB', async () => {
    for (const cat of ['contract', 'quote', 'photo', 'permit', 'completion', 'other', 'general']) {
      as('ROOF'); expect((await upload({ orderId: ID.R1, category: cat })).status).toBe(200)
      as('REP1'); expect((await upload({ orderId: ID.O1, category: cat })).status).toBe(200)
    }
    as('ROOF')
    expect((await upload({ orderId: ID.R1, category: 'client_order_form' })).status).toBe(400)
    expect((await upload({ orderId: ID.R1, category: 'bogus' })).status).toBe(400)
  })
  test('roofing rep cannot read an MB order', async () => {
    as('ROOF')
    expect((await get(`id=${ID.O1}`)).status).toBe(403)
    expect((await get(`id=${ID.R1}`)).status).toBe(200)
  })
})

describe('supplier + two order forms', () => {
  test('assigned rep, attribution rep and office can pick a real supplier; others cannot', async () => {
    expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP })).status).toBe(200)
    expect(order().supplier_id).toBe(ID.SUP)
    mockState.db.sales_attribution.push({ id: 'a1', order_id: ID.O1, salesperson_id: ID.REP2, share_pct: 100 })
    as('REP2'); expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP2 })).status).toBe(200)
    as('ADMIN'); expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP })).status).toBe(200)
    const before = mockState.calls.length
    for (const who of ['REP3', 'ROOF', 'CLIENT', null]) {
      as(who)
      const r = await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP2 })
      expect([401, 403]).toContain(r.status)
    }
    expect(mockState.calls.slice(before).filter(c => c.table === 'sales_orders' && c.op === 'update')).toHaveLength(0)
    expect(order().supplier_id).toBe(ID.SUP)
  })
  test('supplier must exist; forged/extra fields rejected', async () => {
    expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: '60000000-0000-4000-8000-00000000dead' })).status).toBe(400)
    expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: 'acme' })).status).toBe(400)
    expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP, division: 'commercial_roofing' })).status).toBe(400)
    expect((await post({ action: 'mb_set_supplier', id: ID.R1, supplier_id: ID.SUP })).status).toBe(400)
  })
  test('client form must be a real PDF; supplier form stays internal; versions chain', async () => {
    expect((await upload({ category: 'client_order_form', name: 'form.docx', type: 'application/msword' })).status).toBe(400)
    expect((await upload({ category: 'client_order_form', name: 'fake.pdf', bytes: Buffer.from('<html>') })).body.error).toMatch(/not a real PDF/)
    const s = await upload({ category: 'supplier_order_form', name: 'acme.jpg', type: 'image/jpeg', bytes: Buffer.from('jpg'), meta: { visible_to_customer: true } })
    expect(s.status).toBe(200)
    const sdoc = mockState.db.sales_order_docs.find(d => d.id === s.body.id)
    expect(sdoc.visible_to_customer).toBe(false)
    expect(sdoc.uploaded_by).toBe(ID.REP1)
    expect((await out(await docsRoute.POST(jsonReq('http://x', 'POST', { action: 'toggle_customer_visibility', id: sdoc.id, visible_to_customer: true }))))).toMatchObject({ status: 400 })
    const c1 = await upload({ category: 'client_order_form', bytes: await pdf() })
    const c2 = await upload({ category: 'client_order_form', bytes: await pdf() })
    const d2 = mockState.db.sales_order_docs.find(d => d.id === c2.body.id)
    expect(d2).toMatchObject({ version_number: 2, replaces_doc_id: c1.body.id })
    expect(mockState.db.sales_order_docs.find(d => d.id === c1.body.id)).toBeTruthy() // old version kept
  })
  test('size limit, upload failure, metadata failure give clear errors and leave nothing behind', async () => {
    expect((await upload({ category: 'supplier_order_form', bytes: Buffer.alloc(25 * 1024 * 1024 + 1, 1) })).body.error).toMatch(/25 MB/)
    mockState.failUpload['sales-docs'] = 'bucket offline'
    const u = await upload({ category: 'supplier_order_form' })
    expect(u.status).toBe(500)
    expect(u.body.error).toMatch(/Upload failed: bucket offline/)
    mockState.failUpload = {}
    mockState.failWrite.sales_order_docs = { insert: 'insert blocked' }
    const m = await upload({ category: 'supplier_order_form' })
    expect(m.status).toBe(500)
    expect(m.body.error).toMatch(/could not be recorded \(insert blocked\)/)
    expect(Object.keys(mockState.files)).toHaveLength(0) // orphan removed
  })
  test('other rep, roofing rep, client owner and unauthenticated cannot upload to an MB order (no storage write)', async () => {
    for (const who of ['REP3', 'ROOF', 'CLIENT', null]) {
      as(who)
      const r = await upload({ category: 'supplier_order_form' })
      expect([401, 403]).toContain(r.status)
    }
    expect(mockState.calls.filter(c => c.op === 'upload')).toHaveLength(0)
  })
  test('download resolves the real doc and gates MB access; arbitrary paths refused', async () => {
    await addForms()
    as('REP3')
    expect((await out(await docsRoute.GET(getReq(`http://x?doc_id=${ID.SFORM}`)))).status).toBe(403)
    as('REP1')
    expect((await out(await docsRoute.GET(getReq(`http://x?doc_id=${ID.SFORM}`)))).body.url).toMatch(/1_acme-order\.pdf/)
    expect((await out(await docsRoute.GET(getReq(`http://x?signed_url=${encodeURIComponent('other-order/secret.pdf')}`)))).status).toBe(404)
    as('ROOF')
    expect((await out(await docsRoute.GET(getReq(`http://x?signed_url=${encodeURIComponent(`${ID.O1}/1_acme-order.pdf`)}`)))).status).toBe(403)
  })
})

// ── Send for signature ───────────────────────────────────────────────────────
describe('send for signature: gates and authorization', () => {
  const send = (extra = {}) => post({ action: 'mb_send_for_signature', id: ID.O1, ...extra })
  const reqRows = () => mockState.db.signing_requests

  test('each missing prerequisite blocks with a clear list, before any request exists', async () => {
    let r = await send()
    expect(r.status).toBe(422)
    expect(r.body.missing.map(m => m.key)).toEqual(expect.arrayContaining(['supplier', 'supplier_form', 'client_form']))
    await addForms({ supplier: false }); r = await send()
    expect(r.body.missing.map(m => m.key)).toEqual(['supplier_form'])
    seed(); await addForms({ client: false }); r = await send()
    expect(r.body.missing.map(m => m.key)).toEqual(['client_form'])
    seed(); await addForms({ setSupplier: false }); r = await send()
    expect(r.body.missing.map(m => m.key)).toEqual(['supplier'])
    expect(reqRows()).toHaveLength(0)
  })
  test.each([[0], [-50], [null], ['abc'], ['']])('deposit amount %p is refused', async amt => {
    await addForms(); order().deposit_amount = amt
    const r = await send()
    expect(r.status).toBe(422)
    expect(r.body.missing.map(m => m.key)).toContain('deposit_amount')
    expect(reqRows()).toHaveLength(0)
  })
  test('invalid customer email, missing name, missing payment instructions are refused', async () => {
    await addForms()
    order().customer_email = 'not-an-email'
    expect((await send()).body.missing.map(m => m.key)).toEqual(['customer_email'])
    order().customer_email = 'jane@example.com'; order().customer_name = '  '
    expect((await send()).body.missing.map(m => m.key)).toEqual(['customer_name'])
    order().customer_name = 'Jane Doe'; mockState.db.company_payment_settings = []
    expect((await send()).body.missing.map(m => m.key)).toEqual(['payment_instructions'])
    expect(reqRows()).toHaveLength(0)
  })
  test('wrong-order / wrong-category doc ids and missing stored files are refused', async () => {
    await addForms()
    mockState.db.sales_order_docs.push({ id: ID.OTHERDOC, order_id: ID.O2, category: 'client_order_form', file_name: 'x.pdf', storage_path: `${ID.O2}/x.pdf` })
    expect((await send({ doc_id: ID.OTHERDOC })).status).toBe(400)
    expect((await send({ doc_id: ID.SFORM })).status).toBe(400)
    delete mockState.files[`sales-docs/${ID.O1}/2_client-form.pdf`]
    expect((await send()).body.error).toMatch(/client order form file is missing/)
    seed(); await addForms(); delete mockState.files[`sales-docs/${ID.O1}/1_acme-order.pdf`]
    expect((await send()).body.error).toMatch(/supplier's order form file is missing/)
    seed(); await addForms(); mockState.files[`sales-docs/${ID.O1}/2_client-form.pdf`] = Buffer.from('%PDF-1.4 broken')
    expect((await send()).body.error).toMatch(/could not be read/)
    expect(reqRows()).toHaveLength(0)
  })
  test('assigned rep sends: native request pinned to the exact doc, canonical link, no email, no job', async () => {
    const bytes = await addForms()
    const r = await send()
    expect(r.status).toBe(200)
    expect(r.body.sign_url).toMatch(/^https:\/\/portal\.nv\.construction\/sign\?token=tok-/)
    const row = reqRows()[0]
    expect(row).toMatchObject({ job_id: null, subcontract_id: null, sales_order_id: ID.O1, sales_doc_id: ID.CFORM, document_sha256: sha(bytes), deposit_amount_snapshot: 10000, signer_email: 'jane@example.com', signer_name: 'Jane Doe', mb_supplier_id: ID.SUP, created_by: ID.REP1 })
    expect(mockState.send).not.toHaveBeenCalled()
    expect(writes('subcontracts')).toHaveLength(0)
    expect(writes('jobs')).toHaveLength(0)
  })
  test('attribution rep and office can send; other rep, roofing rep, client owner, unauth cannot; forged fields refused', async () => {
    await addForms()
    mockState.db.sales_attribution.push({ id: 'a1', order_id: ID.O1, salesperson_id: ID.REP2, share_pct: 100 })
    for (const who of ['REP3', 'ROOF', 'CLIENT', null]) { as(who); expect([401, 403]).toContain((await send()).status) }
    as('REP1'); expect((await send({ signer_email: 'attacker@evil.test' })).status).toBe(400)
    expect((await send({ storage_path: 'x' })).status).toBe(400)
    expect(reqRows()).toHaveLength(0)
    as('REP2'); expect((await send()).status).toBe(200)
    seed(); await addForms(); as('PM'); expect((await send()).status).toBe(200)
  })
  test('resend is idempotent; a different form needs the pending one cancelled; signed refuses', async () => {
    await addForms()
    const a = await send(); const b = await send()
    expect(b.body).toMatchObject({ reused: true, sign_url: a.body.sign_url })
    expect(reqRows()).toHaveLength(1)
    mockState.db.sales_order_docs.push({ id: ID.CFORM2, order_id: ID.O1, category: 'client_order_form', file_name: 'v2.pdf', storage_path: `${ID.O1}/3_v2.pdf`, created_at: '2026-11-03T00:00:00Z', version_number: 2 })
    mockState.files[`sales-docs/${ID.O1}/3_v2.pdf`] = await pdf()
    expect((await send()).status).toBe(409)
    expect((await post({ action: 'mb_void_signature', id: ID.O1 })).status).toBe(200)
    const c = await send()
    expect(c.status).toBe(200)
    expect(reqRows().find(r => r.status === 'pending').sales_doc_id).toBe(ID.CFORM2)
    reqRows().find(r => r.status === 'pending').status = 'signed'
    expect((await send()).status).toBe(409)
  })
  test('pending request locks deposit, customer email/name and supplier; cannot delete pinned doc', async () => {
    await addForms(); await send()
    expect((await post({ action: 'update', id: ID.O1, fields: { deposit_amount: 1 } })).status).toBe(409)
    expect((await post({ action: 'update', id: ID.O1, fields: { customer_email: 'x@y.co' } })).status).toBe(409)
    expect((await post({ action: 'mb_set_supplier', id: ID.O1, supplier_id: ID.SUP2 })).status).toBe(409)
    expect(order().deposit_amount).toBe(10000)
    as('PM')
    expect((await out(await docsRoute.POST(jsonReq('http://x', 'POST', { action: 'delete', id: ID.CFORM })))).status).toBe(409)
    expect(mockState.db.sales_order_docs.find(d => d.id === ID.CFORM)).toBeTruthy()
  })
  test('missing migration fails clearly before any write', async () => {
    await addForms()
    mockState.missingSelectCols.signing_requests = ['sales_order_id']
    const r = await send()
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 050/)
    expect(reqRows()).toHaveLength(0)
  })
})

// ── Bypass protections ───────────────────────────────────────────────────────
describe('generic endpoints cannot bypass the MB workflow', () => {
  test('update cannot write status/receipt/signed/supplier/concrete/assignment fields', async () => {
    for (const fields of [{ payment_status: 'paid' }, { deposit_received: true }, { deposit_received_date: '2026-11-01' }, { stage: 'completed' }, { signed_contract_value: 1 }, { supplier_id: ID.SUP }, { concrete_cost: 5 }, { division: 'commercial_roofing' }, { salesperson_id: ID.REP3 }]) {
      const r = await post({ action: 'update', id: ID.O1, fields })
      expect(r.status).toBe(403)
    }
    expect(order()).toMatchObject({ payment_status: 'none', deposit_received: false, stage: 'quoted', salesperson_id: ID.REP1, division: 'metal_buildings' })
    expect((await post({ action: 'update', id: ID.O1, fields: { random_col: 1 } })).status).toBe(400)
    expect((await post({ action: 'update', id: ID.O1, fields: [] })).status).toBe(400)
  })
  test('a rep cannot touch an order they are not on (and cannot self-assign to get on it)', async () => {
    as('REP3')
    expect((await post({ action: 'update', id: ID.O1, fields: { customer_phone: '1' } })).status).toBe(403)
    expect((await post({ action: 'update', id: ID.O1, fields: { salesperson_id: ID.REP3 } })).status).toBe(403)
    expect((await post({ action: 'set_stage', id: ID.O1, stage: 'lead' })).status).toBe(403)
    expect(order().salesperson_id).toBe(ID.REP1)
  })
  test('office can reassign; legit rep edits still save', async () => {
    expect((await post({ action: 'update', id: ID.O1, fields: { customer_phone: '555', deposit_amount: '12000.50' } })).status).toBe(200)
    expect(order()).toMatchObject({ customer_phone: '555', deposit_amount: 12000.5 })
    as('PM'); expect((await post({ action: 'update', id: ID.O1, fields: { salesperson_id: ID.REP3 } })).status).toBe(200)
  })
  test('supplier-order endpoints cannot reparent or spoof the actor', async () => {
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, supplier_turned_in_at: '2026-11-05T00:00:00Z' }) // purchasing follows turn-in
    const r = await post({ action: 'create_supplier_order', id: ID.O1, fields: { order_id: ID.O2, created_by: ID.OWNER, created_by_name: 'Owner', supplier_name: 'X' } })
    expect(r.status).toBe(200)
    const so = mockState.db.sales_supplier_orders.find(s => s.id === r.body.id)
    expect(so).toMatchObject({ order_id: ID.O1, created_by: ID.REP1 })
    expect((await post({ action: 'update_supplier_order', supplier_order_id: so.id, fields: { order_id: ID.O2 } })).status).toBe(200)
    expect(so.order_id).toBe(ID.O1)
    as('REP3')
    expect((await post({ action: 'update_supplier_order', supplier_order_id: so.id, fields: { status: 'confirmed' } })).status).toBe(403)
    expect((await post({ action: 'create_supplier_order', id: ID.O1, fields: {} })).status).toBe(403)
  })
  test('docs: other rep cannot reparent/toggle/delete; missing doc fails closed', async () => {
    await addForms()
    as('REP3')
    expect((await out(await docsRoute.POST(jsonReq('http://x', 'POST', { action: 'toggle_customer_visibility', id: ID.CFORM, visible_to_customer: true })))).status).toBe(403)
    expect((await out(await docsRoute.POST(jsonReq('http://x', 'POST', { action: 'delete', id: ID.CFORM })))).status).toBe(403)
    as('PM')
    expect((await out(await docsRoute.POST(jsonReq('http://x', 'POST', { action: 'delete', id: '70000000-0000-4000-8000-0000000000ff' })))).status).toBe(404)
  })
  test('unknown mb_ action and non-sales roles are refused', async () => {
    expect((await post({ action: 'mb_whatever', id: ID.O1 })).status).toBe(400)
    as('CLIENT'); expect((await post({ action: 'mb_save_settings', payment_instructions: 'x' })).status).toBe(403)
  })
})

// ── Deposit receipt paths ────────────────────────────────────────────────────
describe('deposit receipt: checkbox action and record_payment, never double', () => {
  test('payment amount validation (no insert on bad input)', async () => {
    as('PM')
    for (const amount of [0, -1, 'abc', 'NaN', null, '', 'Infinity', {}]) {
      const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount })
      expect(r.status).toBe(400)
    }
    expect((await post({ action: 'record_payment', id: ID.O1, payment_type: 'bogus', amount: 5 })).status).toBe(400)
    expect((await post({ action: 'record_payment', id: '50000000-0000-4000-8000-0000000000ff', amount: 5 })).status).toBe(404)
    expect(mockState.db.sales_order_payments).toHaveLength(0)
  })
  test('full deposit payment marks the deposit received (date/boolean/status consistent)', async () => {
    as('PM')
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000, payment_date: '2026-11-04' })
    expect(r.body).toMatchObject({ new_payment_status: 'deposit_received', deposit_received: true })
    expect(order()).toMatchObject({ deposit_received: true, deposit_received_date: '2026-11-04', payment_status: 'deposit_received' })
    expect(mockState.db.mb_order_workflow[0]).toMatchObject({ deposit_receipt_source: 'payments' })
  })
  test('partial deposit / progress payment does not claim the deposit received; refunds count against it', async () => {
    as('PM')
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'progress', amount: 20000 })
    expect(order().deposit_received).toBe(false)
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 6000 })
    expect(order()).toMatchObject({ deposit_received: false, payment_status: 'partial' })
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'refund', amount: 1000 })
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 4000 })
    expect(order().deposit_received).toBe(false) // 10,000 deposits - 1,000 refund < 10,000 due
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 1000 })
    expect(order().deposit_received).toBe(true)
  })
  test('checkbox marks received without a synthetic payment; later payment does not double count', async () => {
    as('PM')
    const r = await post({ action: 'mb_record_deposit', id: ID.O1, received: true, received_date: '2026-11-03' })
    expect(r.status).toBe(200)
    expect(order()).toMatchObject({ deposit_received: true, deposit_received_date: '2026-11-03', payment_status: 'deposit_received' })
    expect(mockState.db.sales_order_payments).toHaveLength(0)
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true })).body.already).toBe(true)
    await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000, payment_date: '2026-11-09' })
    expect(order().deposit_received_date).toBe('2026-11-03') // first receipt date kept
    const c = computeMbCommission(order(), null, [])
    expect(c.deposit_leg_cents).toBe(1000000) // deposit_amount once, not + payments
    // Unmark refused while payments cover the deposit
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: false })).status).toBe(409)
  })
  test('checkbox needs a valid amount, office role, and checks DB errors', async () => {
    as('REP1'); expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true })).status).toBe(403)
    as('PM'); order().deposit_amount = null
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true })).status).toBe(400)
    order().deposit_amount = 10000
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: 'yes' })).status).toBe(400)
    mockState.failWrite.sales_orders = { update: 'db down' }
    expect((await post({ action: 'mb_record_deposit', id: ID.O1, received: true })).status).toBe(500)
    expect(order().deposit_received).toBe(false)
  })
  test('payment-status write failure is reported, not swallowed', async () => {
    as('PM'); mockState.failWrite.sales_orders = { update: 'db down' }
    const r = await post({ action: 'record_payment', id: ID.O1, payment_type: 'deposit', amount: 10000 })
    expect(r.status).toBe(500)
    expect(r.body.error).toMatch(/Payment saved, but/)
  })
})

// ── Supplier turn-in ─────────────────────────────────────────────────────────
describe('turn in supplier order form', () => {
  const signIt = (status = 'sent') => {
    mockState.db.signing_requests.push({ id: 'sr1', token: 't1', status: 'signed', sales_order_id: ID.O1, sales_doc_id: ID.CFORM, signed_doc_id: 'x' })
    mockState.db.mb_order_workflow.push({ order_id: ID.O1, deposit_email_status: status, deposit_email_attempts: 1 })
  }
  test('gated on signature and deposit request state', async () => {
    await addForms(); as('PM')
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).status).toBe(409)
    signIt('failed')
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).body.error).toMatch(/failed/)
  })
  test('office records authentic actor/time once; double taps are safe; no email or confirmation', async () => {
    await addForms(); signIt('sent'); as('ADMIN')
    const a = await post({ action: 'mb_turn_in_supplier_form', id: ID.O1, actor_name: 'Forged Name' })
    expect(a.status).toBe(200)
    expect(a.body.turned_in_by_name).toBe('ADMIN Person')
    const wf = mockState.db.mb_order_workflow[0]
    expect(wf).toMatchObject({ supplier_turned_in_by: ID.ADMIN, supplier_turned_in_supplier_id: ID.SUP, supplier_turned_in_doc_id: ID.SFORM })
    const firstAt = wf.supplier_turned_in_at
    as('OWNER')
    const [b, c] = await Promise.all([post({ action: 'mb_turn_in_supplier_form', id: ID.O1 }), post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })])
    expect(b.body.already && c.body.already).toBe(true)
    expect(wf.supplier_turned_in_at).toBe(firstAt)
    expect(wf.supplier_turned_in_by).toBe(ID.ADMIN)
    expect(mockState.db.sales_supplier_orders).toHaveLength(1)
    expect(mockState.db.sales_supplier_orders[0]).toMatchObject({ status: 'submitted', supplier_id: ID.SUP })
    expect(mockState.db.sales_supplier_orders[0].confirmation_number).toBeUndefined()
    expect(order().delivery_status).toBeUndefined()
    expect(mockState.send).not.toHaveBeenCalled()
  })
  test('reps and client owner are denied regardless of submitted actor', async () => {
    await addForms(); signIt('sent')
    for (const who of ['REP1', 'REP2', 'CLIENT']) {
      as(who)
      expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1 })).status).toBe(403)
      expect([400, 403]).toContain((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1, actor_id: ID.OWNER })).status)
    }
    as('PM')
    expect((await post({ action: 'mb_turn_in_supplier_form', id: ID.O1, actor_id: ID.OWNER })).status).toBe(400)
    expect(mockState.db.mb_order_workflow[0].supplier_turned_in_at).toBeUndefined()
  })
})

// ── Owner settings ───────────────────────────────────────────────────────────
describe('Owner payment-instruction settings', () => {
  test('principal saves and reloads; everyone else gets only configured/missing', async () => {
    mockState.db.company_payment_settings = []
    as('OWNER')
    expect((await get('mb=settings')).body).toMatchObject({ configured: false })
    expect((await post({ action: 'mb_save_settings', payment_instructions: '  ACH: TEST\r\nCheck: TEST  ' })).status).toBe(200)
    expect((await get('mb=settings')).body).toMatchObject({ configured: true, payment_instructions: 'ACH: TEST\nCheck: TEST', updated_by_name: 'OWNER Person' })
    for (const who of ['PM', 'ADMIN', 'REP1']) {
      as(who)
      const r = await get('mb=settings')
      expect(r.body).toEqual({ configured: true })
      expect((await post({ action: 'mb_save_settings', payment_instructions: 'hijack' })).status).toBe(403)
    }
    as('CLIENT'); expect((await get('mb=settings')).status).toBe(403)
    expect(mockState.db.company_payment_settings[0].payment_instructions).toBe('ACH: TEST\nCheck: TEST')
  })
  test('validation and missing schema', async () => {
    as('OWNER')
    expect((await post({ action: 'mb_save_settings', payment_instructions: '   ' })).status).toBe(400)
    expect((await post({ action: 'mb_save_settings', payment_instructions: 'x'.repeat(4001) })).status).toBe(400)
    expect((await post({ action: 'mb_save_settings', payment_instructions: ['a'] })).status).toBe(400)
    mockState.failSelect.company_payment_settings = 'relation "company_payment_settings" does not exist'
    expect((await post({ action: 'mb_save_settings', payment_instructions: 'ok' })).status).toBe(503)
    expect((await get('mb=settings')).status).toBe(503)
  })
})

// ── Concrete + commission privacy ────────────────────────────────────────────
describe('concrete inputs and commission projection', () => {
  const setup = async () => {
    as('OWNER')
    order().deposit_received = true
    mockState.db.sales_attribution.push({ id: 'a1', order_id: ID.O1, salesperson_id: ID.REP1, salesperson_name: 'Rep One', share_pct: 60 }, { id: 'a2', order_id: ID.O1, salesperson_id: ID.REP2, salesperson_name: 'Rep Two', share_pct: 40 })
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: '9000', concrete_cost: 5000 })).status).toBe(200)
  }
  test('Owner only; validated; stored privately; history has no amounts', async () => {
    for (const who of ['PM', 'ADMIN', 'REP1']) { as(who); expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: 1, concrete_cost: 1 })).status).toBe(403) }
    as('OWNER')
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: -1, concrete_cost: 1 })).status).toBe(400)
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: 'NaN', concrete_cost: 1 })).status).toBe(400)
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: 1 })).status).toBe(400)
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: 0, concrete_cost: null, concrete_net: 5 })).status).toBe(400)
    expect((await post({ action: 'mb_save_concrete', id: ID.O1, concrete_charge: 0, concrete_cost: null })).status).toBe(200)
    expect(mockState.db.mb_order_private[0]).toMatchObject({ concrete_charge: 0, concrete_cost: null })
    expect(order().concrete_charge).toBeUndefined()
    const h = mockState.db.sales_order_history.find(x => x.action === 'concrete_updated')
    expect(h.details).toEqual({})
  })
  test('Owner sees the full split; office sees nothing; rep sees only own dollars', async () => {
    await setup()
    const own = (await get(`id=${ID.O1}`)).body.data.mb
    expect(own.commission).toMatchObject({ scope: 'owner', base_cents: 1400000, salesman_pool_cents: 560000, nv_cents: 560000, marketing_cents: 280000 })
    expect(own.commission.reps.map(r => r.cents).sort()).toEqual([224000, 336000])
    expect(own.concrete).toEqual({ concrete_charge: 9000, concrete_cost: 5000 })
    for (const who of ['PM', 'ADMIN']) {
      as(who)
      const body = (await get(`id=${ID.O1}`)).body
      expect(body.data.mb.commission).toBeNull()
      expect(body.data.mb.concrete).toBeNull()
      expect(JSON.stringify(body)).not.toMatch(/nv_cents|marketing_cents|base_cents|concrete_cost|560000|TEST PAYEE/)
    }
    as('REP2')
    const rep = (await get(`id=${ID.O1}`)).body
    expect(rep.data.mb.commission).toEqual({ scope: 'rep', my_commission_cents: 224000, on_order: true, pending: [] })
    expect(JSON.stringify(rep)).not.toMatch(/nv_cents|marketing_cents|base_cents|salesman_pool|concrete_cost|336000|560000|TEST PAYEE/)
    as('REP3')
    expect((await get(`id=${ID.O1}`)).body.data.mb.commission).toBeNull()
  })
})

describe('commission report', () => {
  test('Owner: MB only, totals reconcile with per-order math, filters work', async () => {
    as('OWNER')
    Object.assign(order(), { deposit_received: true, deposit_received_date: '2026-11-03' })
    Object.assign(order(ID.O2), { deposit_received: false })
    order(ID.R1).deposit_received = true
    mockState.db.mb_order_private.push({ order_id: ID.O1, concrete_charge: 9000, concrete_cost: 5000 })
    const r = await get('mb=commission_report')
    expect(r.status).toBe(200)
    expect(r.body.rows.map(x => x.order_id).sort()).toEqual([ID.O1, ID.O2].sort())
    expect(r.body.totals).toMatchObject({ orders: 2, base_cents: 1400000, nv_cents: 560000, marketing_cents: 280000 })
    expect(r.body.date_basis_label).toMatch(/Deposit received/)
    const one = await get(`mb=commission_report&salesperson_id=${ID.REP1}`)
    expect(one.body.rows.map(x => x.order_id)).toEqual([ID.O1])
    expect(one.body.totals.rep_cents).toBe(560000)
    expect((await get('mb=commission_report&from=2026-11-04&to=2026-11-30')).body.rows).toHaveLength(0)
    expect((await get('mb=commission_report&from=2026-11-03&to=2026-11-03')).body.rows).toHaveLength(1)
    expect((await get('mb=commission_report&deposit=not_received')).body.rows.map(x => x.order_id)).toEqual([ID.O2])
    expect((await get('mb=commission_report&stage=completed')).body.rows).toHaveLength(0)
    expect((await get('mb=commission_report&date_basis=created&from=2026-11-01&to=2026-11-01')).body.rows).toHaveLength(2)
    expect((await get('mb=commission_report&division=commercial_roofing')).status).toBe(400)
  })
  test('complete beyond 1000 rows and totals still reconcile', async () => {
    as('OWNER')
    const many = Array.from({ length: 1205 }, (_, i) => ({ id: `bulk-${i}`, division: 'metal_buildings', order_number: `MB-B-${i}`, stage: 'contract_signed', deposit_amount: 100.01, deposit_received: true, deposit_received_date: '2026-10-01', salesperson_id: ID.REP1, is_preview_data: false, created_at: '2026-10-01T12:00:00Z' }))
    mockState.db.sales_orders.push(...many)
    const r = await get('mb=commission_report&page_size=500')
    expect(r.body.total_rows).toBe(1207)
    expect(r.body.rows).toHaveLength(500)
    expect(r.body.totals.base_cents).toBe(1205 * 10001)
    expect(r.body.totals.salesman_pool_cents + r.body.totals.nv_cents + r.body.totals.marketing_cents).toBe(r.body.totals.base_cents)
  })
  test('rep: forced to own orders and own dollars; forged filters refused; office has no access', async () => {
    Object.assign(order(), { deposit_received: true })
    Object.assign(order(ID.O2), { deposit_received: true })
    as('REP1')
    const r = await get('mb=commission_report')
    expect(r.body.scope).toBe('rep')
    expect(r.body.rows.map(x => x.order_id)).toEqual([ID.O1])
    expect(r.body.totals).toEqual({ orders: 1, my_commission_cents: 400000 })
    expect(JSON.stringify(r.body)).not.toMatch(/nv_cents|marketing|base_cents|salesman_pool|reps"/)
    expect((await get(`mb=commission_report&salesperson_id=${ID.REP3}`)).status).toBe(403)
    expect((await get('mb=commission_report&division=metal_buildings')).status).toBe(400)
    expect((await get(`mb=commission_report&id=${ID.O2}`)).status).toBe(400)
    for (const who of ['PM', 'ADMIN', 'ROOF']) { as(who); expect((await get('mb=commission_report')).status).toBe(403) }
  })
})
