/**
 * Prompt 54: metal-building commission math (one shared cents helper) and the
 * MB deposit-receipt / payment-status rules. Pure functions only.
 */
const { toCents, allocate, computeMbCommission, repCommissionView, formatCents, resolveRecipients } = require('../lib/mb-commission')
const { depositReceiptState, mbPaymentStatus, legacyPaymentStatus, parseMoneyInput, validDepositAmount, checkMbUpdate, checkMbCreate, canWorkMbOrder, sendPrerequisites } = require('../lib/mb-orders')
const { buildAttributionRows } = require('../lib/sales-attribution')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const order = (x = {}) => ({ division: 'metal_buildings', deposit_amount: 10000, deposit_received: true, salesperson_id: A, salesperson_name: 'Rep A', ...x })

describe('toCents', () => {
  test('exact decimal parsing, null vs invalid', () => {
    expect(toCents(10000)).toBe(1000000)
    expect(toCents('4000.10')).toBe(400010)
    expect(toCents('0')).toBe(0)
    expect(toCents(0)).toBe(0)
    expect(toCents(1.005)).toBe(101)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents('-12.345')).toBe(-1235)
    expect(toCents(null)).toBeNull()
    expect(toCents(undefined)).toBeNull()
    expect(toCents('')).toBeNull()
    expect(toCents('  ')).toBeNull()
    for (const bad of [NaN, Infinity, -Infinity, 'abc', '1e5', '12,000', {}, [], true]) expect(Number.isNaN(toCents(bad))).toBe(true)
  })
})

describe('allocate (largest remainder, exact)', () => {
  test('parts always sum to the whole, incl. odd cents and negatives', () => {
    for (const total of [0, 1, 2, 3, 7, 99, 101, 1400000, 1400001, -1, -7, -1400001, 123456789]) {
      const parts = allocate(total, [40, 40, 20])
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
    expect(allocate(1, [40, 40, 20])).toEqual([1, 0, 0])
    expect(allocate(-1, [40, 40, 20])).toEqual([-1, 0, 0])
    expect(allocate(3, [40, 40, 20])).toEqual([1, 1, 1])
  })
  test('many reps reconcile exactly', () => {
    const w = Array.from({ length: 7 }, () => 1)
    const parts = allocate(100000, w)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100000)
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
  })
})

