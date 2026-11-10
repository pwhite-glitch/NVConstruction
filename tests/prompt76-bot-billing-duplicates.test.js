/**
 * Prompt 76: the Bot API billing POST runs the same duplicate-invoice guard as
 * /api/billing-entry (shared lib/billing-duplicates findDuplicateInvoice):
 * - duplicate (same job, same company, not rejected) → 409, nothing inserted;
 * - confirm_duplicate === true (strict) → 201 and the override is logged;
 * - read failure → 500, nothing inserted; confirm_duplicate never reaches the row;
 * - retainage_held vs retainage_pct × amount_billed off by > $1 → 201 with warnings.
 * mock-db stands in for Supabase; nothing live.
 */
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('../lib/bot-auth', () => ({
  requireBotKey: async () => ({ bot: { id: 'bot1', name: 'Bot' }, supabase: require('./helpers/mock-db').supabaseModule.createClient() }),
}))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  return {
    requireAuth: async () => mockState.auth || { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    requirePM: async () => mockState.auth,
    isPM: r => PM.has(r),
    isSub: () => false,
  }
})
jest.mock('../lib/roles', () => ({ denyJob: jest.fn(async () => null), denyJobOf: jest.fn(async () => null) }))
jest.mock('resend', () => ({ Resend: function Resend() { this.emails = { send: async () => ({ data: {}, error: null }) } } }))

const botBillings = require('../app/api/bot/v1/billings/route')
const billingEntry = require('../app/api/billing-entry/route')

const J1 = 'job-1'
const OLD = { id: 'old', job_id: J1, sub_id: 'u2', company_name: 'Acme Electric', invoice_number: 'inv 001', status: 'pending', amount_billed: 75, submitted_at: '2026-11-02T15:00:00Z' }

beforeEach(() => {
  resetMockState({
    jobs: [{ id: J1, job_number: '100', project_name: 'Job One' }],
    profiles: [
      { id: 'u1', full_name: 'Sam Sub', company_id: 'c1' },
      { id: 'u2', full_name: 'Mate', company_id: 'c1' },
      { id: 'o1', full_name: 'Other', company_id: 'c2' },
      { id: 'bot1', full_name: 'Bot' },
    ],
    billing_submissions: [{ ...OLD }],
    change_log: [],
  })
  mockState.auth = null
})

const req = (url, method, body) => new Request(`http://x${url}`, {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(body),
})
const botPost = body => botBillings.POST(req('/api/bot/v1/billings', 'POST', body))
const botBody = extra => ({ job_id: J1, sub_id: 'u1', company_name: 'Acme Electric', amount_billed: 100, invoice_number: '#INV 001', ...extra })
const inserts = () => mockState.calls.filter(c => c.table === 'billing_submissions' && c.op === 'insert')

