// Pending direct costs across jobs, for the dashboard "Costs to Approve" tab.
// Approving/rejecting still goes through /api/dc-review; this only builds the list.

// Roles allowed to approve, unapprove, reject or edit a direct cost (used by /api/dc-review).
export const DC_APPROVER_ROLES = new Set(['pm', 'apm', 'admin'])

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
      const bi = c.budget_item_id ? biMap[c.budget_item_id] : null
      return {
        ...c,
        job_number: job?.job_number ?? null,
        project_name: job?.project_name ?? null,
        cost_code: bi?.cost_code ?? null,
        budget_line: bi?.description ?? null,
        submitted_by_name: profMap[c.submitted_by]?.full_name ?? null,
      }
    })
    .sort((a, b) => (submittedAt(a)?.getTime() ?? Infinity) - (submittedAt(b)?.getTime() ?? Infinity))
}
