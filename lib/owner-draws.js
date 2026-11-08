// Residential owner/lender draws (res_owner_draws): Bank-line schedule, actual
// funded amounts, status rules. No server imports: page, API route and tests.
//
// PROPOSED columns (migration 046, written, NOT applied): amount_funded numeric,
// schedule_lines jsonb, attachments jsonb, and the 'void' status. Until 046 is
// applied the API refuses the features that need them; nothing is assumed.
//
// Legacy funded draws have no amount_funded: their received cash is UNKNOWN.
// It is never taken to be amount_requested and never backfilled.
import { bankAmount } from './residential-money'

const num = v => Number(v || 0)
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export const MIGRATION_REQUIRED = 'This needs database migration 046 (owner draw schedule, funded amount, attachments, void). It has not been applied yet, so nothing was saved.'

// Who may use /api/res-owner-draws (office money): Owner / admin on every job, PM / APM on
// their jobs. Supers, subs, client owners and reps are refused; the residential page hides
// the Owner Draw tab (and skips the load) for anyone else.
export const OWNER_DRAW_ROLES = ['principal', 'admin', 'pm', 'apm']
export const canUseOwnerDraws = role => OWNER_DRAW_ROLES.includes(role)

export const DRAW_STATUSES = ['draft', 'submitted', 'approved', 'funded', 'void']
// Financial schedule (amount, lines, number) is editable only while draft.
export const isDrawEditable = d => d?.status === 'draft'
// Allowed status moves. Void keeps the row (history) and is not reversible.
const NEXT = {
  draft: ['submitted', 'void'],
  submitted: ['approved', 'funded', 'void'],
  approved: ['funded', 'void'],
  funded: [],
  void: [],
}
export function drawStatusChangeError(from, to) {
  if (!DRAW_STATUSES.includes(to)) return `Unknown draw status "${to}".`
  if (from === to) return null
  if (!(NEXT[from] || []).includes(to)) return `A ${from || 'unknown'} draw can't be set to ${to}.`
  return null
}

// Received cash for one draw: number when known, null when the draw is funded
// but the amount was never recorded (legacy), 0 when not funded.
export function drawFundedAmount(d) {
  if (d?.status !== 'funded') return 0
  if (d.amount_funded === null || d.amount_funded === undefined || d.amount_funded === '') return null
  return num(d.amount_funded)
}

// Totals across a job's draws. Void draws are ignored; drafts are not "requested".
export function ownerDrawFunding(draws = []) {
  let requested = 0, fundedKnown = 0, unknownFunded = 0, fundedRequested = 0, drafts = 0
  for (const d of draws || []) {
    if (d.status === 'void') continue
    if (d.status === 'draft') { drafts += num(d.amount_requested); continue }
    requested += num(d.amount_requested)
    if (d.status === 'funded') {
      const f = drawFundedAmount(d)
      if (f === null) unknownFunded += 1
      else { fundedKnown += f; fundedRequested += num(d.amount_requested) }
    }
  }
  return {
    requested: round2(requested),
    drafts: round2(drafts),
    fundedKnown: round2(fundedKnown),
    unknownFunded,
    // Shortfall on draws whose funded amount is known (requested − received).
    variance: round2(fundedRequested - fundedKnown),
  }
}

// % funded of a denominator, or null when it can't be stated honestly
// (a funded draw's amount is unknown, or no denominator).
export function pctFunded(funding, denominator) {
  if (!funding || funding.unknownFunded > 0) return null
  const d = num(denominator)
  if (!(d > 0)) return null
  return (funding.fundedKnown / d) * 100
}

// Bank amount already drawn per budget line by OTHER non-draft, non-void draws
// numbered before `drawNumber` (all of them when drawNumber is null).
export function priorDrawnByLine(draws = [], { excludeId = null, drawNumber = null } = {}) {
  const map = {}
  for (const d of draws || []) {
    if (d.id === excludeId || d.status === 'draft' || d.status === 'void') continue
    if (drawNumber !== null && drawNumber !== undefined && !(num(d.draw_number) < num(drawNumber))) continue
    for (const l of Array.isArray(d.schedule_lines) ? d.schedule_lines : []) {
      if (!l?.budget_item_id) continue
      map[l.budget_item_id] = round2((map[l.budget_item_id] || 0) + num(l.this_period))
    }
  }
  return map
}

// G703-style rows from Bank amounts: scheduled, previous, this draw, total,
// % complete, balance to finish. thisByLine: { [budget_item_id]: amount }.
export function buildDrawSchedule(budgetItems = [], prior = {}, thisByLine = {}) {
  const rows = (budgetItems || []).map(b => {
    const scheduled = round2(num(bankAmount(b)))
    const previous = round2(num(prior[b.id]))
    const thisPeriod = round2(num(thisByLine[b.id]))
    const total = round2(previous + thisPeriod)
    return {
      budget_item_id: b.id,
      description: b.description || '',
      cost_code: b.cost_code || null,
      scheduled, previous, this_period: thisPeriod, total,
      pct: scheduled > 0 ? (total / scheduled) * 100 : null,
      balance: round2(scheduled - total),
    }
  })
  const sum = k => round2(rows.reduce((a, r) => a + r[k], 0))
  const totals = { scheduled: sum('scheduled'), previous: sum('previous'), this_period: sum('this_period'), total: sum('total'), balance: sum('balance') }
  totals.pct = totals.scheduled > 0 ? (totals.total / totals.scheduled) * 100 : null
  return { rows, totals }
}

// Server-side check of submitted lines. lines: [{ budget_item_id, this_period }].
// jobLines: the job's budget_items. Returns { error } or { lines } where each
// line carries a snapshot (description, scheduled Bank amount) for a stable print.
export function validateDrawLines(lines, jobLines, amountRequested) {
  if (!Array.isArray(lines)) return { error: 'schedule_lines must be a list.' }
  const byId = new Map((jobLines || []).map(b => [b.id, b]))
  const seen = new Set()
  const out = []
  for (const l of lines) {
    const id = l?.budget_item_id
    if (!id || !byId.has(id)) return { error: 'A schedule line is not a budget line on this job.' }
    if (seen.has(id)) return { error: 'A budget line appears twice in the schedule.' }
    seen.add(id)
    const raw = l.this_period
    const amt = typeof raw === 'string' && raw.trim() === '' ? 0 : Number(raw)
    if (!Number.isFinite(amt)) return { error: 'Every schedule amount must be a number.' }
    const v = round2(amt)
    if (v === 0) continue
    const b = byId.get(id)
    out.push({ budget_item_id: id, description: String(b.description || ''), scheduled_value: round2(num(bankAmount(b))), this_period: v })
  }
  const sum = round2(out.reduce((a, l) => a + l.this_period, 0))
  const req = Number(amountRequested)
  if (!Number.isFinite(req)) return { error: 'Amount requested must be a number.' }
  if (out.length && Math.abs(sum - round2(req)) > 0.005) {
    return { error: `Schedule lines total $${sum.toFixed(2)} but the amount requested is $${round2(req).toFixed(2)}.` }
  }
  return { lines: out, total: sum }
}

// Validated attachment entries already on a draw, plus a new one. Paths must
// live under "<job_id>/owner-draws/<draw_id>/".
export function drawAttachmentPathOk(path, jobId, drawId) {
  if (typeof path !== 'string') return false
  const prefix = `${String(jobId).toLowerCase()}/owner-draws/${drawId}/`
  if (!path.toLowerCase().startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return !!rest && !rest.includes('/') && !rest.includes('..')
}
