// Prime billing type (prompt 95). Every job bills the owner through a draw
// request linked to a sub draw request — the AIA / Draw request choice is gone.
// Old jobs may still have billing_type 'aia' stored; that value is ignored here,
// so every job behaves as a draw-request job no matter what the column says.

export const DEFAULT_BILLING_TYPE = 'draw_request'

// eslint-disable-next-line no-unused-vars
export const isDrawBilling = job => true

// Owner-facing name of one prime app: "Draw #3".
export const primeAppLabel = app => `Draw #${app?.app_number ?? '?'}`

// Plural heading: "Draw Requests" / "Draw Requests (3)".
export const primeAppsHeading = count => (count == null ? 'Draw Requests' : `Draw Requests (${count})`)

// Hint shown on "+ New draw request" when the job has no sub draw requests to link.
export const NO_SUB_DRAWS_HINT = 'No sub draw requests yet — create one on the Billing tab (Draw requests) first.'

// Where an open prime app pulls its approved sub bills from:
//   linked app            → { by: 'draw', drawId }     (every new app)
//   old app, no link      → { by: 'month', month }     (fallback: approved bills by billing_period month)
//   old app, no link/date → null                       (no bills)
export function primeBillsSource(app = {}) {
  if (app?.linked_draw_request_id) return { by: 'draw', drawId: app.linked_draw_request_id }
  const to = String(app?.period_to || '')
  if (/^\d{4}-\d{2}/.test(to)) return { by: 'month', month: to.slice(0, 7) + '-01' }
  return null
}

// A new prime draw request can be created only when it links a sub draw request.
export function canCreatePrimeDraw({ linkedDrawId, drawCount = 0, budgetCount = 0, saving = false } = {}) {
  return !saving && budgetCount > 0 && drawCount > 0 && !!linkedDrawId
}
