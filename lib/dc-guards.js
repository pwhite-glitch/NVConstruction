// Server-side checks shared by /api/dc-review and PUT /api/direct-costs.
// `db` is a service-role Supabase client; `auth` is from requireAuth/requirePM.

import { accessibleJobIds as sharedAccessibleJobIds, isOnJob, seesAllJobs } from './roles'

// Job ids the caller is on. One implementation, in lib/roles.js:
// principal/admin -> { ids: null } (every job); otherwise assignment rows, plus
// jobs.pm_email = their email (case-insensitive) for PM/APM.
export const accessibleJobIds = sharedAccessibleJobIds

// Principal/admin can act on any job; everyone else needs a pm_job_assignments row for it,
// or (PM/APM) to be the job's pm_email. Returns null when allowed, or { status, error } to send back.
export async function jobAccessError(db, auth, jobId) {
  if (seesAllJobs(auth.role)) return null
  if (!jobId) return { status: 422, error: 'This cost has no job.' }
  const r = await isOnJob(db, auth, jobId)
  if (r.error) return { status: 500, error: r.error.message }
  if (r.ok) return null
  return { status: 403, error: 'You are not assigned to this job, so you cannot change or approve its costs.' }
}

// Is this cost billed anywhere? Any draw request (open OR closed), an owner pay app
// (drawn_application_id), or a non-voided owner reimbursement invoice line. While it is,
// its amount / status / budget line must not change: the draw, pay app or invoice total
// would silently change with it. Take it off first through the explicit workflow
// (Draws tab "Remove", pay app "Undo", void / edit the invoice).
// `cost` needs id, draw_request_id, drawn_application_id.
// Returns null when unlinked, else { status, error }. Fails closed: a lookup error blocks.
export async function dcBilledLinkError(db, cost) {
  if (!cost?.id) return { status: 404, error: 'Cost not found' }
  if (cost.drawn_application_id) {
    const { data: app, error } = await db.from('aia_applications').select('app_number').eq('id', cost.drawn_application_id).maybeSingle()
    const label = error ? '' : ` #${app?.app_number ?? '?'}`
    return { status: 409, error: `This cost is drawn on owner pay app${label}. Use Undo on the pay app first, then change it.` }
  }
  if (cost.draw_request_id) {
    const { data: draw, error } = await db.from('draw_requests').select('draw_number, status').eq('id', cost.draw_request_id).maybeSingle()
    const label = error || !draw ? '' : ` #${draw.draw_number} (${draw.status || 'unknown'})`
    return { status: 409, error: `This cost is on draw request${label}. Take it off the draw first (Draws tab), then change it.` }
  }
  const { data: invLines, error: invErr } = await db
    .from('owner_reimb_invoice_lines')
    .select('invoice_id, owner_reimb_invoices!inner(invoice_number, status, voided_at)')
    .eq('direct_cost_id', cost.id)
    .neq('owner_reimb_invoices.status', 'voided')
    .is('owner_reimb_invoices.voided_at', null)
    .limit(1)
  if (invErr) return { status: 500, error: 'Could not check owner reimbursement invoices: ' + invErr.message }
  if (invLines?.length) {
    const inv = invLines[0].owner_reimb_invoices
    return { status: 409, error: `This cost is on owner reimbursement invoice ${inv?.invoice_number || ''} (${inv?.status || 'open'}). Remove it from the invoice (or void the invoice) first.`.replace('  ', ' ') }
  }
  return null
}

// Same check for the browser: why a cost's money / status / budget controls are locked,
// from the fields on the row (invoice links are only known to the server). '' = not locked.
export function dcBilledLockReason(cost) {
  if (!cost) return ''
  if (cost.drawn_application_id) return 'Drawn on an owner pay app — use Undo on the pay app first.'
  if (cost.draw_request_id) return 'On a draw request — take it off the draw first.'
  return ''
}

// The budget line must exist and be on `jobId` (the cost's own job).
// Returns null when OK, or { status, error }.
export async function budgetLineError(db, budgetItemId, jobId) {
  const { data: line, error } = await db
    .from('budget_items')
    .select('id, job_id')
    .eq('id', budgetItemId)
    .maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!line) return { status: 422, error: 'That budget line no longer exists. Refresh and pick another.' }
  if (line.job_id !== jobId) {
    return { status: 422, error: "That budget line belongs to a different job. A cost can only use its own job's budget lines." }
  }
  return null
}
