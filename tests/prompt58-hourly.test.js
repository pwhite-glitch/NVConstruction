/**
 * Prompt 58 — seven approved hourly findings.
 *   1. Prime pay-app Record Payment: server route, itemized entries, prefill/confirm, no drafts, Owner+PM, void.
 *   2. Bid package APM Access enforced on the server (+ RLS migration 054).
 *   3. Meeting AI parser: meeting date anchor, due-date range flag, year on pills, aligned limits, max_tokens.
 *   4. Portal Bot logins hidden from staff lists and refused as PM / team member.
 *   5. Commercial Complete Job & Report goes through /api/jobs/details (no browser jobs write; no supers).
 *   6. change_log: no browser inserts, name stamped from the profile, job-scoped reads.
 *   7. NV Team role changes: Owner-only server route with last-Owner guard (+ migration 056).
 * All DB access is the in-memory mock; nothing real is touched. No migration is applied.
 */
const fs = require('fs')
const path = require('path')
const { mockState, resetMockState } = require('./helpers/mock-db')

jest.mock('@supabase/supabase-js', () => require('./helpers/mock-db').supabaseModule)
jest.mock('resend', () => ({ Resend: function () { this.emails = { send: async () => ({ data: { id: 'e1' }, error: null }) } } }))
jest.mock('../lib/server-auth', () => {
  const { mockState } = require('./helpers/mock-db')
  const PM = new Set(['principal', 'pm', 'apm', 'super', 'admin'])
  const SUB = new Set(['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin'])
  const forbid = () => ({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) })
  return {
    requireAuth: async () => mockState.auth,
    requirePM: async () => (PM.has(mockState.auth.role) ? mockState.auth : forbid()),
    requireRole: async (_r, roles) => (roles.includes(mockState.auth.role) ? mockState.auth : forbid()),
    isPM: r => PM.has(r),
    isSub: r => SUB.has(r),
    PM_ROLES: PM,
    SUB_ROLES: SUB,
  }
})

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const sqlOnly = s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

