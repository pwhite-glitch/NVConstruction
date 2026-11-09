// Company-wide 8–12 week cash outlook (Owner-only). Pure helpers, no imports
// from the server: the API route builds the item list, the dashboard card
// buckets it, and the tests exercise both.
//
// Contract (see the card's Assumptions list, which repeats this in plain words):
//  • Weeks run Monday → Sunday, America/Chicago calendar dates (date-only
//    strings, no time-of-day, so no UTC / DST day shift). Payroll is assumed
//    paid on the Friday of each week.
//  • Opening cash is a SCENARIO the Owner types in. There is no bank feed.
//    Without it the card shows cumulative net movement from $0, which is NOT
//    a bank balance.
//  • Money IN (confirmed): submitted/certified AIA pay apps — G702 CURRENT
//    PAYMENT DUE (same math as the job page's generateAIAFromApp) less
//    amount_received; residential lender draws submitted/approved — amount
//    requested less amount_funded when known. Internal draw_requests are never
//    receivables (no amount). Residential jobs bill through res_owner_draws,
//    other jobs through aia_applications; the other table on that job is
//    reported, not added (no double count).
//  • Money OUT (confirmed): approved sub billings with paid_at NULL that NV
//    pays: amount_billed − retainage_held − any partial payment_amount.
//    Owner-pays-direct billings (job.payment_type 'owner_pays_direct' and not
//    nv_cuts_check) are disclosed, not counted.
//  • Money OUT (estimated): open POs (issued/received) paid by NV
//    (payment_type 'reimbursement'): assumed due issued_date + 30 days, less
//    approved direct costs linked to the PO (lib/po-cash.js, migration 067).
//    'check' POs are a check from the client owner to the vendor: disclosed.
//    Payroll: every active employee once per Friday (salary + truck +
//    healthcare + taxes).
//  • Unbilled work (estimated): the single draft pay app / lender draw per
//    billing sequence. Shown separately; only in the running balance when the
//    Owner ticks it AND it has an expected date.
//  • Dated items before today go in the first week, marked overdue. Undated
//    items go to "Needs expected date" — never fake-dated, never dropped.
//  • Uncertain items (duplicate app numbers, payment recorded with no amount,
//    funded draw with no funded amount, overpayments, negative certificates)
//    are listed with their amounts but kept out of the running balance.

import { isOpenPO, isOwnerCheckPO, poRemainingAmount, linkedDcsByPO } from './po-cash'

export const DEFAULT_WEEKS = 12
export const WEEK_OPTIONS = [8, 12]
export const PO_PAY_DAYS = 30 // estimated PO payment timing: issued_date + 30 days

export const MIGRATION_047_REQUIRED = 'Expected-payment dates need database migration 047 (expected_payment_date columns). It has not been applied yet, so nothing was saved.'

export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const isBlank = v => v === null || v === undefined || v === ''
const CENT = 0.005

// ── Date-only helpers (YYYY-MM-DD, calendar math at UTC noon) ────────────────
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// Strict YYYY-MM-DD that is a real calendar date.
export function isValidDateOnly(s) {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Monday of the week containing `date`.
export function mondayOfDate(date) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay() // 0 Sun … 6 Sat
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}
// Date part of a date or timestamp value; null when absent / not a date.
export function dateOnly(v) {
  if (isBlank(v)) return null
  const s = String(v).slice(0, 10)
  return isValidDateOnly(s) ? s : null
}

// Week buckets: [{ index, start (Mon), end (Sun), payday (Fri) }].
export function weekBuckets(today, weeks = DEFAULT_WEEKS) {
  const n = WEEK_OPTIONS.includes(Number(weeks)) ? Number(weeks) : DEFAULT_WEEKS
  const first = mondayOfDate(today)
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(first, 7 * i)
    return { index: i, start, end: addDays(start, 6), payday: addDays(start, 4) }
  })
}

// ── G702 current payment due (mirrors jobdetail openAiaApp + generateAIAFromApp) ──
const retFraction = (v, dflt) => {
  const p = parseFloat(v)
  return Math.max(0, Math.min(100, Number.isNaN(p) ? dflt : p)) / 100
}
const appNo = a => { const n = parseFloat(a?.app_number); return Number.isFinite(n) ? n : null }

