/**
 * Prompt 99: Purchase Order "Ready to pay" for the admin team.
 * - lib/po-invoices.js: who pays (PO override → job po_payer → legacy payment_type),
 *   due date default (+30), statuses, partial pay, over-amount check, admin list rows.
 * - lib/po-invoice-auth.js + po.mark_paid permission (admin on by default, rows win).
 * - /api/po-invoices: add / approve / send back / mark paid / paid by owner, with
 *   server-side role + job checks (admin can't approve), conditional writes (no double pay),
 *   owner-pays exclusion, and "migration 082 needed" before the table exists.
 * - Cash outlook: paid PO invoices leave the estimate, never double counted with a
 *   linked direct cost (067).
 * - Migrations 082 / 083 and page wiring (source checks, no React mount).
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
// Approve now emails the admin team (prompt 104): never a real send.
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
  }
})

const lib = require('../lib/po-invoices')
const { canMarkPOPaid } = require('../lib/po-invoice-auth')
const { invalidateCache } = require('../lib/permissions')
const { poPaymentRoute, REIMBURSEMENT, CHECK_TO_VENDOR } = require('../lib/payment-route')
const { poRemainingAmount, poCashOutByMonth, isOwnerCheckPO, summarizeOwnerCheckPOs } = require('../lib/po-cash')
const { poItems } = require('../lib/cash-outlook')
const { commercialDetailsUpdate, OPTIONAL_JOB_COLS } = require('../lib/job-details')
const route = require('../app/api/po-invoices/route')
const poRoute = require('../app/api/purchase-orders/route')

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const req = (method, body, url = '/api/po-invoices') => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async res => ({ status: res.status, body: await res.json() })

const PM = { userId: 'u-pm', role: 'pm', email: 'pm@nv.com' }
const PM_OTHER = { userId: 'u-pm2', role: 'pm', email: 'pm2@nv.com' }
const APM = { userId: 'u-apm', role: 'apm', email: 'apm@nv.com' }
const ADMIN = { userId: 'u-admin', role: 'admin', email: 'admin@nv.com' }
const OWNER = { userId: 'u-owner', role: 'principal', email: 'owner@nv.com' }
const SUPER = { userId: 'u-super', role: 'super', email: 'super@nv.com' }
const as = a => { mockState.auth = a }

const add = body => route.POST(req('POST', body)).then(json)
const patch = body => route.PATCH(req('PATCH', body)).then(json)
const del = body => route.DELETE(req('DELETE', body)).then(json)
const list = (q = '') => route.GET(req('GET', undefined, `/api/po-invoices${q}`)).then(json)
const inv = id => mockState.db.po_invoices.find(r => r.id === id)

function seed(extra = {}) {
  resetMockState({
    jobs: [
      { id: 'J1', job_number: '101', project_name: 'NV Job', po_payer: 'nv', pm_email: null },
      { id: 'J2', job_number: '202', project_name: "Braum's", po_payer: 'owner', pm_email: null },
    ],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'u-pm' },
      { id: 'a2', job_id: 'J1', user_id: 'u-apm' },
      { id: 'a3', job_id: 'J1', user_id: 'u-super' },
      { id: 'a4', job_id: 'J2', user_id: 'u-pm' },
    ],
    purchase_orders: [
      { id: 'P1', job_id: 'J1', po_number: 'PO-101-001', vendor_name: 'Lumber Co', amount: 1000, status: 'issued', payment_type: 'check', payer_override: null },
      { id: 'P2', job_id: 'J2', po_number: 'PO-202-001', vendor_name: 'Steel Co', amount: 500, status: 'received', payment_type: 'check', payer_override: null },
      { id: 'PD', job_id: 'J1', po_number: 'PO-101-002', vendor_name: 'Draft Co', amount: 50, status: 'draft', payment_type: 'check', payer_override: null },
    ],
    po_invoices: [],
    change_log: [],
    role_permissions: [{ role: 'admin', feature_key: 'po.mark_paid', enabled: true }],
    ...extra,
  })
  // Database defaults of po_invoices (migration 082).
  mockState.defaults.po_invoices = () => ({ paid_amount: 0, ready_to_pay: false, paid_by_owner: false, approved_at: null, approved_by: null, paid_at: null, source: 'app', check_number: null, payment_notes: null })
  invalidateCache()
}

beforeEach(() => seed())

// ── Pure rules ───────────────────────────────────────────────────────────────
describe('who pays: precedence', () => {
  test('per-PO override beats the job setting, job setting beats legacy payment_type', () => {
    const nvJob = { po_payer: 'nv' }, ownerJob = { po_payer: 'owner' }
    expect(lib.effectivePOPayer({ payment_type: 'check' }, nvJob)).toBe('nv') // default 'check' is not a choice
    expect(lib.effectivePOPayer({ payment_type: 'reimbursement' }, ownerJob)).toBe('owner')
    expect(lib.effectivePOPayer({ payer_override: 'nv', payment_type: 'check' }, ownerJob)).toBe('nv')
    expect(lib.effectivePOPayer({ payer_override: 'owner' }, nvJob)).toBe('owner')
    expect(lib.poPayerSource({ payer_override: 'owner' }, nvJob)).toBe('override')
    expect(lib.poPayerSource({}, nvJob)).toBe('job')
  })

  test('before migration 082 (no job po_payer, no override) the legacy payment_type rule is unchanged', () => {
    expect(lib.effectivePOPayer({ payment_type: 'reimbursement' }, {})).toBe('nv')
    expect(lib.effectivePOPayer({ payment_type: 'check' }, {})).toBe('owner')
    expect(lib.poPayerSource({ payment_type: 'check' }, {})).toBe('legacy')
    expect(poPaymentRoute({ payment_type: 'reimbursement' })).toBe(REIMBURSEMENT)
    expect(poPaymentRoute({ payment_type: 'check' })).toBe(CHECK_TO_VENDOR)
    expect(isOwnerCheckPO({ payment_type: 'check' })).toBe(true)
    // With the job setting: a default 'check' PO on an NV-pays job is NV's to pay.
    expect(poPaymentRoute({ payment_type: 'check' }, { po_payer: 'nv' })).toBe(REIMBURSEMENT)
    expect(isOwnerCheckPO({ payment_type: 'reimbursement' }, { po_payer: 'owner' })).toBe(true)
  })

  test('payment_type written to match the payer; override normalization', () => {
    expect(lib.paymentTypeForPayer('nv')).toBe('reimbursement')
    expect(lib.paymentTypeForPayer('owner')).toBe('check')
    expect(lib.normalizePayerOverride(undefined)).toBe(undefined)
    expect(lib.normalizePayerOverride('')).toBe(null)
    expect(lib.normalizePayerOverride('job')).toBe(null)
    expect(lib.normalizePayerOverride('owner')).toBe('owner')
    expect(lib.normalizePayerOverride('admin')).toBe('invalid')
  })
})

describe('due date default', () => {
  test('invoice date + 30 days, across month / year ends', () => {
    expect(lib.defaultDueDate('2026-11-20')).toBe('2026-12-20')
    expect(lib.defaultDueDate('2026-01-31')).toBe('2026-03-02')
    expect(lib.defaultDueDate('2026-12-15')).toBe('2027-01-14')
    expect(lib.defaultDueDate('bad')).toBe(null)
  })
  test('validateInvoiceInput fills the due date and checks fields', () => {
    expect(lib.validateInvoiceInput({ invoice_number: ' 77 ', invoice_date: '2026-11-01', amount: '1,250.50' }).fields)
      .toEqual({ invoice_number: '77', invoice_date: '2026-11-01', amount: 1250.5, due_date: '2026-12-01' })
    expect(lib.validateInvoiceInput({ invoice_number: '1', invoice_date: '2026-11-01', amount: 10, due_date: '2026-11-15' }).fields.due_date).toBe('2026-11-15')
    expect(lib.validateInvoiceInput({ invoice_number: '', invoice_date: '2026-11-01', amount: 10 }).error).toMatch(/Invoice #/)
    expect(lib.validateInvoiceInput({ invoice_number: '1', invoice_date: '2026-13-01', amount: 10 }).error).toMatch(/Invoice date/)
    expect(lib.validateInvoiceInput({ invoice_number: '1', invoice_date: '2026-11-01', amount: 0 }).error).toMatch(/more than \$0/)
    expect(lib.validateInvoiceInput({ invoice_number: '1', invoice_date: '2026-11-01', amount: 5, due_date: '2026-10-01' }).error).toMatch(/before the invoice date/)
  })
})

describe('statuses, partial pay, over amount', () => {
  const ready = { amount: 1000, paid_amount: 0, ready_to_pay: true, approved_at: '2026-11-01T00:00:00Z' }
  test('invoice and PO status', () => {
    expect(lib.invoiceStatus({ amount: 10, paid_amount: 0 }, 'nv')).toBe('needs_approval')
    expect(lib.invoiceStatus(ready, 'nv')).toBe('ready_to_pay')
    expect(lib.invoiceStatus({ ...ready, paid_amount: 400 }, 'nv')).toBe('ready_to_pay')
    expect(lib.invoiceStatus({ ...ready, paid_amount: 1000, paid_at: 'x' }, 'nv')).toBe('paid')
    // prompt 108: an approved invoice keeps NV as payer (was 'owner_to_pay' — the payer-switch bug)
    expect(lib.invoiceStatus(ready, 'owner')).toBe('ready_to_pay')
    expect(lib.invoiceStatus({ amount: 5, paid_by_owner: true }, 'owner')).toBe('paid_by_owner')
    expect(lib.poPaymentStatus([], 'nv')).toBe('no_invoice')
    expect(lib.poPaymentStatus([ready, { amount: 5 }], 'nv')).toBe('needs_approval')
    expect(lib.poPaymentStatus([ready, { ...ready, paid_at: 'x', paid_amount: 1000 }], 'nv')).toBe('ready_to_pay')
  })
  test('validatePayment: partial OK, overpay refused, check # required, default amount = remaining', () => {
    const p = lib.validatePayment({ ...ready, paid_amount: 250 }, { check_number: '1201', amount: '300' }, '2026-11-20')
    expect(p).toMatchObject({ amount: 300, newPaid: 550, settles: false, date: '2026-11-20' })
    expect(lib.validatePayment({ ...ready, paid_amount: 250 }, { check_number: '1202' }, '2026-11-20')).toMatchObject({ amount: 750, newPaid: 1000, settles: true })
    expect(lib.validatePayment(ready, { check_number: '1', amount: 1000.01 }, '2026-11-20').error).toMatch(/more than/)
    expect(lib.validatePayment(ready, { amount: 10 }, '2026-11-20').error).toMatch(/Check #/)
    expect(lib.validatePayment({ amount: 10, paid_amount: 0 }, { check_number: '1' }, '2026-11-20').error).toMatch(/not approved/)
    expect(lib.validatePayment({ ...ready, paid_at: 'x', paid_amount: 1000 }, { check_number: '1' }, '2026-11-20').error).toMatch(/already paid/)
    expect(lib.appendCheckNumber('1201', '1244')).toBe('1201, 1244')
    expect(lib.appendCheckNumber('1201, 1244', '1201')).toBe('1201, 1244')
  })
  test('over PO amount', () => {
    const po = { amount: 1000 }
    expect(lib.overPOAmount(po, [{ id: 'a', amount: 600 }], 400).over).toBe(false)
    expect(lib.overPOAmount(po, [{ id: 'a', amount: 600 }], 400.01)).toMatchObject({ over: true, total: 1000.01, by: 0.01 })
    expect(lib.overPOAmount(po, [{ id: 'a', amount: 600 }], 1000, 'a').over).toBe(false) // editing 'a' itself
  })
  test('admin rows: sorted by due date, overdue flagged, owner-pays never ready_to_pay', () => {
    const posById = { P1: { id: 'P1', job_id: 'J1', amount: 1 }, P2: { id: 'P2', job_id: 'J2', amount: 1 } }
    const jobsById = { J1: { id: 'J1', po_payer: 'nv' }, J2: { id: 'J2', po_payer: 'owner' } }
    const rows = lib.buildInvoiceRows([
      { id: 'late', po_id: 'P1', amount: 5, paid_amount: 0, ready_to_pay: true, approved_at: '2026-11-01T10:00:00Z', due_date: '2026-11-10' },
      { id: 'later', po_id: 'P1', amount: 5, paid_amount: 0, due_date: '2026-12-30', created_at: '2026-11-15T00:00:00Z' },
      // prompt 108: an untouched owner-pays invoice (an approved one is locked to NV — see prompt108 tests)
      { id: 'owner', po_id: 'P2', amount: 5, paid_amount: 0, due_date: '2026-11-01' },
    ], posById, jobsById, '2026-11-20')
    expect(rows.map(r => r.id)).toEqual(['owner', 'late', 'later'])
    expect(rows.find(r => r.id === 'owner').status).toBe('owner_to_pay')
    expect(rows.find(r => r.id === 'late')).toMatchObject({ status: 'ready_to_pay', overdue: true, days_waiting: 19 })
    expect(rows.find(r => r.id === 'later')).toMatchObject({ status: 'needs_approval', overdue: false, days_waiting: 5 })
    const sum = lib.summarizeInvoiceRows(rows)
    expect(sum.ready_to_pay).toEqual({ count: 1, total: 5, overdue: 1 })
    expect(sum.owner_to_pay.count).toBe(1)
  })
})

// ── Permissions ──────────────────────────────────────────────────────────────
describe('po.mark_paid permission', () => {
  test('Owner always; admin on by seed; pm off; a stored row wins over the default', async () => {
    expect(await canMarkPOPaid('principal')).toBe(true)
    expect(await canMarkPOPaid('admin')).toBe(true)
    expect(await canMarkPOPaid('pm')).toBe(false)
    expect(await canMarkPOPaid('super')).toBe(false)
    seed({ role_permissions: [{ role: 'admin', feature_key: 'po.mark_paid', enabled: false }, { role: 'pm', feature_key: 'po.mark_paid', enabled: true }] })
    expect(await canMarkPOPaid('admin')).toBe(false)
    expect(await canMarkPOPaid('pm')).toBe(true)
  })
  test('before the 082 seed (no row) admin still defaults on, others off', async () => {
    seed({ role_permissions: [] })
    expect(await canMarkPOPaid('admin')).toBe(true)
    expect(await canMarkPOPaid('apm')).toBe(false)
  })
  test('the permission is in both permission matrices', () => {
    for (const f of ['app/admin/page.js', 'app/dashboard/page.js']) expect(read(f)).toMatch(/key: 'po\.mark_paid'/)
  })
})

// ── API: add / approve / pay ─────────────────────────────────────────────────
const NEW = { po_id: 'P1', invoice_number: 'INV-9', invoice_date: '2026-11-01', amount: 400 }

describe('POST /api/po-invoices', () => {
  test('PM on the job adds an invoice: due date defaults to +30, needs approval, logged', async () => {
    as(PM)
    const r = await add(NEW)
    expect(r.status).toBe(200)
    expect(r.body.invoice).toMatchObject({ due_date: '2026-12-01', status: 'needs_approval', created_by: 'u-pm' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ entity_type: 'po_invoice', entity_id: r.body.invoice.id, job_id: 'J1' })
  })
  test('refused: PM not on the job, draft PO, bad input', async () => {
    as(PM_OTHER)
    expect((await add(NEW)).status).toBe(403)
    as(PM)
    expect((await add({ ...NEW, po_id: 'PD' })).status).toBe(409)
    expect((await add({ ...NEW, amount: -5 })).status).toBe(400)
  })
  test('over the PO amount needs an Owner override with a note', async () => {
    as(PM)
    expect((await add({ ...NEW, amount: 900 })).status).toBe(200)
    const over = await add({ ...NEW, invoice_number: 'INV-10', amount: 200 })
    expect(over.status).toBe(409)
    expect(over.body.needs_owner_override).toBe(true)
    expect((await add({ ...NEW, invoice_number: 'INV-10', amount: 200, override_note: 'PM says ok' })).status).toBe(409) // PM can't override
    as(OWNER)
    expect((await add({ ...NEW, invoice_number: 'INV-10', amount: 200 })).status).toBe(409) // Owner still needs a note
    const ok = await add({ ...NEW, invoice_number: 'INV-10', amount: 200, override_note: 'Freight added' })
    expect(ok.status).toBe(200)
    expect(ok.body.invoice).toMatchObject({ over_po_override_by: 'u-owner', over_po_override_note: 'Freight added' })
  })
})

describe('approve: PM/APM on the job or an Owner — never admin', () => {
  let id
  beforeEach(async () => { as(PM); id = (await add(NEW)).body.invoice.id })

  test('admin cannot approve (even though admin sees every job)', async () => {
    as(ADMIN)
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/PM \/ APM or an Owner/)
    expect(inv(id).ready_to_pay).toBe(false)
  })
  test('super on the job and a PM on another job cannot approve', async () => {
    as(SUPER)
    expect((await patch({ id, action: 'approve' })).status).toBe(403)
    as(PM_OTHER)
    expect((await patch({ id, action: 'approve' })).status).toBe(403)
  })
  test('APM on the job approves → Ready to pay; approving twice is refused', async () => {
    as(APM)
    const r = await patch({ id, action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.invoice).toMatchObject({ status: 'ready_to_pay', approved_by: 'u-apm', ready_to_pay: true })
    expect((await patch({ id, action: 'approve' })).status).toBe(409)
  })
  test('an Owner approves any job', async () => {
    as(OWNER)
    expect((await patch({ id, action: 'approve' })).status).toBe(200)
  })
  test('received is not required: an issued PO\'s invoice is approved and paid', async () => {
    expect(mockState.db.purchase_orders.find(p => p.id === 'P1').status).toBe('issued')
    as(PM); await patch({ id, action: 'approve' })
    as(ADMIN)
    expect((await patch({ id, action: 'mark_paid', check_number: '5001' })).body.invoice.status).toBe('paid')
  })
})

describe('mark paid (po.mark_paid) — partial pay and double-pay guards', () => {
  let id
  beforeEach(async () => {
    as(PM); id = (await add(NEW)).body.invoice.id
  })
  test('not approved yet → refused', async () => {
    as(ADMIN)
    expect((await patch({ id, action: 'mark_paid', check_number: '1' })).status).toBe(409)
  })
  test('PM without the permission cannot mark paid', async () => {
    as(PM); await patch({ id, action: 'approve' })
    const r = await patch({ id, action: 'mark_paid', check_number: '1' })
    expect(r.status).toBe(403)
    expect(inv(id).paid_amount).toBe(0)
  })
  test('partial check keeps the rest Ready to pay; the second check settles it; a third is refused', async () => {
    as(PM); await patch({ id, action: 'approve' })
    as(ADMIN)
    const first = await patch({ id, action: 'mark_paid', check_number: '1201', amount: 150, paid_on: '2026-11-18' })
    expect(first.status).toBe(200)
    expect(first.body.invoice).toMatchObject({ status: 'ready_to_pay', paid_amount: 150, paid_at: null, last_payment_date: '2026-11-18', check_number: '1201' })
    expect(lib.invoiceRemaining(inv(id))).toBe(250)
    expect((await patch({ id, action: 'mark_paid', check_number: '1202', amount: 250.01 })).status).toBe(400) // over remaining
    const second = await patch({ id, action: 'mark_paid', check_number: '1202' }) // default = remaining
    expect(second.body.invoice).toMatchObject({ status: 'paid', paid_amount: 400, check_number: '1201, 1202' })
    expect(second.body.invoice.paid_at).toBeTruthy()
    expect((await patch({ id, action: 'mark_paid', check_number: '1203', amount: 1 })).status).toBe(409)
    expect(mockState.db.change_log.filter(c => c.entity_id === id && c.field_name === 'payment')).toHaveLength(2)
  })
  test('a check recorded by someone else between read and write is not recorded twice', async () => {
    as(PM); await patch({ id, action: 'approve' })
    as(ADMIN)
    mockState.beforeWrite = (table, op) => {
      if (table === 'po_invoices' && op === 'update') { mockState.beforeWrite = null; inv(id).paid_amount = 400; inv(id).paid_at = 'now' }
    }
    const r = await patch({ id, action: 'mark_paid', check_number: '7' })
    expect(r.status).toBe(409)
    expect(inv(id).paid_amount).toBe(400)
  })
})

describe('send back (reason required)', () => {
  test('admin sends a Ready to pay invoice back; it needs approval again with the reason', async () => {
    as(PM); const { id } = (await add(NEW)).body.invoice
    await patch({ id, action: 'approve' })
    as(ADMIN)
    expect((await patch({ id, action: 'send_back', reason: '  ' })).status).toBe(400)
    const r = await patch({ id, action: 'send_back', reason: 'Wrong amount' })
    expect(r.body.invoice).toMatchObject({ status: 'needs_approval', ready_to_pay: false, approved_at: null, sent_back_reason: 'Wrong amount', sent_back_by: 'u-admin' })
    // Re-approval clears the sent-back note.
    as(PM)
    expect((await patch({ id, action: 'approve' })).body.invoice.sent_back_reason).toBe(null)
  })
  test('a partly paid invoice cannot be sent back; a super cannot send back', async () => {
    as(PM); const { id } = (await add(NEW)).body.invoice
    as(SUPER)
    expect((await patch({ id, action: 'send_back', reason: 'x' })).status).toBe(403)
    as(PM); await patch({ id, action: 'approve' })
    as(ADMIN); await patch({ id, action: 'mark_paid', check_number: '1', amount: 10 })
    expect((await patch({ id, action: 'send_back', reason: 'x' })).status).toBe(409)
  })
})

describe('owner-pays jobs stay off the admin check list', () => {
  test('invoice on an owner-pays job: no approve / mark paid; PM marks it paid by owner', async () => {
    as(PM)
    const { id, status } = (await add({ po_id: 'P2', invoice_number: 'B-1', invoice_date: '2026-11-01', amount: 500 })).body.invoice
    expect(status).toBe('owner_to_pay')
    expect((await patch({ id, action: 'approve' })).status).toBe(409)
    as(ADMIN)
    expect((await patch({ id, action: 'mark_paid', check_number: '1' })).status).toBe(409)
    const l = await list()
    expect(l.body.invoices.find(i => i.id === id).status).toBe('owner_to_pay')
    expect(l.body.summary.ready_to_pay.count).toBe(0)
    expect((await patch({ id, action: 'mark_paid_by_owner' })).status).toBe(403) // admin is not an approver
    as(PM)
    expect((await patch({ id, action: 'mark_paid_by_owner', paid_on: '2026-11-19' })).body.invoice.status).toBe('paid_by_owner')
  })
  test('a per-PO override puts one PO on an owner-pays job back on the NV list', async () => {
    mockState.db.purchase_orders.find(p => p.id === 'P2').payer_override = 'nv'
    as(PM)
    const { id, status } = (await add({ po_id: 'P2', invoice_number: 'B-2', invoice_date: '2026-11-01', amount: 100 })).body.invoice
    expect(status).toBe('needs_approval')
    expect((await patch({ id, action: 'approve' })).body.invoice.status).toBe('ready_to_pay')
  })
})

describe('GET lists, delete, migration 082 not applied', () => {
  test('company-wide list is Owner/admin only; job list returns what the caller can do', async () => {
    as(PM); await add(NEW)
    expect((await list()).status).toBe(403)
    const j = await list('?job_id=J1')
    expect(j.body.can).toEqual({ approve: true, mark_paid: false })
    expect(j.body.job_payer).toBe('nv')
    as(ADMIN)
    const a = await list()
    expect(a.status).toBe(200)
    expect(a.body.can).toEqual({ approve: false, mark_paid: true })
    expect(a.body.invoices[0]).toMatchObject({ po: { po_number: 'PO-101-001', vendor_name: 'Lumber Co' }, job: { job_number: '101' }, has_attachment: false })
  })
  test('delete only while unapproved and unpaid', async () => {
    as(PM); const { id } = (await add(NEW)).body.invoice
    await patch({ id, action: 'approve' })
    expect((await del({ id })).status).toBe(409)
    await patch({ id, action: 'send_back', reason: 'redo' })
    expect((await del({ id })).status).toBe(200)
    expect(mockState.db.po_invoices).toHaveLength(0)
  })
  test('before 082: friendly message, no crash', async () => {
    mockState.failSelect.po_invoices = 'relation "public.po_invoices" does not exist'
    as(PM)
    const j = await list('?job_id=J1')
    expect(j.status).toBe(200)
    expect(j.body).toMatchObject({ invoices: [], migration_required: '082' })
    const r = await add(NEW)
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/migration 082/)
    as(ADMIN)
    expect((await list()).body.migration_required).toBe('082')
  })
})

// ── Cash outlook: no double count with 067 ───────────────────────────────────
describe('cash outlook', () => {
  const jobsById = { J1: { id: 'J1', po_payer: 'nv' }, J2: { id: 'J2', po_payer: 'owner' } }
  const po = { id: 'P1', job_id: 'J1', status: 'issued', amount: 1000, issued_date: '2026-11-01', payment_type: 'check' }
  test('paid PO invoices leave the estimate; a linked direct cost for the same payment is not subtracted again', () => {
    expect(poRemainingAmount(po, [], 300)).toBe(700)
    expect(poRemainingAmount(po, [{ status: 'approved', amount: 300 }], 300)).toBe(700) // same $300, once
    expect(poRemainingAmount(po, [{ status: 'approved', amount: 500 }], 300)).toBe(500) // larger record wins
    expect(poRemainingAmount(po, [], 1200)).toBe(0)
    const r = poItems({ jobsById, pos: [po], directCosts: [{ id: 'd', purchase_order_id: 'P1', status: 'approved', amount: 300 }], invoicePaidByPO: { P1: 300 } })
    expect(r.items[0].amount).toBe(700)
    const paidOff = poItems({ jobsById, pos: [po], invoicePaidByPO: { P1: 1000 } })
    expect(paidOff.items).toHaveLength(0)
  })
  test('the job setting decides NV cash out: default-check PO on an NV job counts, owner-pays job is disclosed', () => {
    const r = poItems({ jobsById, pos: [po, { ...po, id: 'P2', job_id: 'J2', amount: 500 }] })
    expect(r.items.map(i => i.id)).toEqual(['po-P1'])
    expect(r.ownerCheck).toEqual({ total: 500, count: 1 })
    expect(poCashOutByMonth([po], [], { job: jobsById.J1, invoicePaidByPO: { P1: 250 } })).toEqual({ '2026-11': 750 })
    expect(summarizeOwnerCheckPOs([po], { job: jobsById.J2 })).toEqual({ count: 1, total: 1000 })
  })
  test('owner-paid invoices are not NV cash', () => {
    const posById = { P1: { id: 'P1', job_id: 'J1' }, P2: { id: 'P2', job_id: 'J2' } }
    expect(lib.paidInvoiceAmountByPO([{ po_id: 'P1', paid_amount: 100 }, { po_id: 'P1', paid_amount: 50.5 }, { po_id: 'P2', paid_amount: 500, paid_by_owner: true }], posById, jobsById)).toEqual({ P1: 150.5 }) // prompt 108: P2 row is an owner-paid row (NV checks now count per invoice)
  })
  test('outlook route probes 082 and passes paid invoice amounts', () => {
    const src = read('app/api/cash-outlook/route.js')
    expect(src).toMatch(/hasColumn\('po_invoices', 'paid_amount'\)/)
    expect(src).toMatch(/hasColumn\('purchase_orders', 'payer_override'\)/)
    expect(src).toMatch(/paidInvoiceAmountByPO\(/)
  })
})

// ── Job setting + PO override on the PO API ─────────────────────────────────
describe('job "who pays vendors" setting and per-PO override', () => {
  test('Job Details validates po_payer; optional column before 082', () => {
    expect(commercialDetailsUpdate({ po_payer: 'owner' }).fields.po_payer).toBe('owner')
    expect(commercialDetailsUpdate({ po_payer: '' }).fields.po_payer).toBe(undefined)
    expect(commercialDetailsUpdate({ po_payer: 'sub' }).error).toMatch(/Who pays vendors/)
    expect(OPTIONAL_JOB_COLS).toContain('po_payer')
  })
  test('PO PUT stores the override and keeps payment_type in step with the payer', async () => {
    as(PM)
    const r = await poRoute.PUT(req('PUT', { id: 'P1', payer_override: 'owner' }, '/api/purchase-orders')).then(json)
    expect(r.status).toBe(200)
    expect(mockState.db.purchase_orders.find(p => p.id === 'P1')).toMatchObject({ payer_override: 'owner', payment_type: 'check' })
    await poRoute.PUT(req('PUT', { id: 'P1', payer_override: '' }, '/api/purchase-orders'))
    expect(mockState.db.purchase_orders.find(p => p.id === 'P1')).toMatchObject({ payer_override: null, payment_type: 'reimbursement' })
    expect((await poRoute.PUT(req('PUT', { id: 'P1', payer_override: 'bogus' }, '/api/purchase-orders'))).status).toBe(400)
  })
  test('PO PUT before 082: override dropped with a warning, rest saved', async () => {
    mockState.missingSelectCols.purchase_orders = ['payer_override']
    as(PM)
    const r = await poRoute.PUT(req('PUT', { id: 'P1', payer_override: 'owner', notes: 'kept' }, '/api/purchase-orders')).then(json)
    expect(r.status).toBe(200)
    expect(r.body.warning).toMatch(/migration 082/)
    expect(mockState.db.purchase_orders.find(p => p.id === 'P1')).toMatchObject({ notes: 'kept', payer_override: null })
  })
})

// ── Migrations + wiring ──────────────────────────────────────────────────────
describe('migrations 082 / 083', () => {
  const m082 = read('supabase/migrations/082_po_invoices_ready_to_pay.sql')
  const m083 = read('supabase/migrations/083_po_backfill_paid_closed_draws.sql')
  test('082: table, columns, job + override columns, RLS, seed, rollback', () => {
    for (const col of ['po_id', 'invoice_number', 'invoice_date', 'amount', 'file_url', 'due_date', 'approved_by', 'approved_at', 'ready_to_pay', 'paid_at', 'paid_amount', 'check_number', 'payment_notes', 'sent_back_reason', 'sent_back_at', 'sent_back_by', 'created_by', 'created_at']) {
      expect(m082).toMatch(new RegExp(`\\n  ${col}\\s`))
    }
    expect(m082).toMatch(/CREATE TABLE IF NOT EXISTS public\.po_invoices/)
    expect(m082).toMatch(/REFERENCES public\.purchase_orders\(id\)/)
    expect(m082).toMatch(/NEW\.due_date := NEW\.invoice_date \+ 30/)
    expect(m082).toMatch(/ADD COLUMN IF NOT EXISTS po_payer text NOT NULL DEFAULT 'nv'/)
    expect(m082).toMatch(/ADD COLUMN IF NOT EXISTS payer_override text/)
    expect(m082).toMatch(/ALTER TABLE public\.po_invoices ENABLE ROW LEVEL SECURITY/)
    expect(m082).toMatch(/\('admin', 'po\.mark_paid', true\)/)
    expect(m082).toMatch(/-- ROLLBACK/)
  })
  test('083: received POs on closed draws, idempotent, tagged, commented rollback', () => {
    expect(m083).toMatch(/po\.status = 'received'/)
    expect(m083).toMatch(/JOIN public\.draw_requests d ON d\.id = po\.draw_request_id/)
    expect(m083).toMatch(/d\.status = 'closed'/)
    expect(m083).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.po_invoices i WHERE i\.po_id = po\.id\)/)
    expect(m083).toMatch(/'backfill_083'/)
    expect(m083).toMatch(/-- DELETE FROM public\.po_invoices WHERE source = 'backfill_083';/)
    expect(m083).toMatch(/SELECT count\(\*\)/)
  })
})

describe('page wiring', () => {
  test('job page: invoices panel, payment badge + filter, job setting, payer-aware cash', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).toMatch(/<POInvoicesPanel /)
    expect(page).toMatch(/<POPaymentBadge /)
    expect(page).toMatch(/poPayFilter/)
    expect(page).toMatch(/Who pays vendors \(POs\)/)
    expect(page).toMatch(/poPaymentRoute\(po, job\)/)
  })
  test('admin Orders tab: Ready to pay is the default view, with chips and mark paid', () => {
    const admin = read('app/admin/page.js')
    expect(admin).toMatch(/useState\('ready_to_pay'\)/)
    expect(admin).toMatch(/'Needs approval'/)
    expect(admin).toMatch(/action: 'mark_paid'/)
    expect(admin).toMatch(/Days waiting/)
  })
  test('upload target for the invoice PDF', () => {
    expect(read('lib/file-upload-server.js')).toMatch(/'po-invoice':\s+\{ bucket: 'purchase-order-docs'/)
    expect(read('lib/upload-guards.js')).toMatch(/async 'po-invoice'\(db, auth, body\)/)
  })
})
