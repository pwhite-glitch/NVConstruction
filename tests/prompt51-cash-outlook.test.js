/**
 * Prompt 51: Owner-only company cash outlook + expected-pay dates.
 * Pure helper (weeks, G702, receivables, payables, payroll, bucketing),
 * GET /api/cash-outlook and PATCH /api/expected-payment-date with an in-memory
 * database. No real database, email or routine is touched.
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import {
  isValidDateOnly, weekBuckets, mondayOfDate, aiaCurrentPaymentDue, aiaItems, lenderDrawItems, billingItems,
  poItems, payrollItems, bucketize, outlookSummaryText, outlookViewState, duplicateAiaNumbers, r2, PO_PAY_DAYS,
} from '../lib/cash-outlook'

// ── In-memory DB with range() paging and call log ─────────────────────────────
let db
let calls
let mockAuth
let missingCols
let failSelect

function mockQuery(table) {
  const filters = []
  let op = 'select', payload = null, cols = '*', range = null, lim = null, wantRows = false
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)))
  const run = () => {
    calls.push({ table, op, payload, cols })
    if (op === 'select') {
      if (failSelect[table]) return { data: null, error: { message: failSelect[table] } }
      const miss = (missingCols[table] || []).find(c => new RegExp(`\\b${c}\\b`).test(cols))
      if (miss) return { data: null, error: { code: '42703', message: `column ${table}.${miss} does not exist` } }
      let out = rows()
      if (range) out = out.slice(range[0], range[1] + 1)
      if (lim != null) out = out.slice(0, lim)
      return { data: out.map(r => ({ ...r })), error: null }
    }
    if (op === 'update') {
      const miss = (missingCols[table] || []).find(c => c in payload)
      if (miss) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${miss}' column of '${table}' in the schema cache` } }
      const hit = rows()
      hit.forEach(r => Object.assign(r, payload))
      return { data: wantRows ? hit.map(r => ({ id: r.id, expected_payment_date: r.expected_payment_date ?? null })) : null, error: null }
    }
    return { data: null, error: null }
  }
  const q = {
    select: (c = '*') => { if (op === 'select') cols = c; else wantRows = true; return q },
    update: p => { op = 'update'; payload = p; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    order: () => q,
    limit: n => { lim = n; return q },
    range: (a, b) => { range = [a, b]; return q },
    maybeSingle: () => Promise.resolve(run()).then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: t => mockQuery(t) }) }))
jest.mock('../lib/server-auth', () => ({ requireAuth: async () => mockAuth }))

const outlookRoute = require('../app/api/cash-outlook/route')
const dateRoute = require('../app/api/expected-payment-date/route')

const req = (body, method = 'GET') => ({ url: 'http://x/api', method, headers: { get: () => 'Bearer t' }, json: async () => body })
const FORBIDDEN = ['pm', 'apm', 'super', 'admin', 'subcontractor', 'sub_pm', 'sub_admin', 'sub_estimator', 'owner', 'owner_rep', 'roofing_rep', 'metal_rep', null]

beforeEach(() => {
  db = {}
  calls = []
  missingCols = {}
  failSelect = {}
  mockAuth = { userId: 'u1', email: 'p@x.com', role: 'principal', error: null }
})

const job = (id, extra = {}) => ({ id, job_number: id, project_name: `Job ${id}`, job_type: 'commercial', status: 'active', archived: false, ...extra })
const byId = list => Object.fromEntries(list.map(j => [j.id, j]))

// ── Dates and weeks ──────────────────────────────────────────────────────────
describe('weeks and dates (America/Chicago, date-only)', () => {
  test('strict real calendar dates', () => {
    expect(isValidDateOnly('2026-11-07')).toBe(true)
    expect(isValidDateOnly('2028-02-29')).toBe(true)
    expect(isValidDateOnly('2026-02-29')).toBe(false)
    expect(isValidDateOnly('2026-02-30')).toBe(false)
    expect(isValidDateOnly('2026-13-01')).toBe(false)
    expect(isValidDateOnly('2026-1-01')).toBe(false)
    expect(isValidDateOnly('11/07/2026')).toBe(false)
    expect(isValidDateOnly('2026-11-07T00:00:00Z')).toBe(false)
    expect(isValidDateOnly(null)).toBe(false)
  })

  test('12 weeks by default, 8 as an option, Monday→Sunday with Friday payday', () => {
    const w = weekBuckets('2026-11-07') // Saturday
    expect(w).toHaveLength(12)
    expect(w[0]).toMatchObject({ start: '2026-11-02', end: '2026-11-08', payday: '2026-11-06' })
    expect(weekBuckets('2026-11-07', 8)).toHaveLength(8)
    expect(weekBuckets('2026-11-07', 5)).toHaveLength(12)
    expect(mondayOfDate('2026-11-08')).toBe('2026-11-02') // Sunday belongs to the week before
    expect(mondayOfDate('2026-11-09')).toBe('2026-11-09')
  })

  test('DST changes do not shift days (Nov 1 and Mar 8 2026)', () => {
    const fall = weekBuckets('2026-10-29')
    expect(fall.map(b => b.start).slice(0, 3)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    const spring = weekBuckets('2026-03-06')
    expect(spring.map(b => b.start).slice(0, 3)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16'])
  })

  test('year boundary', () => {
    const w = weekBuckets('2026-12-31')
    expect(w[0]).toMatchObject({ start: '2026-12-28', end: '2027-01-03', payday: '2027-01-01' })
    expect(w[11].end).toBe('2027-03-21')
  })
})

// ── G702 current payment due ─────────────────────────────────────────────────
describe('G702 current payment due (matches generateAIAFromApp)', () => {
  const budget = [{ id: 'b1', job_id: 'J', owner_amount: 10000, budget_amount: 8000 }, { id: 'b2', job_id: 'J', owner_amount: null, budget_amount: 5000 }]

  test('first app: dollar and percent mode lines, retainage 10%', () => {
    const app = { id: 'a1', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 10 }
    const lines = { a1: [
      { application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 2000 },
      { application_id: 'a1', budget_item_id: 'b2', dollar_this_period: null, pct_this_period: 20 }, // percent mode: 20% of 5000, not $0
    ] }
    const r = aiaCurrentPaymentDue({ app, apps: [app], linesByApp: lines, budgetItems: budget })
    expect(r.totalThis).toBe(3000)
    expect(r.due).toBe(2700)
  })

  test('second app: previous from prior app lines, previous certificate at previous retainage', () => {
    const a1 = { id: 'a1', job_id: 'J', app_number: 1, status: 'certified', retainage_pct: 10 }
    const a2 = { id: 'a2', job_id: 'J', app_number: 2, status: 'submitted', retainage_pct: 5 }
    const lines = {
      a1: [{ application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 4000 }],
      a2: [{ application_id: 'a2', budget_item_id: 'b1', dollar_this_period: 1000, dollar_prev: 999999 }], // stored cumulative dollar_prev ignored when prior apps exist
    }
    const r = aiaCurrentPaymentDue({ app: a2, apps: [a1, a2], linesByApp: lines, budgetItems: budget })
    // completed 5000, ret 5% = 250 → 4750 earned; previous certificates 4000 × 0.9 = 3600
    expect(r.totalPrev).toBe(4000)
    expect(r.due).toBe(1150)
  })

  test('default retainage 10% when blank; 0% honoured', () => {
    const app = { id: 'a1', job_id: 'J', app_number: 1, retainage_pct: null }
    const lines = { a1: [{ application_id: 'a1', budget_item_id: 'b1', dollar_this_period: 1000 }] }
    expect(aiaCurrentPaymentDue({ app, apps: [app], linesByApp: lines, budgetItems: budget }).due).toBe(900)
    const app0 = { ...app, retainage_pct: 0 }
    expect(aiaCurrentPaymentDue({ app: app0, apps: [app0], linesByApp: lines, budgetItems: budget }).due).toBe(1000)
  })

  test('prime and NV-sub sequences are separate', () => {
    const prime1 = { id: 'p1', job_id: 'J', app_number: 1, retainage_pct: 0 }
    const sub1 = { id: 's1', job_id: 'J', app_number: 1, nv_subcontract_id: 'SC', retainage_pct: 0 }
    const sub2 = { id: 's2', job_id: 'J', app_number: 2, nv_subcontract_id: 'SC', retainage_pct: 0 }
    const lines = {
      p1: [{ application_id: 'p1', budget_item_id: 'b1', dollar_this_period: 3000 }],
      s1: [{ application_id: 's1', line_description: 'Steel', scheduled_value: 9000, dollar_this_period: 2000, budget_item_id: 'b1' }],
      s2: [{ application_id: 's2', line_description: 'Steel', scheduled_value: 9000, dollar_this_period: 500 }],
    }
    const apps = [prime1, sub1, sub2]
    expect(aiaCurrentPaymentDue({ app: sub2, apps, linesByApp: lines, budgetItems: budget })).toMatchObject({ totalPrev: 2000, due: 500 })
    // A prime #2 must not pick up the NV-sub app #1 lines as "previous"
    const prime2 = { id: 'p2', job_id: 'J', app_number: 2, retainage_pct: 0 }
    const r = aiaCurrentPaymentDue({ app: prime2, apps: [...apps, prime2], linesByApp: { ...lines, p2: [] }, budgetItems: budget })
    expect(r.totalPrev).toBe(3000)
    expect(r.due).toBe(0)
  })
})

// ── Money in ─────────────────────────────────────────────────────────────────
describe('receivables', () => {
  const jobs = byId([job('J')])
  const budget = { J: [{ id: 'b1', job_id: 'J', owner_amount: 100000 }] }
  const one = (app, thisAmt = 1000) => aiaItems({ jobsById: jobs, apps: [app], linesByApp: { [app.id]: [{ application_id: app.id, budget_item_id: 'b1', dollar_this_period: thisAmt }] }, budgetByJob: budget, datesMigrated: true }).items

  test('net certificate 1000, received 200 → 800 residual', () => {
    const [it] = one({ id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, amount_received: 200 })
    expect(it).toMatchObject({ category: 'receivable', amount: 800, confidence: 'confirmed' })
    expect(it.notes).toContain('partial_payment')
  })

  test('certified included; settled excluded; expected date carried', () => {
    expect(one({ id: 'a', job_id: 'J', app_number: 1, status: 'certified', retainage_pct: 0, expected_payment_date: '2026-11-20' })[0]).toMatchObject({ amount: 1000, date: '2026-11-20', dateBasis: 'expected' })
    expect(one({ id: 'a', job_id: 'J', app_number: 1, status: 'certified', retainage_pct: 0, payment_received: true, amount_received: 1000 })).toHaveLength(0)
  })

  test('date ignored until migration 047 is applied', () => {
    const items = aiaItems({ jobsById: jobs, apps: [{ id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, expected_payment_date: '2026-11-20' }], linesByApp: { a: [{ application_id: 'a', budget_item_id: 'b1', dollar_this_period: 10 }] }, budgetByJob: budget, datesMigrated: false }).items
    expect(items[0].date).toBeNull()
  })

  test('payment_received with no amount → reconciliation warning, not paid in full and not 0', () => {
    const [it] = one({ id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, payment_received: true, amount_received: null })
    expect(it).toMatchObject({ confidence: 'uncertain', amount: 1000 })
    expect(it.notes).toContain('received_without_amount')
  })

  test('overpayment and negative certificate are visible, not clamped', () => {
    const [over] = one({ id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, payment_received: true, amount_received: 1300 })
    expect(over).toMatchObject({ amount: -300, confidence: 'uncertain' })
    const [neg] = one({ id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0 }, -500)
    expect(neg).toMatchObject({ amount: -500, confidence: 'uncertain' })
    expect(neg.notes).toContain('negative_certificate')
  })

  test('draft is separate unbilled work; prior cumulative dollars are not new inflow', () => {
    const app = { id: 'd', job_id: 'J', app_number: 1, status: 'draft', retainage_pct: 10 }
    const items = aiaItems({ jobsById: jobs, apps: [app], linesByApp: { d: [{ application_id: 'd', budget_item_id: 'b1', dollar_prev: 5000, dollar_this_period: 1000 }] }, budgetByJob: budget, datesMigrated: true }).items
    // completed 6000, retainage 600 → 5400; previous certificates 5000 × 0.9 = 4500 → 900 (not 5400)
    expect(items).toEqual([expect.objectContaining({ category: 'unbilled', amount: 900, confidence: 'estimated', gross_this_period: 1000 })])
  })

  test('two drafts in one sequence are alternatives, not added', () => {
    const apps = [{ id: 'd1', job_id: 'J', app_number: 3, status: 'draft', retainage_pct: 0 }, { id: 'd2', job_id: 'J', app_number: 4, status: 'draft', retainage_pct: 0 }]
    const items = aiaItems({ jobsById: jobs, apps, linesByApp: {}, budgetByJob: budget, datesMigrated: true }).items
    expect(items.every(i => i.confidence === 'uncertain' && i.notes.includes('multiple_drafts'))).toBe(true)
  })

  test('linked internal draw package counts once (draw_requests carry no receivable)', () => {
    const app = { id: 'a', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, linked_draw_request_id: 'DR1' }
    const items = aiaItems({ jobsById: jobs, apps: [app], linesByApp: { a: [{ application_id: 'a', budget_item_id: 'b1', dollar_this_period: 700 }] }, budgetByJob: budget, datesMigrated: true }).items
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(700)
  })

  test('Module X duplicate app #1: both kept by id, flagged, never silently dropped', () => {
    const apps = [
      { id: '891790d7', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0, payment_received: true, amount_received: 500 },
      { id: 'b258ed4e', job_id: 'J', app_number: 1, status: 'submitted', retainage_pct: 0 },
      { id: 'a2', job_id: 'J', app_number: 2, status: 'submitted', retainage_pct: 0 },
    ]
    const lines = { '891790d7': [{ application_id: '891790d7', budget_item_id: 'b1', dollar_this_period: 1000 }], b258ed4e: [{ application_id: 'b258ed4e', budget_item_id: 'b1', dollar_this_period: 1000 }], a2: [{ application_id: 'a2', budget_item_id: 'b1', dollar_this_period: 400 }] }
    expect(duplicateAiaNumbers(apps).size).toBe(1)
    const items = aiaItems({ jobsById: jobs, apps, linesByApp: lines, budgetByJob: budget, datesMigrated: true }).items
    expect(items.map(i => i.ref.id).sort()).toEqual(['891790d7', 'a2', 'b258ed4e'])
    expect(items.every(i => i.confidence === 'uncertain' && i.notes.includes('duplicate_app_number'))).toBe(true)
    // Nothing from them reaches the running balance
    const b = bucketize(items, { today: '2026-11-07' })
    expect(b.totals.in).toBe(0)
    expect(b.uncertain).toHaveLength(3)
  })

  test('residential jobs bill through lender draws; AIA on them is disclosed, not added', () => {
    const rj = byId([job('R', { job_type: 'residential' })])
    const r = aiaItems({ jobsById: rj, apps: [{ id: 'a', job_id: 'R', app_number: 1, status: 'submitted', retainage_pct: 0 }], linesByApp: {}, budgetByJob: {}, datesMigrated: true })
    expect(r.items).toHaveLength(0)
    expect(r.disclosures[0].code).toBe('aia_on_residential_job')
  })

  describe('lender draws', () => {
    const rj = byId([job('R', { job_type: 'residential' })])
    test('submitted/approved = requested; legacy funded unknown; partial funded residual', () => {
      const draws = [
        { id: 'd1', job_id: 'R', draw_number: 1, status: 'funded', amount_requested: 5000, amount_funded: null },
        { id: 'd2', job_id: 'R', draw_number: 2, status: 'funded', amount_requested: 1000, amount_funded: 700 },
        { id: 'd3', job_id: 'R', draw_number: 3, status: 'submitted', amount_requested: 2500 },
        { id: 'd4', job_id: 'R', draw_number: 4, status: 'draft', amount_requested: 900 },
        { id: 'd5', job_id: 'R', draw_number: 5, status: 'void', amount_requested: 99 },
      ]
      const { items } = lenderDrawItems({ jobsById: rj, draws, fundedMigrated: true, datesMigrated: true })
      const get = id => items.find(i => i.ref.id === id)
      expect(get('d1')).toMatchObject({ amount: null, confidence: 'uncertain', requested: 5000 })
      expect(get('d2')).toMatchObject({ amount: 300, confidence: 'confirmed' })
      expect(get('d3')).toMatchObject({ amount: 2500, category: 'receivable', confidence: 'confirmed' })
      expect(get('d4')).toMatchObject({ amount: 900, category: 'unbilled' })
      expect(get('d5')).toBeUndefined()
    })
    test('before 046, every funded draw is unknown (never assumed = requested)', () => {
      const { items } = lenderDrawItems({ jobsById: rj, draws: [{ id: 'd', job_id: 'R', draw_number: 1, status: 'funded', amount_requested: 1000, amount_funded: 1000 }], fundedMigrated: false, datesMigrated: false })
      expect(items[0]).toMatchObject({ amount: null, confidence: 'uncertain' })
    })
    test('duplicate draw numbers are ambiguous', () => {
      const { items } = lenderDrawItems({ jobsById: rj, draws: [{ id: 'x', job_id: 'R', draw_number: 1, status: 'submitted', amount_requested: 10 }, { id: 'y', job_id: 'R', draw_number: 1, status: 'submitted', amount_requested: 10 }], fundedMigrated: true, datesMigrated: true })
      expect(items.every(i => i.confidence === 'uncertain' && i.notes.includes('duplicate_draw_number'))).toBe(true)
    })
  })
})

// ── Money out ────────────────────────────────────────────────────────────────
describe('payables, POs, payroll', () => {
  const jobs = byId([job('J'), job('O', { payment_type: 'owner_pays_direct' })])

  test('approved unpaid included (net of retainage); paid_at = paid; pending/rejected excluded; approval ≠ payment', () => {
    const billings = [
      { id: 'b1', job_id: 'J', status: 'approved', amount_billed: 1000, retainage_held: 100, paid_at: null, ready_to_pay: false },
      { id: 'b2', job_id: 'J', status: 'approved', amount_billed: 1000, retainage_held: 0, paid_at: '2026-11-01T12:00:00Z' },
      { id: 'b3', job_id: 'J', status: 'pending', amount_billed: 1000 },
      { id: 'b4', job_id: 'J', status: 'rejected', amount_billed: 1000 },
    ]
    const r = billingItems({ jobsById: jobs, billings, datesMigrated: true })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ amount: 900, retainage: 100, gross: 1000, kind: 'out', confidence: 'confirmed' })
    expect(r.items[0].notes).toContain('not_ready_to_pay')
    expect(r.retainageHeld).toBe(100)
  })

  test('partial payment_amount deducted once; owner-pays-direct disclosed unless NV cuts the check', () => {
    const r = billingItems({ jobsById: jobs, datesMigrated: true, billings: [
      { id: 'p', job_id: 'J', status: 'approved', amount_billed: 1000, retainage_held: 100, payment_amount: 400, paid_at: null },
      { id: 'o', job_id: 'O', status: 'approved', amount_billed: 500, retainage_held: 0, paid_at: null },
      { id: 'n', job_id: 'O', status: 'approved', amount_billed: 300, retainage_held: 0, paid_at: null, nv_cuts_check: true },
    ] })
    expect(r.items.find(i => i.ref.id === 'p')).toMatchObject({ amount: 500 })
    expect(r.items.find(i => i.ref.id === 'n')).toMatchObject({ amount: 300 })
    expect(r.items.find(i => i.ref.id === 'o')).toBeUndefined()
    expect(r.ownerPaid).toEqual({ total: 500, count: 1 })
  })

  test('open POs: issued/received estimated at issued + 30 days; draft/closed excluded; owner check POs disclosed; overlap note', () => {
    const r = poItems({ jobsById: jobs, pos: [
      { id: 'i', job_id: 'J', status: 'issued', amount: 1200, issued_date: '2026-11-01', payment_type: 'reimbursement', draw_request_id: 'DR' },
      { id: 'r', job_id: 'J', status: 'received', amount: 300, issued_date: null, payment_type: 'reimbursement' },
      { id: 'd', job_id: 'J', status: 'draft', amount: 999, payment_type: 'reimbursement' },
      { id: 'c', job_id: 'J', status: 'closed', amount: 999, payment_type: 'reimbursement' },
      { id: 'k', job_id: 'J', status: 'issued', amount: 50, payment_type: 'check' },
    ] })
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ amount: 1200, date: '2026-12-01', dateBasis: 'assumed', confidence: 'estimated' })
    expect(r.items[0].notes).toEqual(expect.arrayContaining(['po_estimate', 'po_on_draw']))
    expect(r.items[1]).toMatchObject({ date: null })
    expect(r.ownerCheck).toEqual({ total: 50, count: 1 })
    expect(PO_PAY_DAYS).toBe(30)
  })

  test('payroll: each active employee once per Friday; inactive excluded; missing pay warned; no per-employee rows', () => {
    const e1 = { id: 'e1', active: true, weekly_salary: 1000, weekly_truck: 100, weekly_healthcare: 50, weekly_taxes: 75, name: 'Secret' }
    const r = payrollItems({ today: '2026-11-07', employees: [
      e1, { ...e1 }, { ...e1 }, // same employee allocated to 3 jobs → once
      { id: 'e2', active: false, weekly_salary: 5000 },
      { id: 'e3', active: true },
    ] })
    expect(r.summary).toMatchObject({ weekly: 1225, active_employees: 2, missing_pay_data: 1 })
    expect(r.summary.components).toEqual({ salary: 1000, truck: 100, healthcare: 50, taxes: 75 })
    // Saturday: this week's Friday (Nov 6) has passed → 11 Fridays in a 12-week window
    expect(r.items).toHaveLength(11)
    expect(r.items[0]).toMatchObject({ date: '2026-11-13', amount: 1225 })
    expect(JSON.stringify(r)).not.toMatch(/Secret|weekly_salary/)
  })
})

// ── Bucketing / running balance ──────────────────────────────────────────────
describe('bucketize', () => {
  const it = (id, kind, amount, date, extra = {}) => ({ id, kind, amount, date, category: kind === 'in' ? 'receivable' : 'sub_billing', confidence: 'confirmed', notes: [], ...extra })

  test('running balance with opening cash, negative weeks, lowest, cents rounding', () => {
    const items = [it('a', 'in', 0.1, '2026-11-09'), it('b', 'in', 0.2, '2026-11-09'), it('c', 'out', 500, '2026-11-17'), it('d', 'in', 100, '2026-11-25')]
    const r = bucketize(items, { today: '2026-11-07', opening: 300 })
    expect(r.openingKnown).toBe(true)
    expect(r.weeks[0]).toMatchObject({ opening: 300, ending: 300 })
    expect(r.weeks[1]).toMatchObject({ in: 0.3, ending: 300.3 })
    expect(r.weeks[2]).toMatchObject({ out: 500, net: -500, ending: -199.7, negative: true })
    expect(r.weeks[3]).toMatchObject({ ending: -99.7, negative: true })
    expect(r.lowest).toEqual({ start: '2026-11-16', ending: -199.7 })
    expect(r.negativeWeeks).toBe(10)
  })

  test('opening unknown → cumulative movement from $0, labelled in the summary', () => {
    const r = bucketize([it('c', 'out', 50, '2026-11-10')], { today: '2026-11-07', opening: null })
    expect(r.openingKnown).toBe(false)
    expect(r.weeks[1].ending).toBe(-50)
    const text = outlookSummaryText(r, { today: '2026-11-07' })
    expect(text).toMatch(/cumulative net movement from \$0, NOT a bank balance/)
    expect(text).toMatch(/2026-11-09\s+\$0\.00\s+\$50\.00\s+-\$50\.00\s+-\$50\.00\s+NEGATIVE/)
  })

  test('overdue → first week flagged; undated → Needs expected date; beyond window separate; recurring not listed', () => {
    const r = bucketize([
      it('old', 'in', 10, '2026-10-01'), it('none', 'out', 20, null), it('far', 'in', 30, '2027-06-01'),
      it('pay', 'out', 5, '2027-06-04', { category: 'payroll', recurring: true, confidence: 'estimated' }),
    ], { today: '2026-11-07' })
    expect(r.weeks[0].in).toBe(10)
    expect(r.weeks[0].overdueCount).toBe(1)
    expect(r.weeks[0].items[0].overdue).toBe(true)
    expect(r.unscheduled.map(i => i.id)).toEqual(['none'])
    expect(r.totals.unscheduledOut).toBe(20)
    expect(r.outOfWindow.map(i => i.id)).toEqual(['far'])
  })

  test('8-week window; estimates toggle; uncertain never counted', () => {
    const po = it('po', 'out', 100, '2026-11-10', { category: 'po', confidence: 'estimated' })
    const ub = it('ub', 'in', 70, '2026-11-10', { category: 'unbilled', confidence: 'estimated' })
    const unc = it('u', 'in', 999, '2026-11-10', { confidence: 'uncertain' })
    const def = bucketize([po, ub, unc], { today: '2026-11-07', weeks: 8 })
    expect(def.weeks).toHaveLength(8)
    expect(def.weeks[1]).toMatchObject({ in: 0, out: 100 })
    expect(def.excluded.map(i => i.id)).toEqual(['ub'])
    expect(def.uncertain.map(i => i.id)).toEqual(['u'])
    const flipped = bucketize([po, ub, unc], { today: '2026-11-07', includePO: false, includeUnbilled: true })
    expect(flipped.weeks[1]).toMatchObject({ in: 70, out: 0 })
  })

  test('card states: loading, error, empty, ready are distinct', () => {
    expect(outlookViewState({ status: 'loading', data: null })).toBe('loading')
    expect(outlookViewState({ status: 'error', data: null })).toBe('error')
    expect(outlookViewState({ status: 'ready', data: { items: [] } })).toBe('empty')
    expect(outlookViewState({ status: 'ready', data: { items: [{}] } })).toBe('ready')
  })

  test('r2 rounds to cents', () => {
    expect(r2(0.1 + 0.2)).toBe(0.3)
    expect(r2(1.005)).toBe(1.01)
  })
})

// ── GET /api/cash-outlook ────────────────────────────────────────────────────
describe('GET /api/cash-outlook', () => {
  test.each(FORBIDDEN)('role %s → 403 before any query', async role => {
    mockAuth = { userId: 'u', role, error: null }
    const res = await outlookRoute.GET(req())
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  test('unauthenticated stays 401', async () => {
    mockAuth = { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
    expect((await outlookRoute.GET(req())).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  test('Owner sees every job once (archived/complete included, preview excluded), >1000 rows fully paged, no salary fields, no-store', async () => {
    db.jobs = [job('A'), job('C', { status: 'complete', archived: true }), job('P', { is_preview_data: true })]
    db.billing_submissions = Array.from({ length: 1500 }, (_, i) => ({ id: `b${String(i).padStart(4, '0')}`, job_id: i % 2 ? 'A' : 'C', status: 'approved', amount_billed: 10, retainage_held: 0, paid_at: null, expected_payment_date: null }))
    db.billing_submissions.push({ id: 'prev', job_id: 'P', status: 'approved', amount_billed: 10, retainage_held: 0, paid_at: null })
    db.employees = [{ id: 'e', active: true, weekly_salary: 1000, weekly_truck: 0, weekly_healthcare: 0, weekly_taxes: 0 }]
    const res = await outlookRoute.GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/private.*no-store/)
    const body = await res.json()
    const bills = body.items.filter(i => i.category === 'sub_billing')
    expect(bills).toHaveLength(1500)
    expect(new Set(bills.map(i => i.ref.id)).size).toBe(1500)
    expect(bills.some(i => i.job.id === 'P')).toBe(false)
    expect(body.jobs_count).toBe(2)
    expect(body.preview_jobs_excluded).toBe(1)
    expect(body.payroll.weekly).toBe(1000)
    expect(JSON.stringify(body)).not.toMatch(/weekly_salary|weekly_truck|weekly_healthcare|weekly_taxes/)
    expect(body.migration).toEqual({ expected_payment_dates: true, amount_funded: true })
  })

  test('as-of date is the Central calendar date, not UTC (late Sunday night CT)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date('2026-11-09T03:30:00Z')) // Sun Nov 8, 9:30 PM CST
    try {
      db.jobs = [job('A')]
      db.employees = [{ id: 'e', active: true, weekly_salary: 100 }]
      const body = await (await outlookRoute.GET(req())).json()
      expect(body.as_of).toBe('2026-11-08')
      const r = bucketize(body.items, { today: body.as_of })
      expect(r.weeks[0].start).toBe('2026-11-02')
      expect(body.items.filter(i => i.category === 'payroll')[0].date).toBe('2026-11-13')
    } finally {
      jest.useRealTimers()
    }
  })

  test('query error is a 500, never zeros', async () => {
    db.jobs = [job('A')]
    failSelect.billing_submissions = 'boom'
    const res = await outlookRoute.GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sub billings/)
  })

  test('before migration 047: dates reported missing, items undated', async () => {
    db.jobs = [job('A')]
    db.billing_submissions = [{ id: 'b', job_id: 'A', status: 'approved', amount_billed: 10, retainage_held: 0, paid_at: null, expected_payment_date: '2026-11-20' }]
    missingCols = { aia_applications: ['expected_payment_date'], billing_submissions: ['expected_payment_date'], res_owner_draws: ['expected_payment_date', 'amount_funded'] }
    const body = await (await outlookRoute.GET(req())).json()
    expect(body.migration).toEqual({ expected_payment_dates: false, amount_funded: false })
    expect(body.items[0].date).toBeNull()
  })
})

// ── PATCH /api/expected-payment-date ─────────────────────────────────────────
describe('PATCH /api/expected-payment-date', () => {
  const APP = '891790d7-0000-4000-8000-000000000001'
  const BILL = 'b1111111-0000-4000-8000-000000000002'
  const DRAW = 'd2222222-0000-4000-8000-000000000003'
  const locked = () => ({ id: APP, job_id: 'J', status: 'certified', payment_received: true, amount_received: 1000, payment_received_at: '2026-10-01T00:00:00Z', expected_payment_date: null })
  beforeEach(() => { db.aia_applications = [locked()]; db.billing_submissions = [{ id: BILL, status: 'approved', paid_at: null, amount_billed: 5 }]; db.res_owner_draws = [{ id: DRAW, status: 'funded', funded_date: '2026-10-02', amount_requested: 10 }] })
  const patch = body => dateRoute.PATCH(req(body, 'PATCH'))

  test.each(FORBIDDEN)('role %s → 403 before any query', async role => {
    mockAuth = { userId: 'u', role, error: null }
    const res = await patch({ entity: 'aia_application', id: APP, expected_payment_date: '2026-12-01' })
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  test('Owner sets a date on a locked certified app: only the date changes', async () => {
    const before = locked()
    const res = await patch({ entity: 'aia_application', id: APP, expected_payment_date: '2026-12-01' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, expected_payment_date: '2026-12-01' })
    const writes = calls.filter(c => c.op === 'update')
    expect(writes).toEqual([expect.objectContaining({ table: 'aia_applications', payload: { expected_payment_date: '2026-12-01' } })])
    expect(db.aia_applications[0]).toEqual({ ...before, expected_payment_date: '2026-12-01' })
  })

  test('null clears; sub billing and lender draw entities work', async () => {
    db.aia_applications[0].expected_payment_date = '2026-12-01'
    expect((await patch({ entity: 'aia_application', id: APP, expected_payment_date: null })).status).toBe(200)
    expect(db.aia_applications[0].expected_payment_date).toBeNull()
    expect((await patch({ entity: 'billing_submission', id: BILL, expected_payment_date: '2026-11-20' })).status).toBe(200)
    expect(db.billing_submissions[0].paid_at).toBeNull()
    expect((await patch({ entity: 'res_owner_draw', id: DRAW, expected_payment_date: '2026-11-21' })).status).toBe(200)
    expect(db.res_owner_draws[0]).toMatchObject({ funded_date: '2026-10-02', status: 'funded' })
  })

  test.each(['2026-02-30', '2026-13-01', '11/07/2026', '2026-1-1', 'tomorrow', 20261201, '2026-12-01T00:00:00Z'])('invalid date %p rejected', async v => {
    const res = await patch({ entity: 'aia_application', id: APP, expected_payment_date: v })
    expect(res.status).toBe(400)
    expect(calls.filter(c => c.op === 'update')).toHaveLength(0)
  })

  test.each(['aia_applications', 'jobs', '__proto__', 'constructor', 'aia_application; drop table jobs', undefined])('entity %p rejected (allow-list)', async entity => {
    const res = await patch({ entity, id: APP, expected_payment_date: '2026-12-01' })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('extra financial fields refused; nothing written', async () => {
    const res = await patch({ entity: 'aia_application', id: APP, expected_payment_date: '2026-12-01', amount_received: 0, payment_received: false, status: 'draft' })
    expect(res.status).toBe(400)
    expect(calls.filter(c => c.op === 'update')).toHaveLength(0)
    expect(db.aia_applications[0]).toEqual(locked())
  })

  test('unknown id → 404 (looked up by id, not app_number)', async () => {
    const res = await patch({ entity: 'aia_application', id: '00000000-0000-4000-8000-00000000dead', expected_payment_date: '2026-12-01' })
    expect(res.status).toBe(404)
  })

  test('missing migration → 409 migration_required, never a false save', async () => {
    missingCols = { aia_applications: ['expected_payment_date'] }
    const res = await patch({ entity: 'aia_application', id: APP, expected_payment_date: '2026-12-01' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('migration_required')
    expect(body.ok).toBeUndefined()
    expect(body.error).toMatch(/047/)
  })
})

// ── Migration and page wiring ────────────────────────────────────────────────
describe('migration 047 and page wiring', () => {
  const root = path.join(__dirname, '..')
  const read = p => fs.readFileSync(path.join(root, p), 'utf8')

  test('047 is additive: nullable date columns + guard trigger, no defaults/backfill/DML', () => {
    const sql = read('migrations/047_cash_outlook_expected_payment_dates.sql')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    for (const t of ['aia_applications', 'res_owner_draws', 'billing_submissions']) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS expected_payment_date date;`))
    }
    expect(code).not.toMatch(/\bDEFAULT\b|\bUPDATE\s+public\.|\bDELETE\s+FROM|\bINSERT\s+INTO|date\s+NOT NULL|amount_funded|schedule_lines/i)
    expect(code).toMatch(/current_user NOT IN \('service_role', 'postgres', 'supabase_admin'\)/)
    expect(sql).toMatch(/PROPOSED — written, NOT applied/)
  })

  test('042 and 046 untouched', () => {
    expect(() => execSync('git diff --quiet HEAD -- migrations/042_drawings_aia_numbers_owner_draws.sql migrations/046_residential_access_and_bank_draws.sql', { cwd: root })).not.toThrow()
  })

  test('dashboard renders the card only for principals, outside loadAll', () => {
    const dash = read('app/dashboard/page.js')
    expect(dash).toMatch(/\{isPrincipal\(profile\?\.role\) && <CashOutlookCard \/>\}/)
    const loadAll = dash.slice(dash.indexOf('async function loadAll('), dash.indexOf('async function loadAll(') + 6000)
    expect(loadAll).not.toMatch(/cash-outlook|employees/)
  })

  test('job pages render the date editor only for principals', () => {
    const jd = read('app/jobdetail/page.js')
    expect(jd).toMatch(/isPrincipal\(userRole\) && !a\.payment_received && a\.status !== 'draft' && \(\s*<div[^>]*>\s*<ExpectedPayDateEditor entity="aia_application"/)
    expect(jd).toMatch(/isPrincipal\(userRole\) && b\.status === 'approved' && !b\.paid_at && \(\s*<div[^>]*>\s*<ExpectedPayDateEditor entity="billing_submission"/)
    const rj = read('app/residentialjobdetail/page.js')
    expect(rj).toMatch(/isOwnerRole && d\.status !== 'void' && \(\s*<div[^>]*>\s*<ExpectedPayDateEditor entity="res_owner_draw"/)
  })
})
