// Metal-building commissions: the ONE place the money is computed.
// Pure (no imports), so the order page, the commission report and the API
// projection all use the same numbers. Everything is integer cents.
//
// Rules
//   base       = deposit leg + concrete net
//   deposit leg = the received-amount snapshot (mb_order_workflow.deposit_received_amount,
//                 taken when receipt was first recorded) or, without one, order.deposit_amount;
//                 counted ONCE, only when the deposit is
//                 recorded received (sales_orders.deposit_received = true).
//                 Before that it is $0, even if the contract is signed, the order is
//                 deposit_pending or the deposit request email went out. Recorded
//                 payments are never added on top of deposit_amount.
//   concrete net = concrete_charge - concrete_cost, only when BOTH were saved
//                 (0 counts as saved). Missing either -> no concrete portion and a
//                 'concrete_incomplete' flag. Net may be negative (cost > charge);
//                 it is not clamped.
//   split      = 40% salesman pool / 40% Nv / 20% marketing (Nv's company
//                 marketing bucket, not a person).
//   salesman pool is subdivided by sales_attribution.share_pct. With no attribution
//                 rows, the assigned salesperson gets 100%. Malformed attribution
//                 (duplicate rep, missing rep, share out of range, not exactly 100%)
//                 or no assignee -> nobody is awarded the pool and the Owner sees a flag.
//   negative base -> negative buckets (a loss is shown, never clamped), flagged.
//
// Rounding: amounts are parsed from decimal text to cents (half away from zero at
// the 3rd decimal). Splits use largest remainder on |amount| so the parts always add
// back to the whole exactly; ties go to the earlier bucket (salesman, Nv, marketing)
// or, for reps, the lower salesperson id. The sign is applied after allocation.

export const SPLIT = Object.freeze({ salesman: 40, nv: 40, marketing: 20 })

// Decimal text/number -> integer cents. null/undefined/'' -> null. Invalid -> NaN.
export function toCents(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' && v.trim() === '') return null
  if (typeof v !== 'number' && typeof v !== 'string') return NaN
  if (typeof v === 'number' && !Number.isFinite(v)) return NaN
  let s = typeof v === 'number' ? numberToPlain(v) : v.trim()
  const m = /^([+-])?(\d+)(?:\.(\d*))?$/.exec(s)
  if (!m) return NaN
  const neg = m[1] === '-'
  const whole = m[2]
  const frac = (m[3] || '')
  const two = (frac + '00').slice(0, 2)
  let cents = BigInt(whole) * 100n + BigInt(two)
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1n
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return NaN
  const n = Number(cents)
  return neg && n !== 0 ? -n : n
}

function numberToPlain(n) {
  // Numbers like 1e21 or 1e-7 have no plain decimal form via String(); toFixed covers sane money.
  const s = String(n)
  if (!/e/i.test(s)) return s
  if (Math.abs(n) >= 1e15) return 'x' // too large: rejected as NaN
  return n.toFixed(6)
}

export const centsToDollars = c => (c == null || Number.isNaN(c) ? null : c / 100)

export function formatCents(c) {
  if (c == null || Number.isNaN(c)) return '—'
  const neg = c < 0
  const a = Math.abs(c)
  const d = Math.floor(a / 100).toLocaleString('en-US')
  return `${neg ? '-' : ''}$${d}.${String(a % 100).padStart(2, '0')}`
}

// Split integer cents by integer weights with largest remainder. Exact.
export function allocate(totalCents, weights) {
  const W = weights.reduce((a, w) => a + w, 0)
  if (!W) return weights.map(() => 0)
  const sign = totalCents < 0 ? -1 : 1
  const T = BigInt(Math.abs(totalCents))
  const BW = BigInt(W)
  const parts = weights.map((w, i) => {
    const num = T * BigInt(w)
    return { i, base: num / BW, rem: num % BW }
  })
  let left = T - parts.reduce((a, p) => a + p.base, 0n)
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : (b.rem > a.rem ? 1 : -1)))
  for (const p of order) {
    if (left <= 0n) break
    p.base += 1n
    left -= 1n
  }
  return parts.map(p => {
    const n = Number(p.base) * sign
    return n === 0 ? 0 : n
  })
}

// share_pct (percent, up to 4 decimals) -> integer weight out of 1,000,000.
function pctWeight(p) {
  const n = typeof p === 'string' && p.trim() !== '' ? Number(p) : p
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 100) return null
  const w = Math.round(n * 10000)
  return Math.abs(w - n * 10000) > 1e-6 ? null : w
}