// Dollars "this period" on one stored line: dollar_this_period when set,
// otherwise percent mode (pct_this_period × scheduled). null dollar ≠ $0.
function lineThis(line, scheduled) {
  if (!isBlank(line?.dollar_this_period)) return r2(num(line.dollar_this_period))
  return r2(scheduled * Math.max(0, parseFloat(line?.pct_this_period) || 0) / 100)
}

/**
 * CURRENT PAYMENT DUE for one application.
 * apps: every aia_applications row on the job; linesByApp: { [app_id]: lines };
 * budgetItems: the job's budget_items (prime apps schedule from owner_amount ?? budget_amount).
 * Returns { due, totalPrev, totalThis, totalCompleted, retainage, warnings[] }.
 */
export function aiaCurrentPaymentDue({ app, apps = [], linesByApp = {}, budgetItems = [] }) {
  const warnings = []
  const nvSub = app.nv_subcontract_id || null
  const n = appNo(app)
  const seq = apps.filter(a => a.job_id === app.job_id && (nvSub ? a.nv_subcontract_id === nvSub : !a.nv_subcontract_id))
  const prevApps = n == null ? [] : seq.filter(a => a.id !== app.id && appNo(a) != null && appNo(a) < n)
  const retPct = retFraction(app.retainage_pct, 10)
  const own = linesByApp[app.id] || []
  let rows

  if (nvSub) {
    const prevByDesc = {}
    for (const pa of prevApps) {
      for (const l of linesByApp[pa.id] || []) {
        if (!l.line_description) continue
        prevByDesc[l.line_description] = r2((prevByDesc[l.line_description] || 0) + lineThis(l, num(l.scheduled_value)))
      }
    }
    rows = own.map(l => {
      const sched = r2(num(l.scheduled_value))
      if (isBlank(l.dollar_this_period) && parseFloat(l.pct_this_period) > 0) warnings.push('percent_mode_nv_sub_line')
      const prev = prevApps.length ? (prevByDesc[l.line_description] || 0) : (isBlank(l.dollar_prev) ? 0 : r2(num(l.dollar_prev)))
      return { prev, thisAmt: lineThis(l, sched) }
    })
  } else {
    const items = budgetItems.filter(b => b.job_id === undefined || b.job_id === app.job_id)
    const sched = Object.fromEntries(items.map(b => [b.id, r2(num(b.owner_amount ?? b.budget_amount ?? 0))]))
    const prevByItem = {}
    for (const pa of prevApps) {
      for (const l of linesByApp[pa.id] || []) {
        prevByItem[l.budget_item_id] = r2((prevByItem[l.budget_item_id] || 0) + lineThis(l, sched[l.budget_item_id] || 0))
      }
    }
    const lineMap = Object.fromEntries(own.map(l => [l.budget_item_id, l]))
    if (own.some(l => !(l.budget_item_id in sched))) warnings.push('line_without_budget_item')
    rows = items.map(b => {
      const l = lineMap[b.id]
      const s = sched[b.id]
      let prev
      if (prevApps.length) prev = prevByItem[b.id] || 0
      else if (l && !isBlank(l.dollar_prev)) prev = r2(num(l.dollar_prev))
      else prev = r2(s * Math.max(0, parseFloat(l?.pct_prev) || 0) / 100)
      return { prev, thisAmt: l ? lineThis(l, s) : 0 }
    })
  }

  const totalPrev = rows.reduce((a, r) => a + r.prev, 0)
  const totalThis = rows.reduce((a, r) => a + r.thisAmt, 0)
  const totalCompleted = totalPrev + totalThis
  const retainage = totalCompleted * retPct
  const earnedLessRet = totalCompleted - retainage
  // Previous certificate uses the previous app's retainage (the highest number below this one).
  const prevNo = prevApps.reduce((m, a) => Math.max(m, appNo(a)), -Infinity)
  const prevAtNo = prevApps.filter(a => appNo(a) === prevNo)
  if (prevAtNo.length > 1 && new Set(prevAtNo.map(a => String(a.retainage_pct))).size > 1) warnings.push('previous_retainage_ambiguous')
  const prevRetPct = prevAtNo.length ? retFraction(prevAtNo[0].retainage_pct, 0) : retPct
  const prevCertificates = totalPrev * (1 - prevRetPct)
  return {
    due: r2(earnedLessRet - prevCertificates),
    totalPrev: r2(totalPrev), totalThis: r2(totalThis), totalCompleted: r2(totalCompleted), retainage: r2(retainage),
    warnings,
  }
}