describe('Bot API billing POST duplicate check', () => {
  test('no duplicate → 201, inserted', async () => {
    const res = await botPost(botBody({ invoice_number: 'INV-999' }))
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.ok).toBe(true)
    expect(out.warnings).toBeUndefined()
    expect(inserts()).toHaveLength(1)
  })

  test('no invoice number → no check, inserted', async () => {
    mockState.failSelect.billing_submissions = 'should not be read'
    const res = await botPost(botBody({ invoice_number: '  ' }))
    expect(res.status).toBe(201)
    expect(inserts()).toHaveLength(1)
  })

  test('duplicate (teammate via sub_id company) → 409 with duplicate(s), nothing inserted', async () => {
    const res = await botPost(botBody())
    expect(res.status).toBe(409)
    const out = await res.json()
    expect(out.needs_confirm).toBe(true)
    expect(out.error).toMatch(/Invoice #inv 001 was already entered/)
    const summary = { id: 'old', invoice_number: 'inv 001', submitted_at: '2026-11-02T15:00:00Z', status: 'pending', amount_billed: 75 }
    expect(out.duplicate).toEqual(summary)
    expect(out.duplicates).toEqual([summary])
    expect(inserts()).toHaveLength(0)
  })

  test('duplicate by company name only (no sub_id) → 409', async () => {
    const res = await botPost(botBody({ sub_id: undefined, company_name: 'Acme Electric, LLC' }))
    expect(res.status).toBe(409)
    expect(inserts()).toHaveLength(0)
  })

  test('all matches are returned', async () => {
    mockState.db.billing_submissions.push({ ...OLD, id: 'old2', invoice_number: 'INV001', status: 'approved' })
    const out = await (await botPost(botBody())).json()
    expect(out.duplicate.id).toBe('old')
    expect(out.duplicates.map(d => d.id)).toEqual(['old', 'old2'])
  })

  test('confirm_duplicate true → 201, override logged as the bot, flag not in the row', async () => {
    const res = await botPost(botBody({ confirm_duplicate: true }))
    expect(res.status).toBe(201)
    const ins = inserts()
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).not.toHaveProperty('confirm_duplicate')
    expect(ins[0].payload.invoice_number).toBe('#INV 001')
    const log = mockState.db.change_log.find(l => l.field_name === 'invoice_number')
    expect(log.note).toBe('Saved despite possible duplicate of Invoice #inv 001 (old) · via Bot API')
    expect(log.changed_by).toBe('bot1')
    expect(log.entity_id).toBe((await res.json()).id)
  })

  test('confirm_duplicate "true" (string) → still 409', async () => {
    const res = await botPost(botBody({ confirm_duplicate: 'true' }))
    expect(res.status).toBe(409)
    expect(inserts()).toHaveLength(0)
  })

  test('confirm_duplicate with no duplicate → 201, not in the row, no override log', async () => {
    const res = await botPost(botBody({ invoice_number: 'INV-555', confirm_duplicate: true }))
    expect(res.status).toBe(201)
    expect(inserts()[0].payload).not.toHaveProperty('confirm_duplicate')
    expect(mockState.db.change_log.find(l => l.field_name === 'invoice_number')).toBeUndefined()
  })

  test('a rejected earlier billing does not count', async () => {
    mockState.db.billing_submissions[0].status = 'rejected'
    const res = await botPost(botBody())
    expect(res.status).toBe(201)
    expect(inserts()).toHaveLength(1)
  })

  test('another company with the same invoice # does not count', async () => {
    const res = await botPost(botBody({ sub_id: 'o1', company_name: 'Zed Plumbing' }))
    expect(res.status).toBe(201)
  })

  test('read error → 500, nothing inserted', async () => {
    mockState.failSelect.billing_submissions = 'boom'
    const res = await botPost(botBody())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Could not check for a duplicate invoice: boom')
    expect(inserts()).toHaveLength(0)
  })

  test('profiles read error → 500, nothing inserted', async () => {
    // Job/sub checks pass first; fail the company lookup (select company_id) only.
    mockState.missingSelectCols.profiles = ['company_id']
    const res = await botPost(botBody())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/^Could not check for a duplicate invoice: /)
    expect(inserts()).toHaveLength(0)
  })

  test('schema-cache retry still works after a confirmed duplicate', async () => {
    mockState.missingCols.billing_submissions = ['invoice_date']
    const res = await botPost(botBody({ confirm_duplicate: true, invoice_date: '2026-11-01' }))
    expect(res.status).toBe(201)
    const ins = inserts()
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).not.toHaveProperty('invoice_date')
    expect(ins[0].payload).not.toHaveProperty('confirm_duplicate')
  })

  test('other unknown fields are still refused', async () => {
    const res = await botPost(botBody({ invoice_number: 'INV-1', bogus: 1 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Fields not allowed: bogus')
  })
})

describe('Bot API billing POST retainage warning', () => {
  test('retainage_held off by more than $1 → 201 with warnings, noted in the log', async () => {
    const res = await botPost(botBody({ invoice_number: 'INV-2', amount_billed: 1000, retainage_pct: 10, retainage_held: 50 }))
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toMatch(/\$50\.00.*10%.*\$1,000\.00.*\$100\.00/)
    expect(inserts()[0].payload.retainage_held).toBe(50)
    const log = mockState.db.change_log.find(l => l.field_name === 'created')
    expect(log.note).toMatch(/Warning: retainage_held/)
  })

  test('within $1 → no warnings', async () => {
    const out = await (await botPost(botBody({ invoice_number: 'INV-3', amount_billed: 1000, retainage_pct: 10, retainage_held: 100.75 }))).json()
    expect(out.warnings).toBeUndefined()
  })

  test('only one of pct / held → no warnings', async () => {
    const out = await (await botPost(botBody({ invoice_number: 'INV-4', amount_billed: 1000, retainage_held: 3 }))).json()
    expect(out.warnings).toBeUndefined()
  })
})

describe('/api/billing-entry regression (shared helper)', () => {
  test('POST duplicate → 409 needs_confirm with the same duplicate shape', async () => {
    mockState.auth = { userId: 'pm1', email: 'pm@nv.test', role: 'pm', error: null }
    const res = await billingEntry.POST(req('/api/billing-entry', 'POST', { job_id: J1, company_name: 'Acme Electric', sub_id: 'u1', amount_billed: 100, invoice_number: 'INV 001', status: 'approved' }))
    expect(res.status).toBe(409)
    const out = await res.json()
    expect(out.needs_confirm).toBe(true)
    expect(out.duplicate).toEqual({ id: 'old', invoice_number: 'inv 001', submitted_at: '2026-11-02T15:00:00Z', status: 'pending', amount_billed: 75 })
    expect(inserts()).toHaveLength(0)
  })
})