// Who shares the salesman pool. Returns { reps: [{ salesperson_id, salesperson_name, weight }], flags }.
export function resolveRecipients(order, attribution) {
  const rows = Array.isArray(attribution) ? attribution : []
  const flags = []
  if (!rows.length) {
    if (!order?.salesperson_id) return { reps: [], flags: ['no_assignee'] }
    return { reps: [{ salesperson_id: order.salesperson_id, salesperson_name: order.salesperson_name || null, weight: 1000000, source: 'assigned' }], flags }
  }
  const seen = new Set()
  const reps = []
  for (const r of rows) {
    if (!r || !r.salesperson_id) { flags.push('attribution_missing_rep'); continue }
    if (seen.has(r.salesperson_id)) { flags.push('attribution_duplicate_rep'); continue }
    seen.add(r.salesperson_id)
    const w = pctWeight(r.share_pct)
    if (w == null) { flags.push('attribution_bad_share'); continue }
    reps.push({ salesperson_id: r.salesperson_id, salesperson_name: r.salesperson_name || null, weight: w, source: 'attribution' })
  }
  if (!flags.length && reps.reduce((a, r) => a + r.weight, 0) !== 1000000) flags.push('attribution_total_not_100')
  if (flags.length) return { reps: [], flags: [...new Set(flags)] }
  reps.sort((a, b) => (a.salesperson_id < b.salesperson_id ? -1 : a.salesperson_id > b.salesperson_id ? 1 : 0))
  return { reps, flags }
}

/**
 * Full commission for one MB order.
 *   order:       { deposit_amount, deposit_received, salesperson_id, salesperson_name }
 *   concrete:    { concrete_charge, concrete_cost } (from mb_order_private) or null
 *   attribution: sales_attribution rows for the order
 */
export function computeMbCommission(order, concrete, attribution, { receivedAmount } = {}) {
  const flags = []
  // The amount snapshotted when receipt was first recorded (mb_order_workflow.
  // deposit_received_amount) wins over a later-edited live deposit_amount. Without a
  // snapshot (legacy / not received) the live amount is used, and only once received.
  const snapCents = toCents(receivedAmount)
  const snapValid = Number.isInteger(snapCents) && snapCents > 0
  const received = order?.deposit_received === true
  const useSnap = received && snapValid
  const depositCents = useSnap ? snapCents : toCents(order?.deposit_amount)
  const depositValid = Number.isInteger(depositCents) && depositCents > 0
  if (!depositValid) flags.push('deposit_amount_missing')
  if (!received) flags.push('deposit_not_received')
  const depositLeg = received && depositValid ? depositCents : 0

  const chargeCents = toCents(concrete?.concrete_charge)
  const costCents = toCents(concrete?.concrete_cost)
  const chargeOk = Number.isInteger(chargeCents)
  const costOk = Number.isInteger(costCents)
  const concreteComplete = chargeOk && costOk
  if (Number.isNaN(chargeCents) || Number.isNaN(costCents)) flags.push('concrete_invalid')
  if (!concreteComplete) flags.push('concrete_incomplete')
  const concreteNet = concreteComplete ? chargeCents - costCents : 0
  if (concreteComplete && concreteNet < 0) flags.push('concrete_negative_net')

  const base = depositLeg + concreteNet
  if (base < 0) flags.push('negative_base')
  const [salesman, nv, marketing] = allocate(base, [SPLIT.salesman, SPLIT.nv, SPLIT.marketing])

  const who = resolveRecipients(order, attribution)
  flags.push(...who.flags)
  const repCents = who.reps.length ? allocate(salesman, who.reps.map(r => r.weight)) : []
  const reps = who.reps.map((r, i) => ({
    salesperson_id: r.salesperson_id,
    salesperson_name: r.salesperson_name,
    share_pct: r.weight / 10000,
    source: r.source,
    cents: repCents[i],
  }))

  return {
    deposit_leg_cents: depositLeg,
    deposit_amount_cents: depositValid ? depositCents : null,
    deposit_basis: useSnap ? 'received_snapshot' : 'live',
    deposit_received: received,
    concrete_charge_cents: chargeOk ? chargeCents : null,
    concrete_cost_cents: costOk ? costCents : null,
    concrete_net_cents: concreteComplete ? concreteNet : null,
    concrete_complete: concreteComplete,
    base_cents: base,
    salesman_pool_cents: salesman,
    nv_cents: nv,
    marketing_cents: marketing,
    unassigned_pool_cents: reps.length ? 0 : salesman,
    reps,
    flags: [...new Set(flags)],
  }
}

// What a salesperson may see about one order: their own dollars and nothing that
// reveals the deal base, the other buckets, other reps or costs.
export function repCommissionView(full, userId) {
  const mine = (full?.reps || []).find(r => r.salesperson_id === userId)
  const REP_FLAGS = new Set(['deposit_not_received', 'deposit_amount_missing', 'concrete_incomplete'])
  const flags = full?.flags || []
  const pending = flags.filter(f => REP_FLAGS.has(f))
  if (flags.some(f => f.startsWith('attribution_') || f === 'no_assignee')) pending.push('split_under_review')
  return {
    my_commission_cents: mine ? mine.cents : 0,
    on_order: !!mine,
    pending,
  }
}