const as = (role, userId = `${role}1`, email = `${userId}@x.com`) => { mockState.auth = { userId, role, email, error: null } }
const jreq = (url, method, body) => new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (handler, url, method, body) => {
  const res = await handler(jreq(url, method, body))
  return { status: res.status, body: await res.json() }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('1) prime pay-app payments', () => {
  const pay = require('../app/api/aia-payments/route')
  const { aiaPaymentSummary, parseAiaPaymentAmount, legacySeedEntry, canRecordAiaPayment } = require('../lib/aia-payments')
  const { aiaItems } = require('../lib/cash-outlook')

  // Model of migration 053's record_aia_payment / void_aia_payment: one
  // transaction per call, serialized per application (SELECT … FOR UPDATE),
  // all-or-nothing, summary recalculated from the live ledger inside the lock.
  // hooks.beforeLock(fn, args) / hooks.inLock(fn, args) let a test pause a call.
  const r2 = n => Math.round(Number(n) * 100) / 100
  let entrySeq = 0
  function installPaymentRpcs(hooks = {}) {
    const locks = new Map()
    const withLock = async (id, fn) => {
      const prev = locks.get(id) || Promise.resolve()
      let release
      const mine = new Promise(r => { release = r })
      locks.set(id, prev.then(() => mine))
      await prev
      try { return await fn() } finally { release() }
    }
    const fail = message => ({ data: null, error: { message, code: 'P0001' } })
    const recalc = (db, appRow) => {
      const live = db.aia_payment_entries.filter(e => e.application_id === appRow.id && !e.voided_at)
      const total = r2(live.reduce((s, e) => s + Number(e.amount), 0))
      const latest = live.map(e => e.received_on).filter(Boolean).sort().pop() || null
      appRow.amount_received = total > 0 ? total : null
      appRow.payment_received = total > 0
      appRow.payment_received_at = total > 0 && latest ? `${latest}T12:00:00.000Z` : null
      return { total, amount_received: appRow.amount_received, payment_received: appRow.payment_received, payment_received_at: appRow.payment_received_at }
    }
    mockState.rpc.record_aia_payment = async (args, db) => {
      if (hooks.beforeLock) await hooks.beforeLock('record', args)
      return withLock(args.p_application_id, async () => {
        if (hooks.inLock) await hooks.inLock('record', args)
        const appRow = db.aia_applications.find(a => a.id === args.p_application_id)
        if (!appRow) return fail('aia_payment_not_found')
        if (!['submitted', 'certified'].includes(appRow.status)) return fail('aia_payment_draft: drafts cannot take a payment')
        const pending = []
        const existing = db.aia_payment_entries.filter(e => e.application_id === appRow.id)
        if (!existing.length && Number(appRow.amount_received) > 0) {
          const d = appRow.payment_received_at ? new Date(appRow.payment_received_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null
          pending.push({ id: `E${++entrySeq}`, application_id: appRow.id, job_id: appRow.job_id, amount: r2(appRow.amount_received), received_on: d, reference: 'Recorded before itemized payments', voided_at: null })
        }
        const live = r2([...existing, ...pending].filter(e => !e.voided_at).reduce((s, e) => s + Number(e.amount), 0))
        if (args.p_expected_received == null || Math.abs(live - args.p_expected_received) > 0.005) return fail(`aia_payment_ledger_changed: live ${live} expected ${args.p_expected_received}`)
        const entry = { id: `E${++entrySeq}`, application_id: appRow.id, job_id: appRow.job_id, amount: r2(args.p_amount), received_on: args.p_received_on, reference: args.p_reference, recorded_by: args.p_recorded_by, recorded_by_name: args.p_recorded_by_name, voided_at: null, created_at: new Date().toISOString() }
        db.aia_payment_entries.push(...pending, entry) // commit
        return { data: { ...recalc(db, appRow), previous_total: live, entry }, error: null }
      })
    }
    mockState.rpc.void_aia_payment = async (args, db) => {
      const found = db.aia_payment_entries.find(e => e.id === args.p_entry_id)
      if (!found) return fail('aia_payment_not_found')
      if (hooks.beforeLock) await hooks.beforeLock('void', args)
      return withLock(found.application_id, async () => {
        if (hooks.inLock) await hooks.inLock('void', args)
        const appRow = db.aia_applications.find(a => a.id === found.application_id)
        if (found.voided_at) return fail('aia_payment_already_voided')
        const prev = r2(db.aia_payment_entries.filter(e => e.application_id === appRow.id && !e.voided_at).reduce((s, e) => s + Number(e.amount), 0))
        Object.assign(found, { voided_at: new Date().toISOString(), voided_by: args.p_voided_by, voided_by_name: args.p_voided_by_name, void_reason: args.p_reason })
        return { data: { ...recalc(db, appRow), previous_total: prev }, error: null }
      })
    }
  }
  const ledgerTotal = id => r2(mockState.db.aia_payment_entries.filter(e => e.application_id === id && !e.voided_at).reduce((s, e) => s + Number(e.amount), 0))
  const tick = () => new Promise(r => setImmediate(r))
  const waitFor = async cond => { for (let i = 0; i < 200 && !cond(); i++) await tick(); if (!cond()) throw new Error('waitFor timed out') }

  const seed = (appOverrides = {}, hooks) => { resetMockState({
    jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', job_type: 'commercial' }, { id: 'J2', job_number: '102', project_name: 'Other', job_type: 'commercial' }],
    pm_job_assignments: [{ id: 'pa1', job_id: 'J1', user_id: 'pm1' }],
    profiles: [{ id: 'pm1', full_name: 'Pat PM', role: 'pm' }, { id: 'principal1', full_name: 'Olive Owner', role: 'principal' }],
    budget_items: [{ id: 'B1', job_id: 'J1', budget_amount: 10000, owner_amount: 10000 }],
    aia_applications: [
      { id: 'A1', job_id: 'J1', app_number: 1, status: 'submitted', retainage_pct: 10, payment_received: false, amount_received: null, payment_received_at: null, ...appOverrides },
      { id: 'ADraft', job_id: 'J1', app_number: 2, status: 'draft', retainage_pct: 10, payment_received: false, amount_received: null },
    ],
    aia_application_lines: [{ id: 'L1', application_id: 'A1', budget_item_id: 'B1', dollar_this_period: 1000 }],
    aia_payment_entries: [],
    change_log: [],
  }); installPaymentRpcs(hooks) }
  const app = () => mockState.db.aia_applications.find(a => a.id === 'A1')

  beforeEach(() => { seed(); as('pm') })

  test('pure helpers: amount parser, summary, legacy seed, roles', () => {
    for (const bad of ['', '0', '-1', 'abc', '1.234', null, NaN, Infinity]) expect(parseAiaPaymentAmount(bad).error).toBeTruthy()
    expect(parseAiaPaymentAmount('1,234.50').amount).toBe(1234.5)
    const s = aiaPaymentSummary([{ amount: 400, received_on: '2026-10-01' }, { amount: 100, received_on: '2026-11-02' }, { amount: 999, received_on: '2026-11-05', voided_at: 'x' }])
    expect(s.total).toBe(500)
    expect(s.columns).toEqual({ amount_received: 500, payment_received: true, payment_received_at: '2026-11-02T12:00:00.000Z' })
    expect(aiaPaymentSummary([]).columns).toEqual({ amount_received: null, payment_received: false, payment_received_at: null })
    expect(legacySeedEntry({ id: 'A', job_id: 'J', amount_received: 300, payment_received_at: '2026-09-01T17:00:00Z' }, [])).toMatchObject({ amount: 300, received_on: '2026-09-01' })
    expect(legacySeedEntry({ id: 'A', amount_received: 300 }, [{ id: 'e' }])).toBeNull()
    expect(['principal', 'pm'].every(canRecordAiaPayment)).toBe(true)
    expect(['apm', 'super', 'admin', 'subcontractor'].some(canRecordAiaPayment)).toBe(false)
  })

  test('GET prefill: G702 current payment due and remaining', async () => {
    const r = await call(pay.GET, '/api/aia-payments?application_id=A1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ due: 900, received: 0, remaining: 900 })
  })

  test('POST records an entry and syncs the summary columns (server-side, from the list)', async () => {
    const r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: '900', received_on: '2026-11-02', reference: 'CHK 1001' })
    expect(r.status).toBe(200)
    expect(mockState.db.aia_payment_entries).toHaveLength(1)
    expect(mockState.db.aia_payment_entries[0]).toMatchObject({ amount: 900, received_on: '2026-11-02', reference: 'CHK 1001', recorded_by: 'pm1', recorded_by_name: 'Pat PM', job_id: 'J1' })
    expect(app()).toMatchObject({ amount_received: 900, payment_received: true, payment_received_at: '2026-11-02T12:00:00.000Z' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ job_id: 'J1', entity_type: 'aia_payment', changed_by: 'pm1', changed_by_name: 'Pat PM' })
  })

  test('amount ≠ remaining needs confirm_mismatch; second payment adds to the running total', async () => {
    let r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-11-01' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'amount_mismatch', remaining: 900 })
    expect(mockState.db.aia_payment_entries).toHaveLength(0)
    r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-11-01', confirm_mismatch: true })
    expect(r.status).toBe(200)
    // remaining is now 400: exactly that needs no confirmation
    r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 400, received_on: '2026-11-03' })
    expect(r.status).toBe(200)
    expect(app()).toMatchObject({ amount_received: 900, payment_received: true, payment_received_at: '2026-11-03T12:00:00.000Z' })
  })

  test('drafts are refused; APM / super / admin cannot record; job-limited PM off the job refused', async () => {
    expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'ADraft', amount: 10, confirm_mismatch: true })).body.code).toBe('draft')
    for (const role of ['apm', 'super', 'admin', 'subcontractor']) {
      as(role)
      expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 900 })).status).toBe(403)
      expect((await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: 'x', action: 'void', reason: 'r' })).status).toBe(403)
    }
    as('pm', 'pm2')
    expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 900 })).status).toBe(403)
    expect(mockState.db.aia_payment_entries).toHaveLength(0)
    expect(app().payment_received).toBe(false)
  })

  test('future dates and bad amounts are refused server-side', async () => {
    expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 900, received_on: '2999-01-01' })).status).toBe(400)
    expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: -5 })).status).toBe(400)
  })

  test('void keeps earlier entries and dates; total recomputed; zero unlocks', async () => {
    as('principal')
    await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-10-01', confirm_mismatch: true })
    await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 400, received_on: '2026-11-01' })
    const [first, second] = mockState.db.aia_payment_entries
    expect((await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: second.id, action: 'void' })).status).toBe(400) // reason required
    as('pm')
    let r = await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: second.id, action: 'void', reason: 'Typo' })
    expect(r.status).toBe(200)
    expect(second).toMatchObject({ voided_by: 'pm1', void_reason: 'Typo' })
    expect(first.voided_at).toBeFalsy()
    expect(app()).toMatchObject({ amount_received: 500, payment_received: true, payment_received_at: '2026-10-01T12:00:00.000Z' })
    expect((await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: second.id, action: 'void', reason: 'again' })).status).toBe(409)
    r = await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: first.id, action: 'void', reason: 'Bounced' })
    expect(app()).toMatchObject({ amount_received: null, payment_received: false, payment_received_at: null })
    expect(mockState.db.aia_payment_entries).toHaveLength(2) // nothing deleted
  })

  test('legacy single payment is carried over as an entry (no dropped money)', async () => {
    seed({ payment_received: true, amount_received: 300, payment_received_at: '2026-09-15T17:00:00Z' })
    as('pm')
    const r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 600, received_on: '2026-11-01' })
    expect(r.status).toBe(200) // remaining = 900 − 300 = 600, no confirm needed
    expect(mockState.db.aia_payment_entries.map(e => e.amount)).toEqual([300, 600])
    expect(app().amount_received).toBe(900)
  })

  test('H1 race: $400 and $500 on a $900 app — stale request is refused, summary always equals the live ledger', async () => {
    // A ($400) reads the ledger (0), then pauses before its database call.
    let releaseA
    const gateA = new Promise(r => { releaseA = r })
    seed({}, { beforeLock: async (fn, args) => { if (fn === 'record' && args.p_amount === 400) await gateA } })
    as('pm')
    const pA = call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 400, received_on: '2026-11-01', confirm_mismatch: true })
    await waitFor(() => mockState.calls.some(c => c.table === 'rpc:record_aia_payment' && c.payload.p_amount === 400))
    // B ($500) runs to completion meanwhile.
    const rB = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-11-02', confirm_mismatch: true })
    expect(rB.status).toBe(200)
    expect(app().amount_received).toBe(500)
    releaseA()
    const rA = await pA
    // A's expected_received (0) is stale → refused, nothing written, no stale overwrite.
    expect(rA.status).toBe(409)
    expect(rA.body.code).toBe('ledger_changed')
    expect(mockState.db.aia_payment_entries.map(e => e.amount)).toEqual([500])
    expect(app().amount_received).toBe(ledgerTotal('A1'))
    // The route itself never writes the summary columns.
    expect(mockState.calls.filter(c => c.table === 'aia_applications' && c.op !== 'select')).toHaveLength(0)
  })

  test('H1 race: a call that waits on the app lock sees the committed ledger, never a stale total', async () => {
    // A holds the lock (mid-transaction) while B arrives; B queues behind it.
    let releaseA
    const gateA = new Promise(r => { releaseA = r })
    seed({}, { inLock: async (fn, args) => { if (fn === 'record' && args.p_amount === 400) await gateA } })
    as('pm')
    const pA = call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 400, received_on: '2026-11-01', confirm_mismatch: true })
    await waitFor(() => mockState.calls.some(c => c.table === 'rpc:record_aia_payment'))
    const pB = call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-11-02', confirm_mismatch: true })
    await waitFor(() => mockState.calls.filter(c => c.table === 'rpc:record_aia_payment').length === 2)
    releaseA()
    const [rA, rB] = await Promise.all([pA, pB])
    expect(rA.status).toBe(200)
    expect(rB.status).toBe(409) // B computed remaining from 0, ledger is now 400
    expect(app().amount_received).toBe(400)
    expect(app().amount_received).toBe(ledgerTotal('A1'))
    // Retrying B with fresh data lands at $900, matching the ledger.
    const rB2 = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 500, received_on: '2026-11-02' })
    expect(rB2.status).toBe(200)
    expect(app()).toMatchObject({ amount_received: 900, payment_received: true, payment_received_at: '2026-11-02T12:00:00.000Z' })
    expect(app().amount_received).toBe(ledgerTotal('A1'))
  })

  test('H1: a stale expected_received is refused without writing (direct model check)', async () => {
    const db = mockState.db
    await mockState.rpc.record_aia_payment({ p_application_id: 'A1', p_amount: 400, p_received_on: '2026-11-01', p_reference: null, p_recorded_by: 'pm1', p_recorded_by_name: 'Pat PM', p_expected_received: 0 }, db)
    const before = JSON.stringify(db)
    const r = await mockState.rpc.record_aia_payment({ p_application_id: 'A1', p_amount: 500, p_received_on: '2026-11-02', p_reference: null, p_recorded_by: 'pm1', p_recorded_by_name: 'Pat PM', p_expected_received: 0 }, db)
    expect(r.error.message).toMatch(/aia_payment_ledger_changed/)
    expect(JSON.stringify(db)).toBe(before)
  })

  test('fails closed when the 053 record / void functions are missing', async () => {
    delete mockState.rpc.record_aia_payment
    const r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 900 })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('migration_required')
    expect(mockState.db.aia_payment_entries).toHaveLength(0)
    expect(app().amount_received).toBeNull()
  })

  test('migration 053 defines locked, service-role-only record / void functions', () => {
    const sql = sqlOnly(read('migrations/053_aia_payment_entries.sql'))
    for (const fn of ['record_aia_payment', 'void_aia_payment']) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`))
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
    }
    expect(sql.match(/FROM public\.aia_applications WHERE id = [a-z_]+ FOR UPDATE/g)).toHaveLength(2)
    for (const tok of ['aia_payment_draft', 'aia_payment_ledger_changed', 'aia_payment_already_voided', 'aia_payment_not_found']) expect(sql).toContain(tok)
    expect(sql).toMatch(/p_expected_received/)
    expect(sql).toMatch(/Recorded before itemized payments'\);/)
    // The route never sends summary columns itself.
    const route = read('app/api/aia-payments/route.js')
    expect(route).not.toMatch(/from\('aia_applications'\)\.update/)
  })

  test('fails closed when migration 053 is missing (no write at all)', async () => {
    mockState.failSelect.aia_payment_entries = 'relation "public.aia_payment_entries" does not exist'
    const r = await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'A1', amount: 900 })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('migration_required')
    expect(mockState.calls.filter(c => c.table === 'aia_applications')).toHaveLength(0)
  })

  test('cash outlook: a draft with a recorded payment is not counted again as unbilled', () => {
    const jobsById = { J1: { id: 'J1', job_number: '101' } }
    const apps = [{ id: 'D', job_id: 'J1', app_number: 1, status: 'draft', retainage_pct: 10, payment_received: true, amount_received: 900 }]
    const linesByApp = { D: [{ application_id: 'D', budget_item_id: 'B1', dollar_this_period: 1000 }] }
    const { items } = aiaItems({ jobsById, apps, linesByApp, budgetByJob: { J1: [{ id: 'B1', job_id: 'J1', owner_amount: 10000 }] } })
    expect(items.filter(i => i.category === 'unbilled')).toHaveLength(0)
    const paidLess = aiaItems({ jobsById, apps: [{ ...apps[0], amount_received: 400 }], linesByApp, budgetByJob: { J1: [{ id: 'B1', job_id: 'J1', owner_amount: 10000 }] } }).items
    expect(paidLess).toHaveLength(1)
    expect(paidLess[0]).toMatchObject({ category: 'receivable', amount: 500, confidence: 'uncertain' })
    expect(paidLess[0].notes).toContain('payment_on_draft')
  })

  test('draft with a legacy payment: Owner / PM can void it through the API; recording stays refused', async () => {
    const draft = mockState.db.aia_applications.find(a => a.id === 'ADraft')
    Object.assign(draft, { payment_received: true, amount_received: 250, payment_received_at: '2026-08-01T17:00:00Z' })
    mockState.db.aia_payment_entries.push({ id: 'EL', application_id: 'ADraft', job_id: 'J1', amount: 250, received_on: '2026-08-01', reference: 'Recorded before itemized payments', voided_at: null })
    as('pm')
    expect((await call(pay.POST, '/api/aia-payments', 'POST', { application_id: 'ADraft', amount: 5, confirm_mismatch: true })).body.code).toBe('draft')
    const r = await call(pay.PATCH, '/api/aia-payments', 'PATCH', { id: 'EL', action: 'void', reason: 'Entered on the wrong app' })
    expect(r.status).toBe(200)
    expect(draft).toMatchObject({ amount_received: null, payment_received: false, payment_received_at: null })
  })

  test('draft-void UI: ledger + Void open on drafts for Owner / PM; no new-payment form or save on drafts', () => {
    const page = read('app/jobdetail/page.js')
    const open = page.slice(page.indexOf('async function openRecordPayment('), page.indexOf('async function postAiaPayment('))
    expect(open).not.toMatch(/app\.status === 'draft'\) return/)
    expect(open).toMatch(/if \(!app \|\| !canRecordAiaPayment\(userRole\)\) return/)
    expect(open).toMatch(/draft: isDraft/)
    const save = page.slice(page.indexOf('async function savePaymentReceived('), page.indexOf('async function voidAiaPayment('))
    expect(save).toMatch(/if \(!paymentForm\.appId \|\| paymentForm\.draft\) return/)
    // Button: recording still only on non-drafts; drafts with a payment get a void-only entry point.
    expect(page).toMatch(/activeAia\.status === 'draft' && canRecordAiaPayment\(userRole\) && \(activeAia\.payment_received \|\| Number\(activeAia\.amount_received\) > 0\)/)
    expect(page).toMatch(/Payments \(void only\)/)
    // Modal: Void stays per entry; amount/date/reference + Save sit behind !paymentForm.draft.
    const modal = page.slice(page.indexOf('── PAYMENT RECEIVED MODAL ──'), page.indexOf('── PAYMENT RECEIVED MODAL ──') + 9000)
    expect(modal).toMatch(/onClick=\{\(\) => voidAiaPayment\(e\)\}/)
    const draftIdx = modal.indexOf('{paymentForm.draft ? (')
    expect(draftIdx).toBeGreaterThan(modal.indexOf('voidAiaPayment(e)'))
    expect(modal.indexOf('Amount received ($)')).toBeGreaterThan(draftIdx)
    expect(modal.indexOf('onClick={savePaymentReceived}')).toBeGreaterThan(modal.indexOf(') : (<>', draftIdx))
  })

  test('job page: no browser write of payment columns; button hidden on drafts; migration 053 not applied-safe', () => {
    const page = read('app/jobdetail/page.js')
    expect(page).not.toMatch(/from\('aia_applications'\)\.update\(\{\s*payment_received/)
    expect(page).not.toMatch(/amount_received:\s*parseFloat/)
    expect(page).toMatch(/activeAia\.status !== 'draft' && canRecordAiaPayment\(userRole\)/)
    expect(page).toMatch(/\/api\/aia-payments\?application_id=/)
    const sql = sqlOnly(read('migrations/053_aia_payment_entries.sql'))
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.aia_payment_entries/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).not.toMatch(/CREATE POLICY/)
    expect(sql).toMatch(/aia_applications_payment_columns_guard/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('2) bid package APM access', () => {
  const bids = require('../app/api/bid-packages/route')
  const plan = require('../app/api/bid-plan/route')

  beforeEach(() => {
    resetMockState({
      bid_packages: [
        { id: 'P1', title: 'Pre-award A', job_id: null, status: 'open', allowed_users: ['apm1'], created_at: '2026-11-01' },
        { id: 'P2', title: 'Pre-award B', job_id: null, status: 'open', allowed_users: [], created_at: '2026-11-02' },
      ],
      bid_plans: [{ id: 'pl2', bid_package_id: 'P2', storage_path: 'P2/plans.pdf' }],
      bid_invitations: [{ id: 'i2', bid_package_id: 'P2', sub_email: 's@x.com' }],
      bid_submissions: [{ id: 's2', bid_package_id: 'P2', amount: 100 }],
      bid_rfis: [],
      pm_job_assignments: [],
      jobs: [],
    })
  })

  test('APM: PATCH only packages they are on; never allowed_users; cannot add themselves', async () => {
    as('apm')
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', allowed_users: ['apm1'] })).status).toBe(403)
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', status: 'closed' })).status).toBe(403)
    expect(mockState.db.bid_packages[1]).toMatchObject({ allowed_users: [], status: 'open' })
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P1', status: 'closed' })).status).toBe(200)
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P1', allowed_users: ['apm1', 'apm2'] })).status).toBe(403)
    expect((await call(bids.DELETE, '/api/bid-packages', 'DELETE', { id: 'P1' })).status).toBe(403)
  })

  test('super: no write access at all (PATCH / DELETE / POST)', async () => {
    as('super')
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', status: 'closed' })).status).toBe(403)
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', job_id: 'J9' })).status).toBe(403)
    expect((await call(bids.DELETE, '/api/bid-packages', 'DELETE', { id: 'P2' })).status).toBe(403)
    expect((await call(bids.POST, '/api/bid-packages', 'POST', { title: 'x' })).status).toBe(403)
    expect(mockState.db.bid_packages).toHaveLength(2)
    expect((await call(plan.POST, '/api/bid-plan', 'POST', { action: 'delete', path: 'P2/plans.pdf' })).status).toBe(403)
  })

  test('admin cannot change APM Access or delete; Owner / PM can', async () => {
    as('admin')
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', allowed_users: ['apm1'] })).status).toBe(403)
    expect((await call(bids.DELETE, '/api/bid-packages', 'DELETE', { id: 'P2' })).status).toBe(403)
    as('pm')
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', allowed_users: ['apm1', 'apm1'] })).status).toBe(200)
    expect(mockState.db.bid_packages[1].allowed_users).toEqual(['apm1'])
    expect((await call(bids.PATCH, '/api/bid-packages', 'PATCH', { id: 'P2', allowed_users: 'apm1' })).status).toBe(400)
    as('principal')
    expect((await call(bids.DELETE, '/api/bid-packages', 'DELETE', { id: 'P2' })).status).toBe(200)
    expect(mockState.db.bid_packages.map(p => p.id)).toEqual(['P1'])
  })

  test('GET: APM not on the package gets no_access; on it gets the bundle; list is filtered', async () => {
    as('apm')
    let r = await call(bids.GET, '/api/bid-packages?id=P2', 'GET')
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('no_access')
    r = await call(bids.GET, '/api/bid-packages?id=P1', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.package.id).toBe('P1')
    r = await call(bids.GET, '/api/bid-packages', 'GET')
    expect(r.body.packages.map(p => p.id)).toEqual(['P1'])
    as('pm')
    r = await call(bids.GET, '/api/bid-packages?id=P2', 'GET')
    expect(r.body).toMatchObject({ plans: [{ id: 'pl2' }], invitations: [{ id: 'i2' }], submissions: [{ id: 's2' }] })
    as('subcontractor')
    expect((await call(bids.GET, '/api/bid-packages?id=P1', 'GET')).status).toBe(403)
  })

  test('H2: job-limited PM / APM off the job cannot GET a job-linked package (?id= or list); jobless packages unchanged', async () => {
    mockState.db.jobs = [{ id: 'J1', pm_email: null }, { id: 'J2', pm_email: null }]
    mockState.db.pm_job_assignments = [{ id: 'a1', job_id: 'J1', user_id: 'pm1' }, { id: 'a2', job_id: 'J1', user_id: 'apm1' }]
    mockState.db.bid_packages.push(
      { id: 'PJ1', title: 'Job 1 pkg', job_id: 'J1', status: 'open', allowed_users: ['apm1'], created_at: '2026-11-03' },
      { id: 'PJ2', title: 'Job 2 pkg', job_id: 'J2', status: 'open', allowed_users: ['apm1'], created_at: '2026-11-04' },
    )
    mockState.db.bid_submissions.push({ id: 'sJ2', bid_package_id: 'PJ2', amount: 789123 })
    mockState.db.bid_plans.push({ id: 'plJ2', bid_package_id: 'PJ2', storage_path: 'PJ2/plans.pdf' })

    as('pm')
    let r = await call(bids.GET, '/api/bid-packages?id=PJ2', 'GET')
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).not.toContain('789123')
    expect(r.body.submissions).toBeUndefined()
    r = await call(bids.GET, '/api/bid-packages?id=PJ1', 'GET')
    expect(r.status).toBe(200)
    r = await call(bids.GET, '/api/bid-packages', 'GET')
    expect(r.body.packages.map(p => p.id).sort()).toEqual(['P1', 'P2', 'PJ1'])
    // Jobless pre-award package still readable under package-role rules.
    expect((await call(bids.GET, '/api/bid-packages?id=P2', 'GET')).status).toBe(200)

    as('apm')
    expect((await call(bids.GET, '/api/bid-packages?id=PJ2', 'GET')).status).toBe(403)
    expect((await call(bids.GET, '/api/bid-packages?id=PJ1', 'GET')).status).toBe(200)
    expect((await call(bids.GET, '/api/bid-packages', 'GET')).body.packages.map(p => p.id).sort()).toEqual(['P1', 'PJ1'])

    // PM on the job by pm_email passes.
    mockState.db.jobs[1].pm_email = 'PM1@x.com'
    as('pm')
    expect((await call(bids.GET, '/api/bid-packages?id=PJ2', 'GET')).status).toBe(200)

    // Owner / admin / super see every package.
    for (const role of ['principal', 'admin', 'super']) {
      as(role)
      expect((await call(bids.GET, '/api/bid-packages', 'GET')).body.packages).toHaveLength(4)
    }
  })

  test('H2: migration 054 job-scopes child tables and bid_leveling_entries (restrictive only)', () => {
    const sql = sqlOnly(read('migrations/054_bid_package_apm_access.sql'))
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.bid_job_access\(p_job_id text\)/)
    expect(sql).toMatch(/"bid54_bid_packages_job_scope" ON public\.bid_packages AS RESTRICTIVE/)
    expect(sql).toMatch(/bid54_bid_leveling_entries_select" ON public\.bid_leveling_entries AS RESTRICTIVE/)
    expect(sql).toMatch(/bid54_bid_leveling_entries_job_scope" ON public\.bid_leveling_entries AS RESTRICTIVE/)
    expect(sql).toMatch(/can_read_bid_package\(public\.bid_submission_package\(bid_submission_id\)\)/)
    // No permissive policy and no DROP of a non-054 policy.
    expect(sql).not.toMatch(/AS PERMISSIVE/)
    for (const m of sql.matchAll(/DROP POLICY IF EXISTS "?([^"\s]+)"?/g)) expect(m[1]).toMatch(/^(bid54_|%I)/)
  })

  test('APM cannot get plan links for a package they are not on; creating a package puts them on it', async () => {
    as('apm')
    expect((await call(plan.POST, '/api/bid-plan', 'POST', { action: 'signed-url', path: 'P2/plans.pdf' })).status).toBe(403)
    const r = await call(bids.POST, '/api/bid-packages', 'POST', { title: 'New' })
    expect(r.status).toBe(200)
    expect(mockState.db.bid_packages.find(p => p.id === r.body.id).allowed_users).toEqual(['apm1'])
  })

  test('/bid/[id] loads through the server and shows "no access"; RLS migration 054 is restrictive-only', () => {
    const page = read('app/bid/[id]/page.js')
    expect(page).toMatch(/authFetch\(`\/api\/bid-packages\?id=/)
    expect(page).toMatch(/NO_BID_ACCESS_MESSAGE/)
    expect(page).not.toMatch(/from\('bid_packages'\)\.(select|update|delete)/)
    const sql = sqlOnly(read('migrations/054_bid_package_apm_access.sql'))
    expect(sql).toMatch(/can_read_bid_package/)
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "bid_(packages|plans|invitations|submissions|rfis)_/)
    const creates = sql.match(/CREATE POLICY[^\n]*/g) || []
    expect(creates.length).toBeGreaterThan(0)
    for (const c of creates) expect(c).toMatch(/AS RESTRICTIVE|%I ON public\.%I AS RESTRICTIVE/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('3) meeting AI parser', () => {
  const route = require('../app/api/parse-meeting/route')
  const mp = require('../lib/meeting-parse')
  let sent
  const aiReply = (obj, stop = 'end_turn') => {
    global.fetch = jest.fn(async (_url, opts) => {
      sent = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ stop_reason: stop, content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }) }
    })
  }
  const transcript = 'OAC meeting. Bob will send the steel shop drawings by next Friday. '.repeat(3)
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'k'; as('pm'); resetMockState({}) })
  afterAll(() => { delete global.fetch })

  test('sends the meeting date into the prompt; flags due dates far from it', async () => {
    aiReply({ action_items: [
      { description: 'Shop drawings', due_date: '2026-11-13' },
      { description: 'Wrong year', due_date: '2025-11-13' },
      { description: 'Way out', due_date: '2028-01-01' },
      { description: 'Garbage', due_date: 'Friday' },
    ], decisions: [], contacts: [], topics: [] })
    const r = await call(route.POST, '/api/parse-meeting', 'POST', { transcript, meeting_date: '2026-11-06' })
    expect(r.status).toBe(200)
    expect(sent.messages[0].content).toContain('The meeting was held on 2026-11-06')
    expect(sent.max_tokens).toBe(mp.MEETING_PARSE_MAX_TOKENS)
    expect(sent.max_tokens).toBeGreaterThan(4096)
    const items = r.body.action_items
    expect(items[0]).toMatchObject({ due_date: '2026-11-13' })
    expect(items[0].due_date_flag).toBeUndefined()
    expect(items[1]).toMatchObject({ due_date: null, due_date_flag: 'out_of_range', due_date_raw: '2025-11-13' })
    expect(items[2]).toMatchObject({ due_date: null, due_date_flag: 'out_of_range' })
    expect(items[3]).toMatchObject({ due_date: null, due_date_flag: 'unreadable' })
    expect(r.body.meeting_date).toBe('2026-11-06')
  })

  test('no meeting date → today in America/Chicago', async () => {
    aiReply({ action_items: [], decisions: [], contacts: [], topics: [] })
    const r = await call(route.POST, '/api/parse-meeting', 'POST', { transcript })
    const { todayCentral } = require('../lib/central-date')
    expect(r.body.meeting_date).toBe(todayCentral())
    expect(sent.messages[0].content).toContain(`The meeting was held on ${todayCentral()}`)
  })

  test('limits aligned: the whole accepted transcript is analyzed; over the limit refused', async () => {
    aiReply({ action_items: [], decisions: [], contacts: [], topics: [] })
    const long = 'x'.repeat(mp.MEETING_TRANSCRIPT_MAX - 10) + ' RECAP-END'
    const r = await call(route.POST, '/api/parse-meeting', 'POST', { transcript: long, meeting_date: '2026-11-06' })
    expect(r.status).toBe(200)
    expect(sent.messages[0].content).toContain('RECAP-END')
    const tooLong = await call(route.POST, '/api/parse-meeting', 'POST', { transcript: 'y'.repeat(mp.MEETING_TRANSCRIPT_MAX + 1) })
    expect(tooLong.status).toBe(400)
    expect(read('app/api/parse-meeting/route.js')).not.toMatch(/slice\(0,\s*80000\)/)
  })

  test("stop_reason 'max_tokens' is reported as a cut-off reply, not unreadable output", async () => {
    aiReply('{"action_items": [{"description": "a"', 'max_tokens')
    const r = await call(route.POST, '/api/parse-meeting', 'POST', { transcript })
    expect(r.status).toBe(422)
    expect(r.body.code).toBe('truncated')
    expect(r.body.error).toBe(mp.TRUNCATED_REPLY_MESSAGE)
  })

  test('due pills show the year only when it is not the current year; page sends meeting_date', () => {
    const now = new Date('2026-11-08T18:00:00Z')
    expect(mp.formatDuePill('2026-11-14', now)).toBe('Nov 14')
    expect(mp.formatDuePill('2027-01-05', now)).toBe('Jan 5, 2027')
    expect(read('app/jobdetail/MeetingsTab.js')).toMatch(/Due \{formatDuePill\(a\.due_date\)\}/)
    expect(read('app/jobdetail/page.js')).toMatch(/meeting_date: meetingForm\.meeting_date \|\| null/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('4) Portal Bot logins', () => {
  const team = require('../app/api/team-members/route')
  const details = require('../app/api/jobs/details/route')
  const assign = require('../app/api/pm-job-assignments/route')

  beforeEach(() => {
    resetMockState({
      profiles: [
        { id: 'u1', full_name: 'Pat PM', role: 'pm' },
        { id: 'bot1', full_name: 'Portal Bot (Peyton)', role: 'pm', is_bot: true },
        { id: 'bot2', full_name: 'Bot without flag', role: 'pm' },
        { id: 'sub1', full_name: 'Sub', role: 'subcontractor' },
      ],
      jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', job_type: 'commercial', pm_email: 'pat@nv.com', status: 'active' }],
      pm_job_assignments: [],
    })
    mockState.authUsers = [
      { id: 'u1', email: 'pat@nv.com' },
      { id: 'bot1', email: 'bot-peyton@bots.nv.construction' },
      { id: 'bot2', email: 'bot-x@bots.nv.construction' },
    ]
    as('principal')
  })

  test('/api/team-members never lists bots (is_bot or bot email)', async () => {
    const r = await call(team.GET, '/api/team-members', 'GET')
    expect(r.status).toBe(200)
    expect(r.body.members.map(m => m.id)).toEqual(['u1'])
    expect(Object.keys(r.body.members[0]).sort()).toEqual(['email', 'full_name', 'id', 'phone', 'role'])
  })

  test('/api/jobs/details refuses a bot as the job PM', async () => {
    for (const email of ['bot-peyton@bots.nv.construction', 'BOT-X@bots.nv.construction']) {
      const r = await call(details.POST, '/api/jobs/details', 'POST', { id: 'J1', fields: { pm_email: email } })
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/Portal Bot/)
    }
    expect(mockState.db.jobs[0].pm_email).toBe('pat@nv.com')
  })

  test('/api/pm-job-assignments refuses a bot user', async () => {
    const r = await call(assign.POST, '/api/pm-job-assignments', 'POST', { job_id: 'J1', user_id: 'bot1' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Portal Bot/)
    expect(mockState.db.pm_job_assignments.find(a => a.user_id === 'bot1')).toBeUndefined()
    const ok = await call(assign.POST, '/api/pm-job-assignments', 'POST', { job_id: 'J1', user_id: 'u1' })
    expect(ok.status).toBe(200)
  })

  test('admin staff list filters bots', () => {
    const page = read('app/admin/page.js')
    expect(page).toMatch(/if \(!isBotAccount\(t\)\) map\[t\.id\]/)
  })

  test('staff pickers call /api/team-members with auth and surface errors (no plain fetch anywhere)', async () => {
    const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d => {
      const p = `${dir}/${d.name}`
      return d.isDirectory() ? walk(p) : /\.(js|jsx|ts|tsx)$/.test(d.name) ? [p] : []
    })
    const offenders = [...walk('app'), ...walk('lib')].filter(f => /(^|[^A-Za-z])fetch\(\s*['`"]\/api\/(team-members|pm-job-assignments)/.test(read(f)))
    expect(offenders).toEqual([])
    const dash = read('app/dashboard/page.js')
    expect(dash).toMatch(/authFetch\('\/api\/team-members'\)/)
    expect(dash).toMatch(/setTeamLoadError\(json\.error \|\| `HTTP \$\{res\.status\}`\)/)
    expect(dash).toMatch(/Could not load the team list/)
    const job = read('app/jobdetail/page.js')
    expect(job).toMatch(/authFetch\('\/api\/team-members'\)/)
    expect(job).toMatch(/Could not load staff/)
    // The route still refuses an unauthenticated / non-staff caller and lists real staff.
    const tm = require('../app/api/team-members/route')
    resetMockState({ profiles: [{ id: 'u1', full_name: 'Real PM', role: 'pm' }, { id: 'u2', full_name: 'Real APM', role: 'apm' }] })
    as('subcontractor')
    expect((await call(tm.GET, '/api/team-members', 'GET')).status).toBe(403)
    as('pm')
    const r = await call(tm.GET, '/api/team-members', 'GET')
    expect(r.body.members.map(m => m.id).sort()).toEqual(['u1', 'u2'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('5) commercial Complete Job & Report', () => {
  const details = require('../app/api/jobs/details/route')
  const page = read('app/jobdetail/page.js')
  const fnStart = page.indexOf('async function generateCompletionReport(')
  const fnBody = page.slice(fnStart, page.indexOf('async function buildCompletionReportHtml(', fnStart))

  test('no browser jobs write; goes through /api/jobs/details, checks res.ok, uses openHtml', () => {
    expect(fnStart).toBeGreaterThan(0)
    expect(page).not.toMatch(/from\('jobs'\)\.update\(\{\s*status:\s*'complete'/)
    expect(fnBody).toMatch(/authFetch\('\/api\/jobs\/details'/)
    expect(fnBody).toMatch(/fields: \{ status: 'complete' \}/)
    expect(fnBody).toMatch(/if \(!res\.ok \|\| out\.error\) \{ saveErr/)
    expect(fnBody).toMatch(/openHtml\(/)
    expect(fnBody.indexOf('markComplete && !saved')).toBeGreaterThan(0)
    expect(fnBody.indexOf('markComplete && !saved')).toBeLessThan(fnBody.indexOf('setJob('))
    const build = page.slice(page.indexOf('async function buildCompletionReportHtml('), page.indexOf('async function buildCompletionReportHtml(') + 20000)
    expect(build).not.toMatch(/window\.open\(/)
  })

  // Run the real generateCompletionReport source with stubbed closure deps and
  // the real openHtml (which swallows a thrown getHtml and returns null).
  async function runComplete({ authFetch, popupBlocked = false }) {
    const prevWindow = global.window
    global.window = { open: () => (popupBlocked ? null : { closed: false, close() {}, document: { open() {}, write() {}, close() {} } }), location: {} }
    const { openHtml } = require('../lib/open-file')
    const alerts = []
    const setJobCalls = []
    const deps = {
      canCompleteJob: true, id: 'J1', job: { id: 'J1', status: 'active' },
      setGeneratingReport: () => {}, setJob: f => setJobCalls.push(f), setForm: () => {},
      alert: m => alerts.push(m), openHtml, authFetch,
      buildCompletionReportHtml: async () => '<html>report</html>',
    }
    const names = Object.keys(deps)
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `return (${fnBody.slice(0, fnBody.lastIndexOf('}') + 1)})`)(...names.map(n => deps[n]))
    try { await fn(true) } finally { global.window = prevWindow }
    return { alerts, setJobCalls }
  }

  test('thrown save (offline) says NOT marked complete — never "Job marked complete"', async () => {
    const r = await runComplete({ authFetch: async () => { throw new TypeError('Failed to fetch') } })
    expect(r.alerts).toHaveLength(1)
    expect(r.alerts[0]).toMatch(/^Job was NOT marked complete: Failed to fetch/)
    expect(r.alerts.join(' ')).not.toMatch(/Job marked complete\./)
    expect(r.setJobCalls).toHaveLength(0)
  })

  test('refused save says NOT marked complete; confirmed save updates the job', async () => {
    let r = await runComplete({ authFetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }) })
    expect(r.alerts).toEqual(['Job was NOT marked complete: Forbidden'])
    expect(r.setJobCalls).toHaveLength(0)
    r = await runComplete({ authFetch: async () => ({ ok: true, status: 200, json: async () => ({ job: { id: 'J1', status: 'complete' } }) }) })
    expect(r.alerts).toEqual([])
    expect(r.setJobCalls).toHaveLength(1)
    // Confirmed save but pop-up blocked: completion is real, so it may say so.
    r = await runComplete({ popupBlocked: true, authFetch: async () => ({ ok: true, status: 200, json: async () => ({ job: { id: 'J1', status: 'complete' } }) }) })
    expect(r.setJobCalls).toHaveLength(1)
  })

  test('button hidden for supers (same writer roles as the Details API)', () => {
    expect(page).toMatch(/job\.status !== 'complete' && !job\.archived && canCompleteJob &&/)
    const { canWriteJobDetails } = require('../lib/job-details')
    expect(['principal', 'pm', 'apm', 'admin'].every(canWriteJobDetails)).toBe(true)
    expect(canWriteJobDetails('super')).toBe(false)
  })

  test('the API refuses a super and an unassigned APM; an assigned PM completes', async () => {
    resetMockState({
      jobs: [{ id: 'J1', job_number: '101', project_name: 'Main', job_type: 'commercial', status: 'active', pm_email: 'other@nv.com' }],
      pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }],
    })
    as('super')
    expect((await call(details.POST, '/api/jobs/details', 'POST', { id: 'J1', fields: { status: 'complete' } })).status).toBe(403)
    as('apm', 'apm9')
    expect((await call(details.POST, '/api/jobs/details', 'POST', { id: 'J1', fields: { status: 'complete' } })).status).toBe(403)
    expect(mockState.db.jobs[0].status).toBe('active')
    as('pm')
    const r = await call(details.POST, '/api/jobs/details', 'POST', { id: 'J1', fields: { status: 'complete' } })
    expect(r.status).toBe(200)
    expect(r.body.job.status).toBe('complete')
  })

  test('category breakdown honors is_credit; always-0 reducers removed', () => {
    const build = page.slice(page.indexOf('async function buildCompletionReportHtml('))
    expect(build).toMatch(/dcByCategory\[c\.category\] \+= \(c\.is_credit \? -1 : 1\)/)
    expect(page).not.toMatch(/totalBilledAIA/)
    expect(page).not.toMatch(/const revenueReceived/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('6) change_log', () => {
  const logRoute = require('../app/api/log-change/route')
  const readRoute = require('../app/api/change-log/route')
  const { logChange } = require('../lib/change-log')
  const { logBotChange } = require('../lib/bot-api')

  beforeEach(() => {
    resetMockState({
      profiles: [{ id: 'pm1', full_name: 'Pat PM', role: 'pm' }, { id: 'bot1', full_name: 'Portal Bot (Vivek)', role: 'pm', is_bot: true }],
      jobs: [{ id: 'J1' }, { id: 'J2' }],
      pm_job_assignments: [{ id: 'a', job_id: 'J1', user_id: 'pm1' }, { id: 'b', job_id: 'J1', user_id: 'super1' }],
      change_log: [{ id: 'c1', job_id: 'J1', note: 'one' }, { id: 'c2', job_id: 'J2', note: 'two' }],
    })
  })

  test('logChange stamps changed_by_name from the profile, never the caller', async () => {
    await logChange({ job_id: 'J1', entity_type: 'job', changed_by: 'pm1', changed_by_name: 'Peyton White' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ changed_by: 'pm1', changed_by_name: 'Pat PM' })
  })

  test('name fallback refused: profile with no name, or no changed_by, stores null — never the caller name', async () => {
    mockState.db.profiles.push({ id: 'pm2', full_name: null, role: 'pm' }, { id: 'pm3', full_name: '  ', role: 'pm' })
    await logChange({ job_id: 'J1', entity_type: 'job', changed_by: 'pm2', changed_by_name: 'Peyton White' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ changed_by: 'pm2', changed_by_name: null })
    await logChange({ job_id: 'J1', entity_type: 'job', changed_by: 'pm3', changed_by_name: 'Peyton White' })
    expect(mockState.db.change_log.at(-1).changed_by_name).toBeNull()
    await logChange({ job_id: 'J1', entity_type: 'job', changed_by_name: 'Peyton White' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ changed_by: null, changed_by_name: null })
    await logChange({ job_id: 'J1', entity_type: 'job', changed_by: 'nobody', changed_by_name: 'Peyton White' })
    expect(mockState.db.change_log.at(-1).changed_by_name).toBeNull()
    expect(mockState.db.change_log.some(c => c.changed_by_name === 'Peyton White')).toBe(false)
    expect(read('lib/change-log.js')).not.toMatch(/\|\|\s*changed_by_name/)
    // 055 trigger: no coalesce to NEW.changed_by_name; cleared when no changed_by.
    const sql = sqlOnly(read('migrations/055_change_log_lockdown.sql'))
    const trig = sql.slice(sql.indexOf('FUNCTION public.change_log_stamp_name()'), sql.indexOf('REVOKE EXECUTE ON FUNCTION public.change_log_stamp_name()'))
    expect(trig).not.toMatch(/NEW\.changed_by_name\s*\)/)
    expect(trig).not.toMatch(/coalesce\([\s\S]*NEW\.changed_by_name/)
    expect(trig).toMatch(/ELSE\s+NEW\.changed_by_name := NULL;/)
  })

  test('Bot API entries are written with the service role (no user client) and named from the bot profile', async () => {
    const userClient = { from: () => { throw new Error('user client must not be used') } }
    await logBotChange({ id: 'bot1', full_name: 'spoof' }, userClient, { job_id: 'J1', entity_type: 'rfi', note: 'x' })
    expect(mockState.db.change_log.at(-1)).toMatchObject({ changed_by: 'bot1', changed_by_name: 'Portal Bot (Vivek)', note: 'x · via Bot API' })
    expect(read('lib/change-log.js')).not.toMatch(/client \|\| adminSupabase/)
  })

  test('/api/log-change: allow-listed entity_type + field, job_id required, writers only, name from the session', async () => {
    as('pm')
    expect((await call(logRoute.POST, '/api/log-change', 'POST', { entity_type: 'job', field_name: 'status' })).status).toBe(400)
    expect((await call(logRoute.POST, '/api/log-change', 'POST', { job_id: 'J1', entity_type: 'billing', field_name: 'status' })).status).toBe(400)
    expect((await call(logRoute.POST, '/api/log-change', 'POST', { job_id: 'J1', entity_type: 'job', field_name: 'amount_billed' })).status).toBe(400)
    expect((await call(logRoute.POST, '/api/log-change', 'POST', { job_id: 'J2', entity_type: 'job', field_name: 'status' })).status).toBe(403)
    const r = await call(logRoute.POST, '/api/log-change', 'POST', { job_id: 'J1', entity_type: 'job', entity_id: 'J2', field_name: 'status', old_value: 'active', new_value: 'complete', note: 'n', changed_by_name: 'Peyton White', changed_by: 'principal1' })
    expect(r.status).toBe(200)
    expect(mockState.db.change_log.at(-1)).toMatchObject({ job_id: 'J1', entity_id: 'J1', changed_by: 'pm1', changed_by_name: 'Pat PM' })
    for (const role of ['super', 'subcontractor', 'owner']) {
      as(role)
      expect((await call(logRoute.POST, '/api/log-change', 'POST', { job_id: 'J1', entity_type: 'job', field_name: 'status' })).status).toBe(403)
    }
  })

  test('/api/change-log reads are job-scoped (PM/APM/super must be on the job)', async () => {
    as('pm')
    expect((await call(readRoute.GET, '/api/change-log?job_id=J2', 'GET')).status).toBe(403)
    let r = await call(readRoute.GET, '/api/change-log?job_id=J1&limit=6', 'GET')
    expect(r.body.log.map(l => l.id)).toEqual(['c1'])
    as('super', 'super2')
    expect((await call(readRoute.GET, '/api/change-log?job_id=J1', 'GET')).status).toBe(403)
    as('super', 'super1')
    expect((await call(readRoute.GET, '/api/change-log?job_id=J1', 'GET')).status).toBe(200)
    as('principal')
    expect((await call(readRoute.GET, '/api/change-log?job_id=J2', 'GET')).status).toBe(200)
  })

  test('Overview Recent Activity no longer reads change_log directly; migration 055 drops the browser INSERT policy', () => {
    expect(read('app/jobdetail/page.js')).not.toMatch(/from\('change_log'\)/)
    expect(read('app/jobdetail/page.js')).toMatch(/\/api\/change-log\?job_id=\$\{encodeURIComponent\(id\)\}&limit=6/)
    const sql = sqlOnly(read('migrations/055_change_log_lockdown.sql'))
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Authenticated can insert change_log" ON public\.change_log/)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.change_log FROM anon, authenticated/)
    expect(sql).toMatch(/change_log_job_access\(job_id\)/)
    // only change_log policies are dropped
    for (const m of sql.match(/DROP POLICY[^;]*;/g)) expect(m).toMatch(/ON public\.change_log/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('7) NV Team role changes', () => {
  const fix = require('../app/api/fix-profile/route')
  const body = (user_id, role) => ({ action: 'team_role', user_id, role })

  beforeEach(() => {
    resetMockState({
      profiles: [
        { id: 'principal1', full_name: 'Olive Owner', role: 'principal' },
        { id: 'pm1', full_name: 'Pat PM', role: 'pm' },
        { id: 'apm1', full_name: 'Al APM', role: 'apm' },
        { id: 'sub1', full_name: 'Sub', role: 'subcontractor' },
        { id: 'bot1', full_name: 'Portal Bot', role: 'pm', is_bot: true },
      ],
      change_log: [],
    })
  })

  test('only an Owner can change roles (APM / super / PM self-promotion refused)', async () => {
    for (const [role, id] of [['apm', 'apm1'], ['super', 'super1'], ['pm', 'pm1'], ['admin', 'admin1']]) {
      as(role, id)
      const r = await call(fix.POST, '/api/fix-profile', 'POST', body(id, 'principal'))
      expect(r.status).toBe(403)
    }
    expect(mockState.db.profiles.filter(p => p.role === 'principal').map(p => p.id)).toEqual(['principal1'])
  })

  test('Owner changes a role; stamped in change_log from the session', async () => {
    as('principal')
    const r = await call(fix.POST, '/api/fix-profile', 'POST', body('pm1', 'apm'))
    expect(r.status).toBe(200)
    expect(mockState.db.profiles.find(p => p.id === 'pm1').role).toBe('apm')
    expect(mockState.db.change_log.at(-1)).toMatchObject({ entity_type: 'profile', entity_id: 'pm1', field_name: 'role', old_value: 'pm', new_value: 'apm', changed_by: 'principal1', changed_by_name: 'Olive Owner' })
  })

  test('last Owner cannot be demoted; allow-list; staff targets only; no bots', async () => {
    as('principal')
    let r = await call(fix.POST, '/api/fix-profile', 'POST', body('principal1', 'pm'))
    expect(r.status).toBe(409)
    expect(mockState.db.profiles[0].role).toBe('principal')
    expect((await call(fix.POST, '/api/fix-profile', 'POST', body('pm1', 'owner'))).status).toBe(400)
    expect((await call(fix.POST, '/api/fix-profile', 'POST', body('pm1', 'subcontractor'))).status).toBe(400)
    expect((await call(fix.POST, '/api/fix-profile', 'POST', body('sub1', 'pm'))).status).toBe(400)
    expect((await call(fix.POST, '/api/fix-profile', 'POST', body('bot1', 'apm'))).status).toBe(400)
    // with a second Owner, demoting one is allowed
    r = await call(fix.POST, '/api/fix-profile', 'POST', body('pm1', 'principal'))
    expect(r.status).toBe(200)
    r = await call(fix.POST, '/api/fix-profile', 'POST', body('principal1', 'pm'))
    expect(r.status).toBe(200)
  })

  test('dashboard role picker no longer writes profiles from the browser; migration 056 tightens trigger + policy', () => {
    const dash = read('app/dashboard/page.js')
    expect(dash).not.toMatch(/from\('profiles'\)\.update\(\{ role \}\)/)
    expect(dash).toMatch(/action: 'team_role', user_id: userId, role/)
    const sql = sqlOnly(read('migrations/056_profile_role_owner_only.sql'))
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.protect_profile_access_columns\(\)/)
    expect(sql).toMatch(/get_my_role\(\), ''\) <> 'principal'/)
    expect(sql).not.toMatch(/OR public\.is_office_user\(\)/)
    expect(sql).toMatch(/last Owner/)
    expect(sql).toMatch(/CREATE POLICY "profiles_office_update"[\s\S]*= 'principal'/)
    for (const m of sql.match(/DROP POLICY[^;]*;/g)) expect(m).toMatch(/ON public\.profiles/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('migration numbering', () => {
  test('new files are 053–056; 050–052 untouched/reserved; nothing writes 051 or 052', () => {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter(f => /^\d{3}_/.test(f))
    expect(files.filter(f => /^05[12]_/.test(f))).toEqual([])
    for (const f of ['053_aia_payment_entries.sql', '054_bid_package_apm_access.sql', '055_change_log_lockdown.sql', '056_profile_role_owner_only.sql']) {
      expect(files).toContain(f)
      expect(read(`migrations/${f}`)).toMatch(/PROPOSED — written, NOT applied/)
    }
  })
})
