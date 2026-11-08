// Shared in-memory fixture for the prompt 54 metal-building tests.
// Nothing real: mock DB/storage/auth/Resend only. Banking text is a fake placeholder.
const { createHash } = require('crypto')
const { PDFDocument } = require('pdf-lib')
const { mockState, resetMockState } = require('./mock-db')

const ID = {
  OWNER: '10000000-0000-4000-8000-000000000001',
  PM: '10000000-0000-4000-8000-000000000002',
  ADMIN: '10000000-0000-4000-8000-000000000003',
  REP1: '20000000-0000-4000-8000-000000000001', // assigned salesperson
  REP2: '20000000-0000-4000-8000-000000000002', // attribution rep
  REP3: '20000000-0000-4000-8000-000000000003', // metal rep NOT on the order
  ROOF: '30000000-0000-4000-8000-000000000001',
  CLIENT: '40000000-0000-4000-8000-000000000001',
  O1: '50000000-0000-4000-8000-000000000001', // MB order
  R1: '50000000-0000-4000-8000-000000000002', // roofing order
  O2: '50000000-0000-4000-8000-000000000003', // another MB order (other rep)
  SUP: '60000000-0000-4000-8000-000000000001',
  SUP2: '60000000-0000-4000-8000-000000000002',
  SFORM: '70000000-0000-4000-8000-000000000001',
  CFORM: '70000000-0000-4000-8000-000000000002',
  CFORM2: '70000000-0000-4000-8000-000000000003',
  OTHERDOC: '70000000-0000-4000-8000-000000000004',
}
const ROLE_OF = { OWNER: 'principal', PM: 'pm', ADMIN: 'admin', REP1: 'metal_rep', REP2: 'metal_rep', REP3: 'metal_rep', ROOF: 'roofing_rep', CLIENT: 'owner' }
const INSTRUCTIONS = 'Mail a check to: TEST PAYEE <Inc>\nSuite & 5, Test Town'

let pdfBytes = null
async function makePdf(text = 'Client order form') {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  page.drawText(text, { x: 20, y: 150, size: 12 })
  return Buffer.from(await doc.save())
}
async function pdf() { if (!pdfBytes) pdfBytes = await makePdf(); return pdfBytes }
const sha = b => createHash('sha256').update(b).digest('hex')

function as(key) {
  if (key === null) { mockState.auth = null; return }
  mockState.auth = { userId: ID[key], email: `${key.toLowerCase()}@nv.test`, role: ROLE_OF[key], error: null }
}

function mbOrder(extra = {}) {
  return {
    id: ID.O1, division: 'metal_buildings', order_number: 'MB-2026-001', stage: 'quoted',
    customer_name: 'Jane Doe', customer_email: 'jane@example.com', customer_company: null,
    deposit_amount: 10000, deposit_received: false, deposit_received_date: null, payment_status: 'none',
    contract_value: 50000, salesperson_id: ID.REP1, salesperson_name: 'Rep One', supplier_id: null,
    is_preview_data: false, created_at: '2026-11-01T15:00:00.000Z', ...extra,
  }
}

function seed(extra = {}) {
  resetMockState({
    profiles: Object.keys(ROLE_OF).map(k => ({ id: ID[k], full_name: `${k} Person`, role: ROLE_OF[k] })),
    sales_orders: [
      mbOrder(),
      { id: ID.R1, division: 'commercial_roofing', order_number: 'RF-2026-001', stage: 'quoted', customer_email: 'roof@example.com', deposit_amount: 5000, deposit_received: false, payment_status: 'none', contract_value: 20000, salesperson_id: ID.ROOF, is_preview_data: false, created_at: '2026-11-01T15:00:00.000Z' },
      mbOrder({ id: ID.O2, order_number: 'MB-2026-002', salesperson_id: ID.REP3, salesperson_name: 'Rep Three' }),
    ],
    sales_attribution: [],
    mb_suppliers: [{ id: ID.SUP, name: 'Acme Steel' }, { id: ID.SUP2, name: 'Beta Buildings' }],
    sales_order_docs: [],
    signing_requests: [],
    company_payment_settings: [{ id: 1, payment_instructions: INSTRUCTIONS }],
    mb_order_workflow: [],
    mb_order_private: [],
    sales_order_payments: [],
    sales_order_history: [],
    sales_supplier_orders: [],
    subcontracts: [],
    notifications: [],
    ...extra,
  })
  let n = 0
  mockState.defaults.signing_requests = () => ({ token: `tok-${++n}-${Math.random().toString(36).slice(2, 8)}`, status: 'pending' })
  mockState.unique.signing_requests = [r => (r.sales_order_id && r.status === 'pending' ? `p:${r.sales_order_id}` : null), r => (r.sales_order_id && r.status === 'signed' ? `s:${r.sales_order_id}` : null)]
  mockState.unique.mb_order_workflow = [r => r.order_id]
  installMbTriggers()
  mockState.sent = []
  mockState.send = jest.fn(async (msg, opts) => { mockState.sent.push({ msg, opts }); return { data: { id: `em_${mockState.sent.length}` }, error: null } })
  as('REP1')
}