// app_numbers that appear more than once in one sequence on one job.
export function duplicateAiaNumbers(apps = []) {
  const counts = new Map()
  for (const a of apps) {
    const key = `${a.job_id}|${a.nv_subcontract_id || 'prime'}|${appNo(a)}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k))
}
const seqKey = a => `${a.job_id}|${a.nv_subcontract_id || 'prime'}`

// ── Item builders (server) ───────────────────────────────────────────────────
// An item: { id, kind 'in'|'out', category, amount (>0 except flagged), date,
//   dateBasis 'expected'|'assumed'|null, confidence 'confirmed'|'estimated'|'uncertain',
//   label, job {id, job_number, project_name}, ref {entity, id} | null, notes[] }
const jobRef = j => j ? { id: j.id, job_number: j.job_number ?? null, project_name: j.project_name ?? null, job_type: j.job_type ?? null } : null

const residential = j => String(j?.job_type ?? '').trim().toLowerCase() === 'residential'

/**
 * Receivables + draft unbilled from aia_applications (non-residential jobs).
 * Returns { items, disclosures[] }.
 */
export function aiaItems({ jobsById, apps = [], linesByApp = {}, budgetByJob = {}, datesMigrated }) {
  const items = []
  const disclosures = []
  const dups = duplicateAiaNumbers(apps)
  const bySeq = {}
  for (const a of apps) (bySeq[seqKey(a)] = bySeq[seqKey(a)] || []).push(a)

  for (const app of apps) {
    const job = jobsById[app.job_id]
    if (!job) continue
    if (residential(job)) {
      if (app.status !== 'draft') disclosures.push({ code: 'aia_on_residential_job', job: jobRef(job), app_id: app.id, message: `AIA app #${app.app_number} on residential job ${job.job_number ?? ''} not counted — residential jobs bill through Owner/Lender Draws.` })
      continue
    }
    const seq = bySeq[seqKey(app)]
    const prevDup = seq.some(a => appNo(a) != null && appNo(a) <= appNo(app) && dups.has(`${seqKey(a)}|${appNo(a)}`))
    const calc = aiaCurrentPaymentDue({ app, apps: seq, linesByApp, budgetItems: budgetByJob[app.job_id] || [] })
    const label = `${app.nv_subcontract_id ? 'NV-sub app' : 'App'} #${app.app_number}`
    const base = {
      job: jobRef(job), ref: { entity: 'aia_application', id: app.id },
      date: datesMigrated ? dateOnly(app.expected_payment_date) : null,
      notes: calc.warnings.slice(),
    }
    base.dateBasis = base.date ? 'expected' : null
    if (prevDup) base.notes.push('duplicate_app_number')

    // A draft that already has a payment recorded (legacy data — Record Payment is
    // now refused on drafts) is not future unbilled money: the cash is in. It goes
    // through the receivable math below, flagged uncertain, so it is never counted
    // as incoming a second time.
    const draftPaid = app.status === 'draft' && (!!app.payment_received || num(app.amount_received) > CENT)
    if (app.status === 'draft' && !draftPaid) {
      // Unbilled estimate: only one draft per sequence, numbered after every sent app.
      const drafts = seq.filter(a => a.status === 'draft')
      const sentAfter = seq.some(a => a.status !== 'draft' && appNo(a) != null && appNo(a) > appNo(app))
      const ambiguous = drafts.length > 1 || sentAfter || prevDup
      items.push({ ...base, id: `aia-draft-${app.id}`, kind: 'in', category: 'unbilled', amount: calc.due, gross_this_period: calc.totalThis,
        label: `${label} (draft) — this-period work, net of retainage`,
        confidence: ambiguous || calc.due < -CENT ? 'uncertain' : 'estimated',
        notes: [...base.notes, ...(drafts.length > 1 ? ['multiple_drafts'] : []), ...(sentAfter ? ['draft_superseded'] : []), ...(calc.due < -CENT ? ['negative_certificate'] : [])] })
      continue
    }
    if (app.status !== 'submitted' && app.status !== 'certified' && !draftPaid) continue

    const received = isBlank(app.amount_received) ? null : num(app.amount_received)
    const notes = base.notes.slice()
    let amount = calc.due
    let confidence = 'confirmed'
    if (draftPaid) { notes.push('payment_on_draft'); confidence = 'uncertain' }
    if (app.payment_received && !(received > 0)) {
      notes.push('received_without_amount')
      confidence = 'uncertain'
    } else if (received !== null && received !== 0) {
      amount = r2(calc.due - received)
      if (Math.abs(amount) <= CENT) continue // settled
      if (amount < 0) { notes.push('overpaid'); confidence = 'uncertain' }
      else notes.push(app.payment_received ? 'short_paid' : 'partial_payment')
    } else if (app.payment_received) {
      continue
    }
    if (calc.due < -CENT) { notes.push('negative_certificate'); confidence = 'uncertain' }
    if (prevDup) confidence = 'uncertain'
    if (Math.abs(amount) <= CENT && confidence === 'confirmed') continue
    items.push({ ...base, id: `aia-${app.id}`, kind: 'in', category: 'receivable', amount, certificate_due: calc.due, amount_received: received,
      label: `${label} (${app.status})`, confidence, notes })
  }
  return { items, disclosures }
}

