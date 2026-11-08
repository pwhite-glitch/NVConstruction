// Prime (owner) change order review — approve / apply to budget / reject — shared
// by POST /api/prime-change-orders/review, the commercial and residential job
// pages, and tests. No server imports.
//
// The state change and every budget-line change happen in ONE database
// transaction (public.prime_co_review, migration 049). Until 049 is applied the
// route answers 503 and changes nothing; there is no browser-side fallback.
//
// State transitions:
//   approve: pending → approved + budget_applied (when it has budget lines). On any
//            failure nothing changes: the CO stays pending and can be approved again.
//   apply:   approved (not applied) → approved + budget_applied. On failure it stays
//            approved / not applied and "Apply to Budget" is still offered.
//   reject:  pending (or approved, never applied) → rejected. Approved + applied →
//            rejected with the same amounts taken back off (residential "Reject &
//            reverse budget" only), all at once.

//   revise:  edit description / amount / notes / SOV (commercial). Approved + applied →
//            public.prime_co_revise (migration 049) nets old → new SOV on the budget
//            lines and saves the CO in one transaction; until 049 is applied it answers
//            503 and changes nothing. Pending / not-applied → saved by the API with a
//            guard that the CO is still not applied (no budget line moves).
//   delete:  unnumbered, not applied → deleted (no budget line moves). Numbered or
//            applied → refused (nothing changed).
export const PRIME_CO_ACTIONS = ['approve', 'apply', 'reject']
export const PRIME_CO_EDIT_ACTIONS = ['revise', 'delete']
export const PRIME_CO_MIGRATION = '049'
export const PRIME_CO_MIGRATION_REQUIRED = 'Approving / applying owner change orders needs database migration 049 (prime_co_review), which is not applied yet. Nothing was changed.'
export const PRIME_CO_REVISE_MIGRATION_REQUIRED = 'Editing a change order that is already applied to the budget needs database migration 049 (prime_co_revise), which is not applied yet. Nothing was changed — the CO and its budget lines are as they were.'
export const PRIME_CO_APPLIED_NO_DELETE = 'This change order is already applied to the budget, so it can’t be deleted (that would leave its amounts on the budget lines). Nothing was changed. To change its budget amounts, edit its SOV lines — the budget re-syncs in the same save.'

// Validate a revise body: { description, amount, notes, sov }.
// Returns { fields: { description, amount, notes, sov } } or { error }.
export function normalizeRevision(body) {
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (!description) return { error: 'Description is required.' }
  if (description.length > 1000) return { error: 'Description is too long.' }
  const amount = typeof body?.amount === 'string' && body.amount.trim() !== '' ? Number(body.amount) : body?.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return { error: 'Amount must be a number.' }
  let notes = body?.notes
  if (notes == null || notes === '') notes = null
  else if (typeof notes !== 'string') return { error: 'Notes must be text.' }
  else if (notes.length > 5000) return { error: 'Notes are too long.' }
  const r = normalizeSov(body?.sov === undefined ? null : body.sov)
  if (r.error) return { error: r.error }
  return { fields: { description, amount: Math.round(amount * 100) / 100, notes, sov: r.sov } }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = v => typeof v === 'string' && UUID_RE.test(v)

// Reviewer roles. Residential: Owner / PM (what its page offers). Commercial:
// the office roles that review on the commercial page. Both also need
// denyUnlessOnJob (PM / APM must be on the job). Supers never review.
const COMMERCIAL_REVIEWERS = new Set(['principal', 'pm', 'apm', 'admin'])
const RESIDENTIAL_REVIEWERS = new Set(['principal', 'pm'])
export function canReviewPrimeCO(role, residential) {
  return (residential ? RESIDENTIAL_REVIEWERS : COMMERCIAL_REVIEWERS).has(role)
}

// Validate SOV rows the reviewer assigned while approving.
// Returns { sov } (null when empty) or { error }.
export function normalizeSov(input) {
  if (input === null) return { sov: null }
  if (!Array.isArray(input)) return { error: 'sov must be a list of lines.' }
  if (input.length > 200) return { error: 'Too many SOV lines.' }
  const out = []
  for (const r of input) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'Each SOV line must be an object.' }
    const amount = typeof r.amount === 'string' && r.amount.trim() !== '' ? Number(r.amount) : r.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return { error: 'Each SOV line needs a numeric amount.' }
    if (r.budget_item_id != null && r.budget_item_id !== '' && !isUuid(r.budget_item_id)) return { error: 'SOV line has an invalid budget line.' }
    const description = r.description == null ? '' : String(r.description).slice(0, 300)
    out.push({ description, budget_item_id: r.budget_item_id || null, amount: Math.round(amount * 100) / 100 })
  }
  return { sov: out.length ? out : null }
}

