/**
 * Prompt 67B #2: the same sub invoice could be entered and approved twice with no warning.
 * - lib/billing-duplicates: normalization, company match, invoice / amount+period rules.
 * - Sub portal POST: duplicate invoice # (anyone at the company, not rejected) → 409, nothing
 *   written, no email; header + SOV lines are saved together (lines fail → header deleted).
 * - /api/billing-entry POST/PATCH (PM): duplicate → 409 needs_confirm; confirm_duplicate saves.
 * - Pages: confirm + resend on the job page, "Possible duplicate" badges, approve warnings.
 * mock-db stands in for Supabase; nothing live.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const unauth = () => ({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
  return {
    requireAuth: async () => mockState.auth || unauth(),
    requirePM: async () => (mockState.auth && PM.has(mockState.auth.role) ? mockState.auth : { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
  }
})
jest.mock('../lib/roles', () => ({ denyJob: jest.fn(async () => null), denyJobOf: jest.fn(async () => null) }))
// Every email is recorded in mockState.calls so the order vs. DB writes can be asserted.
jest.mock('resend', () => ({
  Resend: function Resend() {
    this.emails = { send: async msg => { require('./helpers/mock-db').mockState.calls.push({ table: 'email', op: 'send', payload: msg }); return { data: {}, error: null } } }
  },
}))

const { normalizeInvoiceNumber, sameBillingCompany, sameBillingCompanyName, findDuplicateBillings, findInvoiceMatch } = require('../lib/billing-duplicates')
const subBilling = require('../app/api/sub-portal/billing/route')
const billingEntry = require('../app/api/billing-entry/route')

const J1 = 'job-1'
const J2 = 'job-2'
const ME = { id: 'u1', full_name: 'Sam Sub', role: 'subcontractor', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'me@acme.test', job_access: 'company', can_bill: true, phone: '555' }
const MATE = { id: 'u2', full_name: 'Mate', role: 'sub_pm', company_id: 'c1', company_name: 'Acme Electric', invite_email: 'mate@acme.test', job_access: 'company', can_bill: true }
const OTHER = { id: 'o1', full_name: 'Other', role: 'subcontractor', company_id: 'c2', company_name: 'Zed Plumbing', invite_email: 'o@zed.test', job_access: 'company', can_bill: true }

function seed(extra = {}) {
  resetMockState({
    companies: [{ id: 'c1', name: 'Acme Electric' }, { id: 'c2', name: 'Zed Plumbing' }],
    profiles: [ME, MATE, OTHER],
    jobs: [
      { id: J1, job_number: '100', project_name: 'Job One', status: 'active', pm_email: 'pm@nv.test' },
      { id: J2, job_number: '200', project_name: 'Job Two', status: 'active', pm_email: 'pm@nv.test' },
    ],
    job_assignments: [
      { id: 'a1', job_id: J1, company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: true },
      { id: 'a2', job_id: J2, company_id: 'c1', sub_id: null, sub_email: null, billing_enabled: true },
    ],
    subcontracts: [
      { id: 'sc1', job_id: J1, company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', contract_value: 1000, status: 'active', retainage_pct: 10 },
      { id: 'sc2', job_id: J2, company_id: 'c1', sub_id: null, vendor_name: 'Acme Electric', contract_value: 1000, status: 'active', retainage_pct: 10 },
    ],
    subcontract_sov_lines: [
      { id: 'sov1', subcontract_id: 'sc1', description: 'Rough-in', scheduled_value: 1000 },
      { id: 'sov2', subcontract_id: 'sc2', description: 'Rough-in', scheduled_value: 1000 },
    ],
    billing_sov_lines: [],
    billing_submissions: [],
    change_log: [],
    ...extra,
  })
}
const json = (url, method, body) => new Request(`http://x${url}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body),
})
const asSub = () => { mockState.auth = { userId: 'u1', email: 'me@acme.test', role: 'subcontractor', error: null } }
const asPM = () => { mockState.auth = { userId: 'pm1', email: 'pm@nv.test', role: 'pm', error: null } }
const subBody = extra => ({ job_id: J1, invoice_number: 'INV-001', doc_url: 'u1/inv.pdf', amount_billed: '100.00', sov_lines: [{ sov_line_id: 'sov1', amount: 100, pct_this_period: 10 }], ...extra })
const billingWrites = () => mockState.calls.filter(c => c.table === 'billing_submissions')
const emails = () => mockState.calls.filter(c => c.table === 'email')

beforeEach(() => { seed(); mockState.auth = null })

describe('lib/billing-duplicates', () => {
  test('normalizeInvoiceNumber', () => {
    expect(normalizeInvoiceNumber('#INV 001')).toBe('inv001')
    expect(normalizeInvoiceNumber('  inv001 ')).toBe('inv001')
    expect(normalizeInvoiceNumber('#INV 001')).toBe(normalizeInvoiceNumber('inv001'))
    expect(normalizeInvoiceNumber('   ')).toBeNull()
    expect(normalizeInvoiceNumber('#')).toBeNull()
    expect(normalizeInvoiceNumber(null)).toBeNull()
    expect(normalizeInvoiceNumber(1234)).toBe('1234')
  })

  test('sameBillingCompany: same sub, company member set, or company name', () => {
    expect(sameBillingCompany({ sub_id: 'a' }, { sub_id: 'a' })).toBe(true)
    expect(sameBillingCompany({ sub_id: 'a' }, { sub_id: 'b' })).toBe(false)
    expect(sameBillingCompany({ sub_id: 'a' }, { sub_id: 'b' }, { memberIdsBySubId: { a: new Set(['a', 'b']) } })).toBe(true)
    expect(sameBillingCompany({ sub_id: 'a' }, { sub_id: 'b' }, { memberIdsBySubId: { b: ['a', 'b'] } })).toBe(true)
    expect(sameBillingCompany({ company_name: 'J2 Construction Services LLC.' }, { company_name: 'J2 Construction Services, LLC' })).toBe(true)
    expect(sameBillingCompany({ company_name: 'Acme' }, { company_name: 'Zed' })).toBe(false)
  })

  test("sameBillingCompany: a blank or generic 'Unknown' name never matches; sub_id still does", () => {
    expect(sameBillingCompany({ company_name: 'Unknown' }, { company_name: 'Unknown' })).toBe(false)
    expect(sameBillingCompany({ company_name: ' unknown ' }, { company_name: 'UNKNOWN' })).toBe(false)
    expect(sameBillingCompany({ company_name: '' }, { company_name: '' })).toBe(false)
    expect(sameBillingCompany({ company_name: '   ' }, { company_name: null })).toBe(false)
    expect(sameBillingCompany({ sub_id: 'a', company_name: 'Unknown' }, { sub_id: 'a', company_name: 'Unknown' })).toBe(true)
    expect(sameBillingCompany({ sub_id: 'a', company_name: 'Unknown' }, { sub_id: 'b', company_name: 'Unknown' }, { memberIdsBySubId: { a: ['a', 'b'] } })).toBe(true)
    expect(sameBillingCompanyName('Unknown', 'Unknown')).toBe(false)
    expect(sameBillingCompanyName('Acme Electric', 'acme electric, llc')).toBe(true)
    // Two unrelated 'Unknown' rows on a job no longer badge each other.
    const rows = [
      { id: 'a', job_id: J1, sub_id: 'x1', company_name: 'Unknown', invoice_number: 'INV-1', amount_billed: 100, billing_period: '2026-10-01', status: 'pending' },
      { id: 'b', job_id: J1, sub_id: 'x2', company_name: 'Unknown', invoice_number: 'INV-1', amount_billed: 100, billing_period: '2026-10-01', status: 'pending' },
    ]
    expect(findDuplicateBillings(rows)).toEqual({})
  })

  test('findDuplicateBillings: invoice rule, rejected ignored, other job / company ignored', () => {
    const rows = [
      { id: 'a', job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: '#INV 001', amount_billed: 100, status: 'pending' },
      { id: 'b', job_id: J1, sub_id: 'u2', company_name: 'Acme Electric LLC', invoice_number: 'inv001', amount_billed: 250, status: 'approved' },
      { id: 'c', job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: 'INV001', amount_billed: 100, status: 'rejected' },
      { id: 'd', job_id: J2, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: 'INV001', amount_billed: 100, status: 'pending' },
      { id: 'e', job_id: J1, sub_id: 'o1', company_name: 'Zed Plumbing', invoice_number: 'INV001', amount_billed: 100, status: 'pending' },
    ]
    const d = findDuplicateBillings(rows)
    expect(d.a).toEqual([{ id: 'b', reason: 'invoice' }])
    expect(d.b).toEqual([{ id: 'a', reason: 'invoice' }])
    expect(d.c).toBeUndefined()
    expect(d.d).toBeUndefined()
    expect(d.e).toBeUndefined()
  })

  test('findDuplicateBillings: amount + period rule (to the cent, same period)', () => {
    const base = { job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', status: 'pending' }
    const rows = [
      { ...base, id: 'a', amount_billed: 1234.5, billing_period: '2026-10-01', invoice_number: 'A-1' },
      { ...base, id: 'b', amount_billed: '1234.50', billing_period: '2026-10-01', invoice_number: 'A-2' },
      { ...base, id: 'c', amount_billed: 1234.51, billing_period: '2026-10-01' },
      { ...base, id: 'd', amount_billed: 1234.5, billing_period: '2026-11-01' },
      { ...base, id: 'e', amount_billed: 1234.5, billing_period: '2026-10-01', status: 'rejected' },
    ]
    const d = findDuplicateBillings(rows)
    expect(d.a).toEqual([{ id: 'b', reason: 'amount_period' }])
    expect(d.b).toEqual([{ id: 'a', reason: 'amount_period' }])
    expect(d.c).toBeUndefined()
    expect(d.d).toBeUndefined()
    expect(d.e).toBeUndefined()
  })

  test('findInvoiceMatch skips the row itself and blank numbers', () => {
    const rows = [{ id: 'a', job_id: J1, sub_id: 'u1', invoice_number: 'X1', status: 'pending' }]
    expect(findInvoiceMatch(rows, { id: 'a', job_id: J1, sub_id: 'u1', invoice_number: 'x1' })).toBeNull()
    expect(findInvoiceMatch(rows, { job_id: J1, sub_id: 'u1', invoice_number: '' })).toBeNull()
    expect(findInvoiceMatch(rows, { job_id: J1, sub_id: 'u1', invoice_number: ' # x 1' }).id).toBe('a')
  })
})

describe('sub portal billing POST', () => {
  test("duplicate of a teammate's pending invoice → 409, nothing inserted, no email", async () => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: 'u2', company_name: 'Acme Electric', invoice_number: 'INV 001', status: 'pending', amount_billed: 50, submitted_at: '2026-11-02T15:00:00Z' }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody({ invoice_number: '#inv001' })))
    expect(res.status).toBe(409)
    const out = await res.json()
    expect(out.error).toMatch(/^Invoice #inv001 was already submitted for this project on Nov 2, 2026 \(pending\)\. If this is a different invoice, enter its own invoice number\.$/)
    expect(mockState.calls.filter(c => c.op !== 'select')).toHaveLength(0)
    expect(billingWrites()).toHaveLength(0)
    expect(emails()).toHaveLength(0)
  })

  test('duplicate matched by company name (sub not a member) → 409', async () => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: null, company_name: 'ACME ELECTRIC, LLC', invoice_number: 'INV-001', status: 'approved', amount_billed: 50, submitted_at: '2026-11-02T15:00:00Z' }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(409)
    expect(billingWrites()).toHaveLength(0)
  })

  test('rejected original → allowed', async () => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: 'INV-001', status: 'rejected', amount_billed: 50 }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(200)
    expect(billingWrites().filter(c => c.op === 'insert')).toHaveLength(1)
  })

  test('same invoice # on a different job → allowed', async () => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J2, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: 'INV-001', status: 'pending', amount_billed: 50 }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(200)
  })

  test("another company's same invoice # on the job → allowed", async () => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: 'o1', company_name: 'Zed Plumbing', invoice_number: 'INV-001', status: 'pending', amount_billed: 50 }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(200)
  })

  test("another sub's 'Unknown' company-name row with the same invoice # → allowed", async () => {
    seed({ companies: [{ id: 'c1', name: 'Unknown' }, { id: 'c2', name: 'Zed Plumbing' }], profiles: [{ ...ME, company_name: ' unknown ' }, MATE, OTHER] })
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: 'o1', company_name: 'Unknown', invoice_number: 'INV-001', status: 'pending', amount_billed: 50 }]
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(200)
    expect(billingWrites().filter(c => c.op === 'insert')).toHaveLength(1)
  })

  test('duplicate check read failure → 500, nothing written (fails closed)', async () => {
    mockState.failSelect.billing_submissions = 'connection reset'
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(500)
    expect(billingWrites()).toHaveLength(0)
    expect(emails()).toHaveLength(0)
  })

  test('SOV lines insert fails → 500, header deleted, no email', async () => {
    mockState.failWrite.billing_sov_lines = { insert: 'permission denied for billing_sov_lines' }
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Your billing was not saved: permission denied for billing_sov_lines')
    const ins = billingWrites().find(c => c.op === 'insert')
    const del = billingWrites().find(c => c.op === 'delete')
    expect(ins).toBeTruthy()
    expect(del).toBeTruthy()
    expect(mockState.db.billing_submissions).toHaveLength(0)
    expect(emails()).toHaveLength(0)
  })

  test('lines fail and the cleanup delete fails too → 500 with both messages', async () => {
    mockState.failWrite.billing_sov_lines = { insert: 'lines broke' }
    mockState.failWrite.billing_submissions = { delete: 'delete broke' }
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(500)
    const { error } = await res.json()
    expect(error).toMatch(/lines broke/)
    expect(error).toMatch(/delete broke/)
    expect(emails()).toHaveLength(0)
  })

  test('success → header, then lines, then the PM email', async () => {
    asSub()
    const res = await subBilling.POST(json('/api/sub-portal/billing', 'POST', subBody()))
    expect(res.status).toBe(200)
    const order = mockState.calls.filter(c => c.op !== 'select').map(c => `${c.table}:${c.op}`)
    expect(order).toEqual(['billing_submissions:insert', 'billing_sov_lines:insert', 'email:send'])
    expect(mockState.db.billing_sov_lines).toHaveLength(1)
    expect(mockState.db.billing_submissions[0].invoice_number).toBe('INV-001')
  })
})

describe('/api/billing-entry (office entry)', () => {
  const pmRow = extra => ({ job_id: J1, company_name: 'Acme Electric', sub_id: 'u1', amount_billed: 100, invoice_number: 'INV 001', status: 'approved', ...extra })
  beforeEach(() => {
    mockState.db.billing_submissions = [{ id: 'old', job_id: J1, sub_id: 'u2', company_name: 'Acme Electric', invoice_number: 'inv 001', status: 'pending', amount_billed: 75, submitted_at: '2026-11-02T15:00:00Z' }]
    asPM()
  })

  test('POST duplicate (teammate via sub_id company) → 409 needs_confirm, nothing inserted', async () => {
    const res = await billingEntry.POST(json('/api/billing-entry', 'POST', pmRow()))
    expect(res.status).toBe(409)
    const out = await res.json()
    expect(out.needs_confirm).toBe(true)
    expect(out.duplicate).toEqual({ id: 'old', invoice_number: 'inv 001', submitted_at: '2026-11-02T15:00:00Z', status: 'pending', amount_billed: 75 })
    expect(billingWrites().filter(c => c.op === 'insert')).toHaveLength(0)
  })

  test('POST duplicate by company name only (no sub_id) → 409', async () => {
    const res = await billingEntry.POST(json('/api/billing-entry', 'POST', pmRow({ sub_id: null, company_name: 'Acme Electric, LLC' })))
    expect(res.status).toBe(409)
  })

  test('POST with confirm_duplicate → 200, no confirm_duplicate key in the row, change logged', async () => {
    const res = await billingEntry.POST(json('/api/billing-entry', 'POST', pmRow({ confirm_duplicate: true })))
    expect(res.status).toBe(200)
    const ins = billingWrites().filter(c => c.op === 'insert')
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).not.toHaveProperty('confirm_duplicate')
    expect(ins[0].payload.invoice_number).toBe('INV 001')
    const log = mockState.db.change_log.find(l => l.field_name === 'invoice_number')
    expect(log.note).toBe('Saved despite possible duplicate of Invoice #inv 001 (old)')
  })

  test('POST without an invoice number → no check, inserted', async () => {
    mockState.failSelect.billing_submissions = 'should not be read'
    const res = await billingEntry.POST(json('/api/billing-entry', 'POST', pmRow({ invoice_number: '  ' })))
    expect(res.status).toBe(200)
    expect(billingWrites().filter(c => c.op === 'insert')).toHaveLength(1)
  })

  test('POST duplicate of a rejected billing → allowed', async () => {
    mockState.db.billing_submissions[0].status = 'rejected'
    const res = await billingEntry.POST(json('/api/billing-entry', 'POST', pmRow()))
    expect(res.status).toBe(200)
  })

  test('PATCH invoice # to a duplicate → 409 needs_confirm; with confirm → saved', async () => {
    mockState.db.billing_submissions.push({ id: 'b2', job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', invoice_number: 'INV-777', status: 'pending', amount_billed: 20 })
    let res = await billingEntry.PATCH(json('/api/billing-entry', 'PATCH', { id: 'b2', invoice_number: '#INV001' }))
    expect(res.status).toBe(409)
    expect((await res.json()).needs_confirm).toBe(true)
    expect(mockState.db.billing_submissions.find(b => b.id === 'b2').invoice_number).toBe('INV-777')

    res = await billingEntry.PATCH(json('/api/billing-entry', 'PATCH', { id: 'b2', invoice_number: '#INV001', confirm_duplicate: true }))
    expect(res.status).toBe(200)
    const upd = billingWrites().filter(c => c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).not.toHaveProperty('confirm_duplicate')
    expect(mockState.db.billing_submissions.find(b => b.id === 'b2').invoice_number).toBe('#INV001')
  })

  test('PATCH that keeps its own invoice # is not a duplicate of itself', async () => {
    const res = await billingEntry.PATCH(json('/api/billing-entry', 'PATCH', { id: 'old', invoice_number: 'INV 001', contact_name: 'X' }))
    expect(res.status).toBe(200)
  })
})

describe('pages', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const fnBody = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)))

  test('jobdetail createBilling: needs_confirm → window.confirm → resend with confirm_duplicate', () => {
    const src = read('app/jobdetail/page.js')
    const body = fnBody(src, 'async function createBilling(', 'async function updateBillingEntry(')
    expect(body).toMatch(/res\.status === 409 && result\.needs_confirm/)
    expect(body).toMatch(/window\.confirm\(`This looks like a duplicate of Invoice #\$\{d\.invoice_number\} from /)
    expect(body).toMatch(/Save anyway\?`\)/)
    expect(body).toMatch(/postBilling\(\{ \.\.\.rowData, confirm_duplicate: true \}\)/)
    // same request shape (FormData or JSON) on the resend
    expect(body).toMatch(/formData\.append\('data', JSON\.stringify\(data\)\)/)
  })

  test('jobdetail Billing tab and approveBilling use findDuplicateBillings', () => {
    const src = read('app/jobdetail/page.js')
    expect(src).toMatch(/const billingDups = findDuplicateBillings\(billingSubmissions\)/)
    const list = src.slice(src.indexOf('{billingSubmissions.map(b => {'), src.indexOf('WAIVER SIGNED'))
    expect(list).toContain('billingDups[b.id]')
    expect(list).toContain('Possible duplicate')
    const approve = fnBody(src, 'async function approveBilling(', '// ── Completion Report')
    expect(approve).toMatch(/findDuplicateBillings\(billingSubmissions\)\[billingId\]/)
    expect(approve).toMatch(/window\.confirm\(/)
  })

  test('dashboard review list and updateStatus(approved) use findDuplicateBillings', () => {
    const src = read('app/dashboard/page.js')
    expect(src).toMatch(/const billingDups = findDuplicateBillings\(submissions\)/)
    const list = src.slice(src.indexOf('pagedFiltered.map(sub =>'), src.indexOf("updateStatus(sub, 'approved')"))
    expect(list).toContain('billingDups[sub.id]')
    expect(list).toContain('Possible duplicate')
    const upd = fnBody(src, 'async function updateStatus(', 'setRejectingSubId(null)')
    expect(upd).toMatch(/status === 'approved'[\s\S]*findDuplicateBillings\(submissions\)\[sub\.id\][\s\S]*window\.confirm/)
  })

  test('submit page shows the server error (409) in submitError', () => {
    const src = read('app/submit/page.js')
    const body = fnBody(src, 'async function handleSubmit(', 'clearBillingDraft()')
    expect(body).toMatch(/if \(!res\.ok\) \{\s*setSubmitError\(result\.error/)
  })
})