/** Residential lender draws (res_owner_draws) on residential jobs. */
export function lenderDrawItems({ jobsById, draws = [], fundedMigrated, datesMigrated }) {
  const items = []
  const disclosures = []
  const live = draws.filter(d => d.status !== 'void')
  const numCount = {}
  for (const d of live) { const k = `${d.job_id}|${d.draw_number}`; numCount[k] = (numCount[k] || 0) + 1 }
  const draftsByJob = {}
  for (const d of live) if (d.status === 'draft') draftsByJob[d.job_id] = (draftsByJob[d.job_id] || 0) + 1

  for (const d of live) {
    const job = jobsById[d.job_id]
    if (!job) continue
    if (!residential(job)) {
      if (d.status !== 'draft') disclosures.push({ code: 'lender_draw_on_commercial_job', job: jobRef(job), draw_id: d.id, message: `Owner/Lender Draw #${d.draw_number} on non-residential job ${job.job_number ?? ''} not counted — that job bills through AIA pay apps.` })
      continue
    }
    const dup = numCount[`${d.job_id}|${d.draw_number}`] > 1
    const requested = r2(num(d.amount_requested))
    const date = datesMigrated ? dateOnly(d.expected_payment_date) : null
    const base = { job: jobRef(job), ref: { entity: 'res_owner_draw', id: d.id }, date, dateBasis: date ? 'expected' : null, kind: 'in' }
    const notes = dup ? ['duplicate_draw_number'] : []
    const label = `Lender draw #${d.draw_number}`

    if (d.status === 'draft') {
      const many = draftsByJob[d.job_id] > 1
      items.push({ ...base, id: `draw-draft-${d.id}`, category: 'unbilled', amount: requested, label: `${label} (draft)`,
        confidence: many || dup ? 'uncertain' : 'estimated', notes: [...notes, ...(many ? ['multiple_drafts'] : [])] })
      continue
    }
    if (d.status === 'submitted' || d.status === 'approved') {
      if (Math.abs(requested) <= CENT) continue
      items.push({ ...base, id: `draw-${d.id}`, category: 'receivable', amount: requested, label: `${label} (${d.status})`,
        confidence: dup ? 'uncertain' : 'confirmed', notes })
      continue
    }
    if (d.status === 'funded') {
      const funded = fundedMigrated && !isBlank(d.amount_funded) ? num(d.amount_funded) : null
      if (funded === null) {
        // Legacy funded draw: received cash unknown. Never assumed = requested.
        items.push({ ...base, id: `draw-${d.id}`, category: 'receivable', amount: null, requested, label: `${label} (funded, amount unknown)`,
          confidence: 'uncertain', notes: [...notes, 'funded_amount_unknown'] })
        continue
      }
      const residual = r2(requested - funded)
      if (Math.abs(residual) <= CENT) continue
      items.push({ ...base, id: `draw-${d.id}`, category: 'receivable', amount: residual, requested, label: `${label} (funded, ${residual > 0 ? 'short' : 'over'})`,
        confidence: residual < 0 || dup ? 'uncertain' : 'confirmed', notes: [...notes, residual > 0 ? 'short_funded' : 'overfunded'] })
    }
  }
  return { items, disclosures }
}

