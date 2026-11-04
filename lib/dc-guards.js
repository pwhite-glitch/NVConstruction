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