// In-memory stand-ins for the two migration-050 guard triggers (same rules as the SQL).
const distinct = (a, b) => (a ?? null) === null ? (b ?? null) !== null : (b ?? null) === null || String(a) !== String(b)
const numDistinct = (a, b) => ((a ?? null) === null || (b ?? null) === null) ? distinct(a, b) : Number(a) !== Number(b)
function installMbTriggers() {
  mockState.triggers.sales_orders = ({ op, payload, rows }) => {
    if (op !== 'update') return null
    for (const old of rows) {
      if (old.division !== 'metal_buildings') continue
      const next = { ...old, ...payload }
      if (old.deposit_received === true && numDistinct(next.deposit_amount, old.deposit_amount)) return { code: 'P0001', message: 'mb_deposit_locked: deposit amount cannot change after the deposit is received' }
      const changed = numDistinct(next.deposit_amount, old.deposit_amount) || ['customer_email', 'customer_name', 'supplier_id'].some(k => distinct(next[k], old[k]))
      if (changed && (mockState.db.signing_requests || []).some(r => r.sales_order_id === old.id && ['pending', 'signed'].includes(r.status))) {
        return { code: 'P0001', message: 'mb_signing_locked: order fields are locked by a pending or signed client order form' }
      }
    }
    return null
  }
  mockState.triggers.signing_requests = ({ op, rows }) => {
    if (op !== 'insert') return null
    for (const r of rows) {
      if (!r.sales_order_id) continue
      const o = (mockState.db.sales_orders || []).find(x => x.id === r.sales_order_id)
      if (!o || o.division !== 'metal_buildings') return { code: 'P0001', message: 'mb_snapshot_mismatch: not a metal-building order' }
      if (numDistinct(r.deposit_amount_snapshot, o.deposit_amount) || distinct(r.mb_supplier_id, o.supplier_id) ||
          String(r.signer_email || '').trim().toLowerCase() !== String(o.customer_email || '').trim().toLowerCase() ||
          String(r.signer_name || '').trim() !== String(o.customer_name || '').trim()) {
        return { code: 'P0001', message: 'mb_snapshot_mismatch: the order changed while the request was being created' }
      }
    }
    return null
  }
}

async function addForms({ orderId = ID.O1, supplier = true, client = true, setSupplier = true } = {}) {
  const bytes = await pdf()
  const o = mockState.db.sales_orders.find(x => x.id === orderId)
  if (setSupplier) o.supplier_id = ID.SUP
  if (supplier) {
    mockState.db.sales_order_docs.push({ id: ID.SFORM, order_id: orderId, category: 'supplier_order_form', file_name: 'acme-order.pdf', storage_path: `${orderId}/1_acme-order.pdf`, created_at: '2026-11-02T10:00:00Z', version_number: 1, visible_to_customer: false })
    mockState.files[`sales-docs/${orderId}/1_acme-order.pdf`] = Buffer.from('%PDF-1.4 supplier form')
  }
  if (client) {
    mockState.db.sales_order_docs.push({ id: ID.CFORM, order_id: orderId, category: 'client_order_form', file_name: 'client-form.pdf', storage_path: `${orderId}/2_client-form.pdf`, created_at: '2026-11-02T11:00:00Z', version_number: 1, visible_to_customer: false })
    mockState.files[`sales-docs/${orderId}/2_client-form.pdf`] = bytes
  }
  return bytes
}

const jsonReq = (url, method, body) => new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const getReq = url => new Request(url)
const out = async r => ({ status: r.status, body: await r.json() })

module.exports = { ID, ROLE_OF, INSTRUCTIONS, makePdf, pdf, sha, as, seed, addForms, mbOrder, jsonReq, getReq, out }