/** Approved, unpaid sub billings (paid_at NULL). */
export function billingItems({ jobsById, billings = [], datesMigrated }) {
  const items = []
  let ownerPaidTotal = 0, ownerPaidCount = 0, retainageHeld = 0
  for (const b of billings) {
    if (b.status !== 'approved' || !isBlank(b.paid_at)) continue
    const job = jobsById[b.job_id]
    if (!job) continue
    const billed = num(b.amount_billed)
    const rawRet = num(b.retainage_held)
    const notes = []
    let ret = rawRet
    if (rawRet < 0 || rawRet > billed + CENT) { notes.push('invalid_retainage'); ret = 0 }
    const net = r2(billed - ret)
    const paid = num(b.payment_amount)
    let amount = net
    if (paid > 0) { amount = r2(net - paid); notes.push('partial_payment') }
    if (job.payment_type === 'owner_pays_direct' && !b.nv_cuts_check) {
      ownerPaidTotal += amount; ownerPaidCount += 1
      continue
    }
    retainageHeld += ret
    if (amount < -CENT) notes.push('overpaid')
    if (Math.abs(amount) <= CENT) continue
    if (!b.ready_to_pay) notes.push('not_ready_to_pay')
    const date = datesMigrated ? dateOnly(b.expected_payment_date) : null
    items.push({ id: `bill-${b.id}`, kind: 'out', category: 'sub_billing', amount, gross: r2(billed), retainage: r2(ret),
      date, dateBasis: date ? 'expected' : null, confidence: amount < 0 || notes.includes('invalid_retainage') ? 'uncertain' : 'confirmed',
      label: `${b.company_name || 'Sub billing'}${b.invoice_number ? ` · inv ${b.invoice_number}` : ''}`,
      job: jobRef(job), ref: { entity: 'billing_submission', id: b.id }, notes })
  }
  return { items, ownerPaid: { total: r2(ownerPaidTotal), count: ownerPaidCount }, retainageHeld: r2(retainageHeld) }
}

/** Open POs (issued/received) — ESTIMATED commitments, not invoices. */
// Same rule as the job Cash Flow tab (lib/po-cash.js): approved direct costs linked to a
// reimbursement PO (purchase_order_id, migration 067) reduce its estimate; owner-check POs
// stay disclosed at full amount.
export function poItems({ jobsById, pos = [], directCosts = [] }) {
  const items = []
  let ownerCheckTotal = 0, ownerCheckCount = 0
  const linked = linkedDcsByPO(directCosts)
  for (const po of pos) {
    if (!isOpenPO(po)) continue
    const job = jobsById[po.job_id]
    if (!job) continue
    if (isOwnerCheckPO(po)) { ownerCheckTotal += r2(num(po.amount)); ownerCheckCount += 1; continue }
    const amount = r2(poRemainingAmount(po, linked[po.id]))
    if (Math.abs(amount) <= CENT) continue
    const issued = dateOnly(po.issued_date)
    items.push({ id: `po-${po.id}`, kind: 'out', category: 'po', amount, date: issued ? addDays(issued, PO_PAY_DAYS) : null, dateBasis: issued ? 'assumed' : null,
      confidence: 'estimated', label: `PO ${po.po_number ?? ''} · ${po.vendor_name || 'vendor'} (${po.status})`.trim(),
      job: jobRef(job), ref: null, notes: ['po_estimate', ...(po.draw_request_id ? ['po_on_draw'] : [])] })
  }
  return { items, ownerCheck: { total: r2(ownerCheckTotal), count: ownerCheckCount } }
}

/**
 * Payroll: each ACTIVE employee once per week (salary + truck + healthcare + taxes),
 * on Fridays from today on. Allocations are never summed. Returns per-week items and
 * component totals only — no per-employee rows leave the server.
 */