describe('computeMbCommission', () => {
  test('REQUIRED: $10,000 received deposit + $4,000 concrete net -> 5600 / 5600 / 2800', () => {
    const r = computeMbCommission(order(), { concrete_charge: 9000, concrete_cost: 5000 }, [])
    expect(r.base_cents).toBe(1400000)
    expect(r.salesman_pool_cents).toBe(560000)
    expect(r.nv_cents).toBe(560000)
    expect(r.marketing_cents).toBe(280000)
    expect(r.reps).toEqual([expect.objectContaining({ salesperson_id: A, cents: 560000, source: 'assigned' })])
  })
  test('REQUIRED: 60/40 split of the salesman pool -> 3360 / 2240 (not a share of the whole base)', () => {
    const r = computeMbCommission(order(), { concrete_charge: 9000, concrete_cost: 5000 }, [
      { salesperson_id: B, salesperson_name: 'B', share_pct: 40 }, { salesperson_id: A, salesperson_name: 'A', share_pct: 60 },
    ])
    expect(r.reps.find(x => x.salesperson_id === A).cents).toBe(336000)
    expect(r.reps.find(x => x.salesperson_id === B).cents).toBe(224000)
    expect(r.nv_cents).toBe(560000)
  })
  test('deposit leg is $0 until received, then counted exactly once (never adds payments)', () => {
    const pending = computeMbCommission(order({ deposit_received: false, payment_status: 'deposit_pending', contract_signed_at: 'x' }), null, [])
    expect(pending.deposit_leg_cents).toBe(0)
    expect(pending.base_cents).toBe(0)
    expect(pending.flags).toEqual(expect.arrayContaining(['deposit_not_received', 'concrete_incomplete']))
    const got = computeMbCommission(order({ deposit_received: true }), null, [])
    expect(got.deposit_leg_cents).toBe(1000000)
    expect(got.base_cents).toBe(1000000)
  })
  test('concrete counts only when both saved; zero counts as present; missing either -> none + flag', () => {
    expect(computeMbCommission(order(), { concrete_charge: 0, concrete_cost: 0 }, []).concrete_complete).toBe(true)
    expect(computeMbCommission(order(), { concrete_charge: 500, concrete_cost: 0 }, []).base_cents).toBe(1050000)
    const half = computeMbCommission(order(), { concrete_charge: 500, concrete_cost: null }, [])
    expect(half.concrete_complete).toBe(false)
    expect(half.concrete_net_cents).toBeNull()
    expect(half.base_cents).toBe(1000000)
    expect(half.flags).toContain('concrete_incomplete')
    expect(computeMbCommission(order(), null, []).flags).toContain('concrete_incomplete')
  })
  test('cost > charge: negative net is not clamped; negative base gives negative buckets', () => {
    const r = computeMbCommission(order({ deposit_received: false }), { concrete_charge: 100, concrete_cost: 300.01 }, [])
    expect(r.concrete_net_cents).toBe(-20001)
    expect(r.base_cents).toBe(-20001)
    expect(r.salesman_pool_cents + r.nv_cents + r.marketing_cents).toBe(-20001)
    expect(r.salesman_pool_cents).toBeLessThan(0)
    expect(r.flags).toEqual(expect.arrayContaining(['concrete_negative_net', 'negative_base']))
  })
  test('odd cents: buckets and reps reconcile exactly', () => {
    const r = computeMbCommission(order({ deposit_amount: '1000.01' }), { concrete_charge: '0.02', concrete_cost: 0 }, [
      { salesperson_id: A, share_pct: 33.33 }, { salesperson_id: B, share_pct: 33.33 }, { salesperson_id: C, share_pct: 33.34 },
    ])
    expect(r.base_cents).toBe(100003)
    expect(r.salesman_pool_cents + r.nv_cents + r.marketing_cents).toBe(100003)
    expect(r.reps.reduce((a, x) => a + x.cents, 0)).toBe(r.salesman_pool_cents)
  })
  test('no attribution and no assignee: pool not awarded, flagged for the Owner', () => {
    const r = computeMbCommission(order({ salesperson_id: null }), null, [])
    expect(r.reps).toEqual([])
    expect(r.unassigned_pool_cents).toBe(r.salesman_pool_cents)
    expect(r.flags).toContain('no_assignee')
  })
  test('malformed attribution is flagged, not normalized or arbitrarily awarded', () => {
    const cases = [
      [[{ salesperson_id: A, share_pct: 60 }, { salesperson_id: A, share_pct: 40 }], 'attribution_duplicate_rep'],
      [[{ salesperson_id: null, share_pct: 100 }], 'attribution_missing_rep'],
      [[{ salesperson_id: A, share_pct: 0 }, { salesperson_id: B, share_pct: 100 }], 'attribution_bad_share'],
      [[{ salesperson_id: A, share_pct: 50 }, { salesperson_id: B, share_pct: 49.99 }], 'attribution_total_not_100'],
      [[{ salesperson_id: A, share_pct: 'abc' }], 'attribution_bad_share'],
    ]
    for (const [rows, flag] of cases) {
      const r = computeMbCommission(order(), null, rows)
      expect(r.reps).toEqual([])
      expect(r.flags).toContain(flag)
      expect(r.unassigned_pool_cents).toBe(400000)
    }
    expect(resolveRecipients(order(), [{ salesperson_id: A, share_pct: '100' }]).reps).toHaveLength(1)
  })
  test('zero everything is a clean zero row', () => {
    const r = computeMbCommission(order({ deposit_received: false, deposit_amount: null }), { concrete_charge: 0, concrete_cost: 0 }, [])
    expect([r.base_cents, r.salesman_pool_cents, r.nv_cents, r.marketing_cents]).toEqual([0, 0, 0, 0])
  })
  test('rep view exposes only own dollars (no base, other buckets, other reps, costs)', () => {
    const full = computeMbCommission(order(), { concrete_charge: 9000, concrete_cost: 5000 }, [{ salesperson_id: A, share_pct: 60 }, { salesperson_id: B, share_pct: 40 }])
    const v = repCommissionView(full, B)
    expect(v).toEqual({ my_commission_cents: 224000, on_order: true, pending: [] })
    expect(JSON.stringify(v)).not.toMatch(/560000|280000|1400000|336000|base|nv_|marketing|concrete_cost/)
    expect(repCommissionView(full, C).my_commission_cents).toBe(0)
    const bad = computeMbCommission(order(), null, [{ salesperson_id: A, share_pct: 50 }])
    expect(repCommissionView(bad, A).pending).toContain('split_under_review')
  })
  test('formatCents', () => {
    expect(formatCents(560000)).toBe('$5,600.00')
    expect(formatCents(-20001)).toBe('-$200.01')
    expect(formatCents(null)).toBe('—')
  })
})