// Budget lines a review would move (same rules as the database function):
// SOV rows with a budget line and a non-zero amount; residential falls back to
// budget_item_id (or the line picked while approving) for the whole amount.
export function primeCOLineIds(co, { residential = false, sov, budgetItemId = null } = {}) {
  const rows = (Array.isArray(sov) ? sov : Array.isArray(co?.sov) ? co.sov : [])
  const sums = {}
  for (const r of rows) {
    if (!r || !r.budget_item_id || !Number(r.amount)) continue
    sums[r.budget_item_id] = (sums[r.budget_item_id] || 0) + Number(r.amount)
  }
  const ids = Object.keys(sums).filter(k => Math.round(sums[k] * 100) !== 0)
  if (!ids.length && residential) {
    const line = co?.budget_item_id || budgetItemId
    if (line && Number(co?.amount)) return [line]
  }
  return ids
}

const CONFLICTS = {
  prime_co_not_pending: [409, 'This change order was already reviewed. Refresh to see its current status.'],
  prime_co_not_approved: [409, 'This change order is not approved, so it can’t be applied to the budget.'],
  prime_co_already_applied: [409, 'This change order is already applied to the budget. Nothing was changed.'],
  prime_co_reverse_not_allowed: [409, 'This approved change order is already on the budget and can’t be rejected here.'],
  prime_co_no_lines: [400, 'This change order has no budget lines assigned. Assign budget lines first. Nothing was changed.'],
  prime_co_line_wrong_job: [400, 'A budget line on this change order is missing or belongs to a different job. Nothing was changed.'],
  prime_co_wrong_job: [400, 'This change order does not belong to that job.'],
  prime_co_not_found: [404, 'Change order not found.'],
  prime_co_bad_sov: [400, 'Invalid SOV lines.'],
  prime_co_not_applied: [409, 'This change order is no longer approved and applied to the budget. Refresh and try again. Nothing was changed.'],
  prime_co_bad_input: [400, 'Description and amount are required. Nothing was changed.'],
  // 058 (residential Nv cost): a cost is only split on a single budget line.
  prime_co_cost_multi_line: [400, 'This change order has an Nv cost but more than one budget line. Residential Nv cost applies to one line only. Nothing was changed.'],
}

// Map an RPC error to { status, error, migration_required? }.
export function primeCORpcError(err, { revise = false } = {}) {
  const msg = err?.message || ''
  for (const [code, [status, text]] of Object.entries(CONFLICTS)) {
    if (msg.includes(code)) return { status, error: text }
  }
  if (err?.code === 'PGRST202' || /Could not find the function|function public\.prime_co_(review|revise).*does not exist/i.test(msg)) {
    return { status: 503, error: revise ? PRIME_CO_REVISE_MIGRATION_REQUIRED : PRIME_CO_MIGRATION_REQUIRED, migration_required: PRIME_CO_MIGRATION }
  }
  return { status: 500, error: msg || 'Change order review failed. Nothing was changed.' }
}

// Browser: is a server role-preview session active? (nvc_preview_role is the
// readable companion of the HttpOnly preview cookie.) Mutations are blocked by
// middleware then; pages disable the controls too.
export function isPreviewActive() {
  if (typeof document === 'undefined') return false
  return /(?:^|;\s*)nvc_preview_role=[^;]+/.test(document.cookie || '')
}

// Server: preview cookie on the request (defence in depth behind middleware).
export function requestInPreview(request) {
  const cookie = request?.headers?.get?.('cookie') || ''
  return /(?:^|;\s*)nvc_preview=[^;]+/.test(cookie)
}