export function payrollItems({ employees = [], today, weeks = DEFAULT_WEEKS }) {
  const comps = { salary: 0, truck: 0, healthcare: 0, taxes: 0 }
  let active = 0, missingPay = 0, unknownActive = 0
  const seen = new Set()
  for (const e of employees) {
    if (e.active === false) continue
    if (e.id != null) { if (seen.has(e.id)) continue; seen.add(e.id) }
    if (e.active !== true) unknownActive += 1
    active += 1
    const parts = [e.weekly_salary, e.weekly_truck, e.weekly_healthcare, e.weekly_taxes]
    if (parts.every(isBlank)) missingPay += 1
    comps.salary += num(e.weekly_salary); comps.truck += num(e.weekly_truck)
    comps.healthcare += num(e.weekly_healthcare); comps.taxes += num(e.weekly_taxes)
  }
  const weekly = r2(comps.salary + comps.truck + comps.healthcare + comps.taxes)
  const items = []
  if (weekly > 0) {
    for (const w of weekBuckets(today, weeks)) {
      if (w.payday < today) continue // this week's Friday already passed — no payroll ledger to say otherwise
      items.push({ id: `payroll-${w.payday}`, kind: 'out', category: 'payroll', amount: weekly, date: w.payday, dateBasis: 'assumed',
        confidence: 'estimated', label: 'Payroll (estimated, Friday)', job: null, ref: null, notes: [], recurring: true })
    }
  }
  return {
    items,
    summary: {
      weekly, active_employees: active, missing_pay_data: missingPay, active_flag_unknown: unknownActive,
      components: { salary: r2(comps.salary), truck: r2(comps.truck), healthcare: r2(comps.healthcare), taxes: r2(comps.taxes) },
    },
  }
}

// ── Bucketing (client + tests) ───────────────────────────────────────────────
// Which items count in the running balance.
export function inBalance(item, { includePO = true, includeUnbilled = false } = {}) {
  if (item.confidence === 'uncertain' || item.amount === null || !(item.amount > 0)) return false
  if (item.category === 'po') return includePO
  if (item.category === 'unbilled') return includeUnbilled
  return true
}

/**
 * Bucket items into weeks. opening: number | null (scenario).
 * Returns { weeks: [{ start, end, payday, opening, in, out, net, ending, negative, items, overdueCount }],
 *   unscheduled, outOfWindow, uncertain, excluded, totals, lowest, openingKnown }.
 */
export function bucketize(items = [], { today, weeks = DEFAULT_WEEKS, opening = null, includePO = true, includeUnbilled = false } = {}) {
  const buckets = weekBuckets(today, weeks)
  const last = buckets[buckets.length - 1].end
  const rows = buckets.map(b => ({ ...b, in: 0, out: 0, items: [], overdueCount: 0 }))
  const unscheduled = [], outOfWindow = [], uncertain = [], excluded = []
  const opts = { includePO, includeUnbilled }

  for (const it of items) {
    if (it.confidence === 'uncertain' || it.amount === null) { uncertain.push(it); continue }
    if (!inBalance(it, opts)) { excluded.push(it); continue }
    if (!it.date) { unscheduled.push(it); continue }
    if (it.date > last) { if (!it.recurring) outOfWindow.push(it); continue }
    const overdue = it.date < today
    const row = overdue ? rows[0] : rows.find(r => it.date >= r.start && it.date <= r.end) || rows[0]
    row.items.push(overdue ? { ...it, overdue: true } : it)
    if (overdue) row.overdueCount += 1
    if (it.kind === 'in') row.in += it.amount
    else row.out += it.amount
  }

  const openingKnown = typeof opening === 'number' && Number.isFinite(opening)
  let running = openingKnown ? r2(opening) : 0
  let lowest = null
  for (const r of rows) {
    r.in = r2(r.in); r.out = r2(r.out)
    r.net = r2(r.in - r.out)
    r.opening = running
    running = r2(running + r.net)
    r.ending = running
    r.negative = running < 0
    if (!lowest || running < lowest.ending) lowest = { start: r.start, ending: running }
  }
  const sum = (list, kind) => r2(list.filter(i => !kind || i.kind === kind).reduce((a, i) => a + num(i.amount), 0))
  return {
    weeks: rows,
    unscheduled, outOfWindow, uncertain, excluded,
    totals: {
      in: r2(rows.reduce((a, r) => a + r.in, 0)), out: r2(rows.reduce((a, r) => a + r.out, 0)),
      unscheduledIn: sum(unscheduled, 'in'), unscheduledOut: sum(unscheduled, 'out'),
      outOfWindowIn: sum(outOfWindow, 'in'), outOfWindowOut: sum(outOfWindow, 'out'),
      unbilled: sum(items.filter(i => i.category === 'unbilled' && i.confidence !== 'uncertain')),
      po: sum(items.filter(i => i.category === 'po')),
    },
    lowest,
    negativeWeeks: rows.filter(r => r.negative).length,
    openingKnown,
  }
}