describe('deposit receipt rule (MB)', () => {
  const o = { deposit_amount: 10000 }
  test('full only when deposit payments minus refunds cover the amount due', () => {
    expect(depositReceiptState(o, [{ payment_type: 'deposit', amount: 10000, payment_date: '2026-11-02' }]).full).toBe(true)
    expect(depositReceiptState(o, [{ payment_type: 'deposit', amount: 4000 }, { payment_type: 'deposit', amount: 6000, payment_date: '2026-11-05' }])).toMatchObject({ full: true, latest_deposit_date: '2026-11-05' })
    const partial = depositReceiptState(o, [{ payment_type: 'deposit', amount: 9999.99 }])
    expect(partial).toMatchObject({ full: false, partial: true })
    expect(depositReceiptState(o, [{ payment_type: 'progress', amount: 50000 }]).full).toBe(false)
    expect(depositReceiptState(o, [{ payment_type: 'final', amount: 50000 }, { payment_type: 'other', amount: 1 }]).full).toBe(false)
    expect(depositReceiptState(o, [{ payment_type: 'deposit', amount: 10000 }, { payment_type: 'refund', amount: 1 }]).full).toBe(false)
    expect(depositReceiptState({ deposit_amount: null }, [{ payment_type: 'deposit', amount: 10000 }]).full).toBe(false)
  })
  test('status: received only for a full deposit; never pending once received/paid', () => {
    expect(mbPaymentStatus({ payments: [{ payment_type: 'deposit', amount: 4000 }], contractValue: 50000, depositReceived: false, hasSignedRequest: true })).toBe('partial')
    expect(mbPaymentStatus({ payments: [], contractValue: 50000, depositReceived: false, hasSignedRequest: true })).toBe('deposit_pending')
    expect(mbPaymentStatus({ payments: [], contractValue: 50000, depositReceived: true, hasSignedRequest: true })).toBe('deposit_received')
    expect(mbPaymentStatus({ payments: [{ payment_type: 'final', amount: 50000 }], contractValue: 50000, depositReceived: false })).toBe('paid')
    // Roofing keeps the legacy rule (any deposit-typed payment = deposit_received)
    expect(legacyPaymentStatus([{ payment_type: 'deposit', amount: 1 }], 50000)).toBe('deposit_received')
  })
})

describe('money input validation', () => {
  test('zero, negative, NaN, Infinity, blank, malformed', () => {
    expect(parseMoneyInput('', 'X').value).toBeNull()
    expect(parseMoneyInput(null, 'X').value).toBeNull()
    expect(parseMoneyInput(0, 'X').value).toBe(0)
    expect(parseMoneyInput('0', 'X', { positive: true }).error).toMatch(/more than/)
    expect(parseMoneyInput(-1, 'X').error).toMatch(/negative/)
    expect(parseMoneyInput(NaN, 'X').error).toBeTruthy()
    expect(parseMoneyInput(Infinity, 'X').error).toBeTruthy()
    expect(parseMoneyInput('12abc', 'X').error).toBeTruthy()
    expect(parseMoneyInput('1.234', 'X').error).toMatch(/2 decimal/)
    expect(parseMoneyInput({}, 'X').error).toBeTruthy()
    expect(parseMoneyInput('4000.5', 'X').value).toBe(4000.5)
    for (const v of [0, -5, NaN, Infinity, '', null, 'abc']) expect(validDepositAmount(v)).toBe(false)
    expect(validDepositAmount('0.01')).toBe(true)
  })
})

