/**
 * Prompt 108: PO invoice payer lock — switching who pays (job "Who pays vendors (POs)" or a
 * PO's own "who pays") never rewrites invoices that were already approved / paid.
 * - lib/po-invoices.js: lockedInvoicePayer / isInvoiceLocked / invoicePayer, invoiceStatus
 *   honours the lock, buildInvoiceRows payer_kept, paidInvoiceAmountByPO per invoice,
 *   payerChangeImpact / payerChangeMessage.
 * - /api/po-invoices PATCH reads the invoice's own payer; mark_paid_by_owner refuses NV money.
 * - /api/jobs/details and /api/purchase-orders PUT: 409 needs_payer_confirm until applyTo
 *   'new_only' (lib/po-payer-change.js), nothing written before the confirm.
 * - Page wiring (source checks, no React mount). No migration.
 * All data is in memory (tests/helpers/mock-db.js). Nothing real is written.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
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
const { payerChangeGuard } = require('../lib/po-payer-change')
const { invalidateCache } = require('../lib/permissions')
const route = require('../app/api/po-invoices/route')
const poRoute = require('../app/api/purchase-orders/route')
const details = require('../app/api/jobs/details/route')

const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const req = (method, body, url = '/api/po-invoices') => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const json = async res => ({ status: res.status, body: await res.json() })

const PM = { userId: 'u-pm', role: 'pm', email: 'pm@nv.com' }
const ADMIN = { userId: 'u-admin', role: 'admin', email: 'admin@nv.com' }
const OWNER = { userId: 'u-owner', role: 'principal', email: 'owner@nv.com' }
const as = a => { mockState.auth = a }

const patch = body => route.PATCH(req('PATCH', body)).then(json)
const saveJob = body => details.POST(req('POST', body, '/api/jobs/details')).then(json)
const putPO = body => poRoute.PUT(req('PUT', body, '/api/purchase-orders')).then(json)
const inv = id => mockState.db.po_invoices.find(r => r.id === id)
const job = id => mockState.db.jobs.find(j => j.id === id)
const po = id => mockState.db.purchase_orders.find(p => p.id === id)

// Invoice row shapes (defaults of migration 082).
const BASE = { amount: 1000, paid_amount: 0, ready_to_pay: false, paid_by_owner: false, approved_at: null, approved_by: null, paid_at: null, check_number: null, payment_notes: null, invoice_number: 'X', invoice_date: '2026-11-01', due_date: '2026-12-01' }
const OPEN = { ...BASE }
const APPROVED = { ...BASE, ready_to_pay: true, approved_at: '2026-11-02T00:00:00Z', approved_by: 'u-pm' }
const PARTLY = { ...APPROVED, paid_amount: 400, check_number: '1201' }
const PAID_CHECK = { ...APPROVED, paid_amount: 1000, check_number: '1202', paid_at: '2026-11-10T00:00:00Z' }
const PAID_OWNER = { ...BASE, paid_by_owner: true, paid_at: '2026-11-10T00:00:00Z' }
const B083_OWNER = { ...BASE, paid_by_owner: true, approved_at: '2026-10-01T00:00:00Z', ready_to_pay: false, paid_amount: 1000, paid_at: '2026-10-01T00:00:00Z' }
const B083_NV = { ...BASE, ready_to_pay: true, approved_at: '2026-10-01T00:00:00Z', paid_amount: 1000, paid_at: '2026-10-01T00:00:00Z' }
const SENT_BACK = { ...BASE, sent_back_reason: 'wrong amount', sent_back_at: '2026-11-03T00:00:00Z' }

function seed(extra = {}) {
  resetMockState({
    jobs: [
      { id: 'J1', job_number: '101', project_name: 'NV Job', po_payer: 'nv', pm_email: null },
      { id: 'J2', job_number: '202', project_name: 'Owner Job', po_payer: 'owner', pm_email: null },
    ],
    pm_job_assignments: [
      { id: 'a1', job_id: 'J1', user_id: 'u-pm' },
      { id: 'a2', job_id: 'J2', user_id: 'u-pm' },
    ],
    purchase_orders: [
      { id: 'P1', job_id: 'J1', po_number: 'PO-101-001', vendor_name: 'Lumber Co', amount: 5000, status: 'issued', payment_type: 'reimbursement', payer_override: null },
      { id: 'P1B', job_id: 'J1', po_number: 'PO-101-002', vendor_name: 'Paint Co', amount: 5000, status: 'issued', payment_type: 'check', payer_override: 'owner' },
      { id: 'P2', job_id: 'J2', po_number: 'PO-202-001', vendor_name: 'Steel Co', amount: 5000, status: 'issued', payment_type: 'check', payer_override: null },
    ],
    po_invoices: [],
    purchase_order_items: [],
    change_log: [],
    role_permissions: [{ role: 'admin', feature_key: 'po.mark_paid', enabled: true }],
    ...extra,
  })
  mockState.defaults.po_invoices = () => ({ paid_amount: 0, ready_to_pay: false, paid_by_owner: false, approved_at: null, approved_by: null, paid_at: null, source: 'app', check_number: null, payment_notes: null })
  invalidateCache()
}
beforeEach(() => seed())

const addInv = (id, po_id, shape) => mockState.db.po_invoices.push({ ...shape, id, po_id, invoice_number: id })

// ── 1. Lock ──────────────────────────────────────────────────────────────────
describe('lockedInvoicePayer / isInvoiceLocked / invoicePayer', () => {
  const nvPO = { payer_override: null }, nvJob = { po_payer: 'nv' }, ownerJob = { po_payer: 'owner' }
  test.each([
    ['open', OPEN, null],
    ['approved', APPROVED, 'nv'],
    ['ready_to_pay only', { ...BASE, ready_to_pay: true }, 'nv'],
    ['partly paid', PARTLY, 'nv'],
    ['paid by check', PAID_CHECK, 'nv'],
    ['paid_at only', { ...BASE, paid_at: 'x' }, 'nv'],
    ['paid by owner', PAID_OWNER, 'owner'],
    ['083 owner backfill', B083_OWNER, 'owner'],
    ['083 NV backfill', B083_NV, 'nv'],
    ['sent back', SENT_BACK, null],
  ])('%s', (_n, row, want) => {
    expect(lib.lockedInvoicePayer(row)).toBe(want)
    expect(lib.isInvoiceLocked(row)).toBe(want !== null)
    expect(lib.invoicePayer(row, nvPO, ownerJob)).toBe(want ?? 'owner')
    expect(lib.invoicePayer(row, nvPO, nvJob)).toBe(want ?? 'nv')
  })
  test('null / undefined invoice is unlocked', () => {
    expect(lib.lockedInvoicePayer(null)).toBe(null)
    expect(lib.isInvoiceLocked(undefined)).toBe(false)
    expect(lib.PAYER_APPLY_NEW_ONLY).toBe('new_only')
  })
})

// ── 2. invoiceStatus ─────────────────────────────────────────────────────────
describe('invoiceStatus honours the lock', () => {
  test('locked rows keep their status after a payer flip', () => {
    expect(lib.invoiceStatus(APPROVED, 'owner')).toBe('ready_to_pay')
    expect(lib.invoiceStatus(PARTLY, 'owner')).toBe('ready_to_pay')
    expect(lib.invoiceStatus(PAID_CHECK, 'owner')).toBe('paid')
    expect(lib.invoiceStatus(PAID_OWNER, 'nv')).toBe('paid_by_owner')
    expect(lib.invoiceStatus(B083_OWNER, 'nv')).toBe('paid_by_owner')
    expect(lib.invoiceStatus(B083_NV, 'owner')).toBe('paid')
  })
  test('unlocked rows follow the payer', () => {
    expect(lib.invoiceStatus(OPEN, 'owner')).toBe('owner_to_pay')
    expect(lib.invoiceStatus(OPEN, 'nv')).toBe('needs_approval')
    expect(lib.invoiceStatus(SENT_BACK, 'owner')).toBe('owner_to_pay')
    expect(lib.invoiceStatus(SENT_BACK, 'nv')).toBe('needs_approval')
  })
})

// ── 3. buildInvoiceRows ──────────────────────────────────────────────────────
describe('buildInvoiceRows', () => {
  test('after a job flip to owner: locked row keeps NV, payer_source invoice, payer_kept; open row follows', () => {
    const posById = { P1: { id: 'P1', job_id: 'J1' } }
    const jobsById = { J1: { id: 'J1', po_payer: 'owner' } }
    const rows = lib.buildInvoiceRows([{ ...APPROVED, id: 'a', po_id: 'P1' }, { ...OPEN, id: 'o', po_id: 'P1' }], posById, jobsById, '2026-11-20')
    expect(rows.find(r => r.id === 'a')).toMatchObject({ payer: 'nv', payer_source: 'invoice', payer_kept: true, status: 'ready_to_pay' })
    expect(rows.find(r => r.id === 'o')).toMatchObject({ payer: 'owner', payer_source: 'job', payer_kept: false, status: 'owner_to_pay' })
  })
  test('locked row matching the current setting is not "kept"', () => {
    const rows = lib.buildInvoiceRows([{ ...APPROVED, id: 'a', po_id: 'P1' }], { P1: { id: 'P1', job_id: 'J1' } }, { J1: { po_payer: 'nv' } }, '2026-11-20')
    expect(rows[0]).toMatchObject({ payer: 'nv', payer_source: 'invoice', payer_kept: false })
  })
})

// ── 4. paidInvoiceAmountByPO ─────────────────────────────────────────────────
describe('paidInvoiceAmountByPO', () => {
  test('NV checks still count after the PO flips to owner; owner-paid rows excluded', () => {
    const posById = { P1: { id: 'P1', job_id: 'J1', payer_override: 'owner' }, P2: { id: 'P2', job_id: 'J2' } }
    const jobsById = { J1: { po_payer: 'nv' }, J2: { po_payer: 'nv' } }
    const out = lib.paidInvoiceAmountByPO([
      { ...PARTLY, po_id: 'P1' },
      { ...B083_OWNER, po_id: 'P2' },
      { ...PAID_OWNER, po_id: 'P2' },
    ], posById, jobsById)
    expect(out).toEqual({ P1: 400 })
  })
})

// ── 5. Impact / message ──────────────────────────────────────────────────────
describe('payerChangeImpact / payerChangeMessage', () => {
  test('impact counts', () => {
    expect(lib.payerChangeImpact([APPROVED, PAID_CHECK, PAID_OWNER, OPEN, SENT_BACK], 'owner')).toEqual({ locked_keep: 2, open_move: 2, locked_total: 3 })
    expect(lib.payerChangeImpact([APPROVED], 'nv')).toEqual({ locked_keep: 0, open_move: 0, locked_total: 1 })
    expect(lib.payerChangeImpact([], 'nv')).toEqual({ locked_keep: 0, open_move: 0, locked_total: 0 })
  })
  test('message wording, singular / plural, with and without open invoices', () => {
    expect(lib.payerChangeMessage({ locked_keep: 1, open_move: 0 }, 'owner', 'job'))
      .toBe('1 approved or paid invoice on this job will keep its current payer. "Owner pays vendors directly" will apply to new invoices. Apply to new invoices only?')
    expect(lib.payerChangeMessage({ locked_keep: 2, open_move: 1 }, 'nv', 'po'))
      .toBe('2 approved or paid invoices on this PO will keep their current payer. "NV pays vendors" will apply to new invoices and 1 not-yet-approved invoice. Apply to new invoices only?')
    expect(lib.payerChangeMessage({ locked_keep: 1, open_move: 3 }, 'owner', 'job'))
      .toMatch(/and 3 not-yet-approved invoices\. Apply/)
  })
})

// ── 6. /api/po-invoices PATCH ────────────────────────────────────────────────
describe('/api/po-invoices PATCH after a payer flip', () => {
  test('job flipped to owner: approved invoice can still be mark_paid by NV', async () => {
    addInv('i1', 'P1', APPROVED)
    job('J1').po_payer = 'owner'
    as(ADMIN)
    const r = await patch({ id: 'i1', action: 'mark_paid', check_number: '9' })
    expect(r.status).toBe(200)
    expect(r.body.invoice.status).toBe('paid')
  })
  test('job flipped to owner: mark_paid_by_owner on a partly NV-paid invoice → 409, nothing written', async () => {
    addInv('i1', 'P1', PARTLY)
    job('J1').po_payer = 'owner'
    as(PM)
    const r = await patch({ id: 'i1', action: 'mark_paid_by_owner' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/NV has already recorded \$400\.00 in checks on this invoice \(check 1201\)/)
    expect(inv('i1').paid_by_owner).toBe(false)
  })
  test('job flipped to owner: approved unpaid invoice → 409 "Send it back first"', async () => {
    addInv('i1', 'P1', APPROVED)
    job('J1').po_payer = 'owner'
    as(PM)
    const r = await patch({ id: 'i1', action: 'mark_paid_by_owner' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/Send it back first/)
  })
  test('job flipped to owner: open invoice follows and can be marked paid by the owner', async () => {
    addInv('i1', 'P1', OPEN)
    job('J1').po_payer = 'owner'
    as(PM)
    const r = await patch({ id: 'i1', action: 'mark_paid_by_owner' })
    expect(r.status).toBe(200)
    expect(r.body.invoice.status).toBe('paid_by_owner')
  })
  test('job flipped to nv: paid_by_owner invoice cannot be approved or mark_paid', async () => {
    addInv('i2', 'P2', PAID_OWNER)
    job('J2').po_payer = 'nv'
    as(PM)
    const a = await patch({ id: 'i2', action: 'approve' })
    expect(a.status).toBe(409)
    expect(inv('i2').ready_to_pay).toBe(false)
    as(ADMIN)
    expect((await patch({ id: 'i2', action: 'mark_paid', check_number: '1' })).status).toBe(409)
    const rows = lib.buildInvoiceRows(mockState.db.po_invoices, { P2: po('P2') }, { J2: job('J2') }, '2026-11-20')
    expect(rows[0]).toMatchObject({ status: 'paid_by_owner', payer: 'owner', payer_kept: true })
  })
  test('owner open invoice, job flipped to nv: becomes needs_approval and can be approved', async () => {
    addInv('i2', 'P2', OPEN)
    job('J2').po_payer = 'nv'
    as(PM)
    const r = await patch({ id: 'i2', action: 'approve' })
    expect(r.status).toBe(200)
    expect(r.body.invoice.status).toBe('ready_to_pay')
  })
})

// ── 7. /api/jobs/details ─────────────────────────────────────────────────────
describe('/api/jobs/details po_payer change', () => {
  test('nv → owner with a locked NV invoice: 409, job not updated; new_only: 200, invoice unchanged', async () => {
    addInv('i1', 'P1', APPROVED)
    addInv('i2', 'P1', OPEN)
    addInv('i3', 'P1B', APPROVED) // PO with its own override: not counted
    as(OWNER)
    const r = await saveJob({ id: 'J1', fields: { po_payer: 'owner' } })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ needs_payer_confirm: true, locked_invoices: 1, open_invoices: 1, new_payer: 'owner' })
    expect(r.body.error).toMatch(/^1 approved or paid invoice on this job will keep its current payer\./)
    expect(job('J1').po_payer).toBe('nv')

    for (const applyTo of ['all', true, undefined]) {
      expect((await saveJob({ id: 'J1', fields: { po_payer: 'owner' }, applyTo })).status).toBe(409)
    }
    expect(job('J1').po_payer).toBe('nv')

    const ok = await saveJob({ id: 'J1', fields: { po_payer: 'owner' }, applyTo: 'new_only' })
    expect(ok.status).toBe(200)
    expect(job('J1').po_payer).toBe('owner')
    expect(lib.invoiceStatus(inv('i1'), lib.effectivePOPayer(po('P1'), job('J1')))).toBe('ready_to_pay')
    expect(lib.invoiceStatus(inv('i2'), lib.effectivePOPayer(po('P1'), job('J1')))).toBe('owner_to_pay')
    const log = mockState.db.change_log.find(c => c.field_name === 'po_payer')
    expect(log.note).toMatch(/1 approved\/paid invoice\(s\) kept their payer/)
    expect(log.note).toMatch(/1 open invoice\(s\) moved/)

    // Switching back: the locked invoice already matches 'nv' → no 409.
    expect((await saveJob({ id: 'J1', fields: { po_payer: 'nv' } })).status).toBe(200)
  })
  test('only the override PO has locked invoices → straight through', async () => {
    addInv('i3', 'P1B', APPROVED)
    as(OWNER)
    expect((await saveJob({ id: 'J1', fields: { po_payer: 'owner' } })).status).toBe(200)
  })
  test('open invoices only → no 409', async () => {
    addInv('i2', 'P1', OPEN)
    as(OWNER)
    expect((await saveJob({ id: 'J1', fields: { po_payer: 'owner' } })).status).toBe(200)
  })
  test('no invoices → 200', async () => {
    as(OWNER)
    expect((await saveJob({ id: 'J1', fields: { po_payer: 'owner' } })).status).toBe(200)
    expect(job('J1').po_payer).toBe('owner')
  })
  test('po_invoices table missing → guard is a no-op', async () => {
    addInv('i1', 'P1', APPROVED)
    mockState.failSelect.po_invoices = 'relation "public.po_invoices" does not exist'
    as(OWNER)
    expect((await saveJob({ id: 'J1', fields: { po_payer: 'owner' } })).status).toBe(200)
  })
  test('guard helper: empty PO list and non-missing errors', async () => {
    const { createClient } = require('@supabase/supabase-js')
    const db = createClient('u', 'k')
    expect(await payerChangeGuard(db, { poIds: [], newPayer: 'owner', scope: 'job' })).toEqual({ ok: true, impact: { locked_keep: 0, open_move: 0, locked_total: 0 } })
    mockState.failSelect.po_invoices = 'boom'
    const g = await payerChangeGuard(db, { poIds: ['P1'], newPayer: 'owner', scope: 'job' })
    expect(g.ok).toBe(false)
    expect(g.response.status).toBe(500)
  })
})

// ── 8. /api/purchase-orders PUT ──────────────────────────────────────────────
describe('/api/purchase-orders PUT payer_override', () => {
  test("'' → 'owner' on an NV job with a paid invoice: 409 and nothing written; new_only saves", async () => {
    addInv('i1', 'P1', PAID_CHECK)
    as(PM)
    const r = await putPO({ id: 'P1', payer_override: 'owner', notes: 'changed' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ needs_payer_confirm: true, locked_invoices: 1, open_invoices: 0, new_payer: 'owner' })
    expect(r.body.error).toMatch(/on this PO will keep its current payer/)
    expect(po('P1').payer_override).toBe(null)
    expect(po('P1').notes).toBeUndefined()
    expect(mockState.calls.filter(c => c.table === 'purchase_orders' && c.op !== 'select')).toEqual([])

    const ok = await putPO({ id: 'P1', payer_override: 'owner', applyTo: 'new_only' })
    expect(ok.status).toBe(200)
    expect(po('P1').payer_override).toBe('owner')
    expect('applyTo' in po('P1')).toBe(false)
    expect(lib.invoiceStatus(inv('i1'), lib.effectivePOPayer(po('P1'), job('J1')))).toBe('paid')
    const log = mockState.db.change_log.find(c => c.field_name === 'payer_override')
    expect(log.note).toMatch(/1 approved\/paid invoice\(s\) kept their payer/)
  })
  test("'' → 'nv' on an NV job (same effective payer): no 409", async () => {
    addInv('i1', 'P1', PAID_CHECK)
    as(PM)
    const r = await putPO({ id: 'P1', payer_override: 'nv' })
    expect(r.status).toBe(200)
    expect(po('P1').payer_override).toBe('nv')
  })
  test('resending the same override: no 409', async () => {
    addInv('i1', 'P1', PAID_CHECK)
    as(PM)
    expect((await putPO({ id: 'P1', payer_override: '' })).status).toBe(200)
  })
})

// ── 9. Source checks ─────────────────────────────────────────────────────────
describe('page wiring and no migration', () => {
  test('job page and residential page confirm and resend applyTo new_only', () => {
    const jd = read('app/jobdetail/page.js')
    const rd = read('app/residentialjobdetail/page.js')
    for (const src of [jd, rd]) {
      expect(src).toMatch(/needs_payer_confirm/)
      expect(src).toMatch(/applyTo: 'new_only'/)
      expect(src).toMatch(/Not saved — who pays was not changed\./)
    }
    expect(jd).toMatch(/Not saved — Who pays vendors was not changed\./)
    expect(jd.match(/needs_payer_confirm/g).length).toBeGreaterThanOrEqual(2)
  })
  test('admin page and invoice panel render payer_kept', () => {
    expect(read('app/admin/page.js')).toMatch(/inv\.payer_kept && .*payer kept from before a change/)
    expect(read('app/jobdetail/POInvoicesPanel.js')).toMatch(/inv\.payer_kept && .*kept — approved\/paid before the payer changed/)
  })
  test('cash outlook selects the lock columns', () => {
    expect(read('app/api/cash-outlook/route.js')).toMatch(/select\('id, po_id, paid_amount, paid_by_owner, approved_at, ready_to_pay, paid_at'\)/)
  })
  test('no prompt 108 migration', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
    expect(files.filter(f => /^(08[4-9]|09\d|1\d\d)_/.test(f) && /payer|lock/i.test(f))).toEqual([])
    expect(files.some(f => /108/.test(f))).toBe(false)
  })
})