export const NOTE_TEXT = {
  duplicate_app_number: 'Duplicate pay-app number in this sequence — not reconciled, not counted',
  duplicate_draw_number: 'Duplicate draw number on this job — not reconciled, not counted',
  received_without_amount: 'Marked paid with no amount received — reconcile; not counted',
  overpaid: 'Received more than the certificate — reconcile; not counted',
  short_paid: 'Payments recorded total less than the certificate — residual shown',
  payment_on_draft: 'Payment recorded on a draft pay app — reconcile; not counted as unbilled',
  partial_payment: 'Partial payment recorded — residual shown',
  negative_certificate: 'Negative certificate (credit) — not counted',
  funded_amount_unknown: 'Funded, but amount funded was never recorded — received cash unknown',
  short_funded: 'Funded for less than requested — residual shown',
  overfunded: 'Funded for more than requested — reconcile',
  multiple_drafts: 'More than one draft in this sequence — alternatives, not added together',
  draft_superseded: 'A later app was already sent — draft not counted',
  invalid_retainage: 'Retainage held is negative or above the billed amount — check the billing',
  not_ready_to_pay: 'Not marked ready to pay (waiver/approval) — still owed',
  po_estimate: `Estimated: no vendor invoice/due date on POs — assumed issued date + ${PO_PAY_DAYS} days; may overlap direct costs or billings`,
  po_on_draw: 'On an owner draw (owner-billed), not proof the vendor is paid',
  percent_mode_nv_sub_line: 'NV-sub line in percent mode — counted at % × scheduled; job page certificate may show $0',
  previous_retainage_ambiguous: 'Previous app number is duplicated with different retainage — previous certificate uncertain',
  line_without_budget_item: 'Pay-app line points to a deleted budget line — left out, as on the certificate',
}

// Plain-text summary for copy/print (the Friday preview). No sending.
export function outlookSummaryText(result, { today, generatedAt, opening = null, payroll = null } = {}) {
  const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const lines = []
  lines.push(`NV Construction — ${result.weeks.length}-week cash outlook (as of ${today} CT${generatedAt ? `, generated ${generatedAt}` : ''})`)
  lines.push(result.openingKnown ? `Opening cash (scenario, entered): ${money(opening)}` : 'Opening cash: not entered — figures are cumulative net movement from $0, NOT a bank balance.')
  lines.push('')
  lines.push('Week of     In            Out           Net           Ending')
  for (const w of result.weeks) {
    lines.push(`${w.start}  ${money(w.in).padEnd(13)} ${money(w.out).padEnd(13)} ${money(w.net).padEnd(13)} ${money(w.ending)}${w.negative ? '  NEGATIVE' : ''}${w.overdueCount ? `  (${w.overdueCount} overdue)` : ''}`)
  }
  lines.push('')
  if (result.lowest) lines.push(`Lowest: ${money(result.lowest.ending)} (week of ${result.lowest.start}); ${result.negativeWeeks} negative week(s).`)
  lines.push(`Needs expected date: in ${money(result.totals.unscheduledIn)}, out ${money(result.totals.unscheduledOut)} (${result.unscheduled.length} items, not in weeks).`)
  lines.push(`Beyond window: in ${money(result.totals.outOfWindowIn)}, out ${money(result.totals.outOfWindowOut)}.`)
  lines.push(`Needs reconciliation (not counted): ${result.uncertain.length} item(s).`)
  if (payroll) lines.push(`Payroll assumption: ${money(payroll.weekly)}/week on Fridays, ${payroll.active_employees} active employees.`)
  lines.push(`PO commitments are estimates (issued + ${PO_PAY_DAYS} days). Unbilled work is an estimate.`)
  return lines.join('\n')
}

// Card state: 'loading' | 'error' | 'empty' | 'ready'. An error is never shown as empty or $0.
export function outlookViewState({ status, data } = {}) {
  if (status === 'error') return 'error'
  if (status === 'loading' && !data) return 'loading'
  if (!data) return 'loading'
  return (data.items || []).length ? 'ready' : 'empty'
}