describe('MB generic update/create allow-lists', () => {
  const rep = { role: 'metal_rep', userId: A }
  const pm = { role: 'pm', userId: 'pm' }
  const before = { division: 'metal_buildings', stage: 'quoted', deposit_amount: 10000, customer_email: 'a@b.co', salesperson_id: A, payment_status: 'none', deposit_received: false }
  test('protected fields cannot change; unchanged values are ignored; unknown fields rejected', () => {
    for (const k of ['stage', 'payment_status', 'deposit_received', 'deposit_received_date', 'signed_salesperson_id', 'signed_contract_value', 'contract_signed_at', 'division', 'supplier_id', 'concrete_cost', 'concrete_net']) {
      const r = checkMbUpdate(pm, before, { [k]: k === 'deposit_received' ? true : 'x' })
      expect(r.status).toBe(403)
    }
    expect(checkMbUpdate(pm, before, { stage: 'quoted', payment_status: 'none' }).fields).toEqual({})
    expect(checkMbUpdate(pm, before, { evil: 1 }).status).toBe(400)
  })
  test('reps cannot self-assign or reassign; office can', () => {
    expect(checkMbUpdate(rep, before, { salesperson_id: B }).status).toBe(403)
    expect(checkMbUpdate(pm, before, { salesperson_id: B }).fields).toEqual({ salesperson_id: B })
  })
  test('deposit/customer locked while signing; validated otherwise', () => {
    expect(checkMbUpdate(rep, before, { deposit_amount: 5 }, { locked: true }).status).toBe(409)
    expect(checkMbUpdate(rep, before, { customer_email: 'x@y.co' }, { locked: true }).status).toBe(409)
    expect(checkMbUpdate(rep, before, { deposit_amount: 10000 }, { locked: true }).fields).toEqual({})
    expect(checkMbUpdate(rep, before, { deposit_amount: -1 }).status).toBe(400)
    expect(checkMbUpdate(rep, before, { deposit_amount: 'NaN' }).status).toBe(400)
    expect(checkMbUpdate(rep, before, { customer_email: 'nope' }).status).toBe(400)
    expect(checkMbUpdate(rep, before, { deposit_amount: '12500.50' }).fields).toEqual({ deposit_amount: 12500.5 })
  })
  test('create: reps create for themselves, no status/receipt fields, roofing reps refused', () => {
    expect(checkMbCreate(rep, { division: 'metal_buildings', customer_name: 'X' }).fields).toMatchObject({ salesperson_id: A, division: 'metal_buildings' })
    expect(checkMbCreate(rep, { division: 'metal_buildings', salesperson_id: B }).status).toBe(403)
    expect(checkMbCreate(rep, { division: 'metal_buildings', deposit_received: true }).status).toBe(403)
    expect(checkMbCreate(rep, { division: 'metal_buildings', payment_status: 'paid' }).status).toBe(403)
    expect(checkMbCreate(rep, { division: 'metal_buildings', stage: 'contract_signed' }).status).toBe(403)
    expect(checkMbCreate({ role: 'roofing_rep', userId: C }, { division: 'metal_buildings' }).status).toBe(403)
  })
  test('who may work an MB order', () => {
    const o = { division: 'metal_buildings', salesperson_id: A }
    expect(canWorkMbOrder({ role: 'metal_rep', userId: A }, o, [])).toBe(true)
    expect(canWorkMbOrder({ role: 'metal_rep', userId: B }, o, [{ salesperson_id: B }])).toBe(true)
    expect(canWorkMbOrder({ role: 'metal_rep', userId: C }, o, [])).toBe(false)
    expect(canWorkMbOrder({ role: 'roofing_rep', userId: A }, o, [])).toBe(false)
    expect(canWorkMbOrder({ role: 'owner', userId: A }, o, [])).toBe(false)
    expect(canWorkMbOrder({ role: 'super', userId: A }, o, [])).toBe(false)
    expect(canWorkMbOrder({ role: 'pm', userId: 'x' }, o, [])).toBe(true)
    expect(canWorkMbOrder({ role: 'pm', userId: 'x' }, { division: 'commercial_roofing' }, [])).toBe(false)
  })
  test('prerequisites list what is missing', () => {
    const r = sendPrerequisites({ order: { stage: 'quoted' }, supplier: null, supplierForm: null, clientForm: null, paymentInstructionsConfigured: false, signedRequest: null })
    expect(r.ok).toBe(false)
    expect(r.items.filter(i => !i.ok).map(i => i.key)).toEqual(['supplier', 'supplier_form', 'client_form', 'customer_name', 'customer_email', 'deposit_amount', 'payment_instructions'])
  })
})

describe('contract-value sales credit is unchanged', () => {
  test('buildAttributionRows still validates percentages of contract value credit', () => {
    const staff = [{ id: A, full_name: 'A' }, { id: B, full_name: 'B' }]
    expect(buildAttributionRows('o', [{ salesperson_id: A, share_pct: 60 }, { salesperson_id: B, share_pct: 40 }], staff, 'u').rows).toHaveLength(2)
    expect(buildAttributionRows('o', [{ salesperson_id: A, share_pct: 60 }], staff, 'u').error).toMatch(/100/)
  })
})
