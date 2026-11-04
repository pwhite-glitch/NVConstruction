// Pending direct costs across jobs, for the dashboard "Costs to Approve" tab.
// Approving/rejecting still goes through /api/dc-review; this only builds the list.

// Roles allowed to approve, unapprove, reject or edit a direct cost (used by /api/dc-review).
export const DC_APPROVER_ROLES = new Set(['principal', 'pm', 'apm', 'admin'])

// When the cost entered the queue: the row's created_at, falling back to the cost date.
export function submittedAt(cost) {
  if (cost?.created_at) return new Date(cost.created_at)
  if (cost?.cost_date) return new Date(cost.cost_date + 'T12:00:00')
  return null
}

export function daysWaiting(cost, now = new Date()) {
  const d = submittedAt(cost)
  if (!d || isNaN(d)) return null
  return Math.max(0, Math.floor((now - d) / 86400000))
}

// Credits (returns) count against the total, as on the job page.
export function signedAmount(cost) {
  const n = Number(cost?.amount) || 0
  return cost?.is_credit ? -n : n
}

export function queueTotal(costs) {
  return (costs || []).reduce((sum, c) => sum + signedAmount(c), 0)
}

// Attach job, budget line (cost code) and submitter name, oldest first.
export function buildApprovalQueue(costs, { jobs = [], budgetItems = [], profiles = [] } = {}) {
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]))
  const biMap = Object.fromEntries(budgetItems.map(b => [b.id, b]))
  const profMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  return (costs || [])
    .map(c => {
      const job = jobMap[c.job_id]
      // A line only counts if it is on the cost's own job (when the line's job is known).
      const found = c.budget_item_id ? biMap[c.budget_item_id] : null
      const bi = found && (found.job_id == null || found.job_id === c.job_id) ? found : null
      return {
        ...c,
        has_budget_line: !!bi,
        job_number: job?.job_number ?? null,
        project_name: job?.project_name ?? null,
        cost_code: bi?.cost_code ?? null,
        budget_line: bi?.description ?? null,
        submitted_by_name: profMap[c.submitted_by]?.full_name ?? null,
      }
    })
    .sort((a, b) => (submittedAt(a)?.getTime() ?? Infinity) - (submittedAt(b)?.getTime() ?? Infinity))
}

// ── Budget line picking (dashboard queue) ─────────────────────────────────────

const byCode = (a, b) =>
  String(a.cost_code ?? '').localeCompare(String(b.cost_code ?? ''), undefined, { numeric: true }) ||
  String(a.description ?? '').localeCompare(String(b.description ?? ''))

// Budget lines keyed by job_id, each list sorted by cost code. Only id, cost_code, description kept.
export function budgetLinesByJob(items) {
  const out = {}
  for (const b of items || []) {
    if (!b?.job_id) continue
    ;(out[b.job_id] = out[b.job_id] || []).push({ id: b.id, cost_code: b.cost_code ?? null, description: b.description ?? null })
  }
  for (const k of Object.keys(out)) out[k].sort(byCode)
  return out
}

// 'code · description' (either part may be missing).
export function budgetLineLabel(b) {
  if (!b) return ''
  return [b.cost_code, b.description].filter(x => x != null && String(x).trim() !== '').join(' · ')
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'per', 'inc', 'llc', 'misc', 'other', 'job', 'site', 'cost', 'costs'])
function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(w => w.replace(/(ies|es|s)$/, m => (m === 'ies' ? 'y' : '')))
}

// Best budget line for a cost's description (word overlap with the line description).
// Returns null when nothing matches or two lines tie, so a guess is never forced.
// Only a suggestion: callers must not select it automatically.
export function suggestBudgetLine(description, lines) {
  const want = new Set(words(description))
  if (!want.size || !lines?.length) return null
  let best = null, bestScore = 0, tie = false
  for (const l of lines) {
    const score = new Set(words(l.description).filter(w => want.has(w))).size
    if (score > bestScore) { best = l; bestScore = score; tie = false }
    else if (score && score === bestScore) tie = true
  }
  return bestScore > 0 && !tie ? best : null
}

// Split costs for bulk approve. picks = { [costId]: budget_item_id } chosen in the UI.
// ready: [{ cost, budget_item_id }] (budget_item_id only set when newly picked);
// needLine: costs with no valid line and no pick; notAllowed: costs on jobs the user can't approve.
export function splitForApproval(costs, picks = {}) {
  const ready = [], needLine = [], notAllowed = []
  for (const c of costs || []) {
    if (c.can_approve === false) { notAllowed.push(c); continue }
    const pick = picks[c.id]
    if (pick) ready.push({ cost: c, budget_item_id: pick })
    else if (c.has_budget_line) ready.push({ cost: c, budget_item_id: null })
    else needLine.push(c)
  }
  return { ready, needLine, notAllowed }
}
