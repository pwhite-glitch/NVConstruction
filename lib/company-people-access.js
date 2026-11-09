// Who may change a sub company's people (portal job_access / can_bill, and
// company_contacts add/edit/remove) through /api/company-people.
//
// - Owner (principal) and admin: any company (same as every other company-wide office tool).
// - PM / APM / super: only a company that is on at least one of their jobs
//   (accessibleJobIds: pm_job_assignments, plus pm_email for PM/APM), by the
//   same "company is on the job" rule as lib/sub-access.js (companyOnAnyJob):
//   a job_assignments row with the company's company_id or one of its people's
//   sub_id / sub_email, or a non-draft subcontract with its company_id.
//   Stricter than denyJob for supers: an unassigned super is refused.
// - Anyone else: 403. Any read error fails closed (500, caller must not write).
import { accessibleJobIds, seesAllJobs } from './roles'
import { companyOnAnyJob } from './sub-access'

export const MANAGE_COMPANY_ROLES = ['pm', 'apm', 'super']
export const NOT_YOUR_COMPANY_MESSAGE = 'You can only manage people for companies on your jobs.'

// → { ok: true } | { ok: false, status, error }
export async function canManageCompanyPeople(db, auth, companyId) {
  if (!companyId) return { ok: false, status: 400, error: 'company_id required' }
  const role = auth?.role
  if (seesAllJobs(role)) return { ok: true }
  if (!MANAGE_COMPANY_ROLES.includes(role)) return { ok: false, status: 403, error: 'Forbidden' }
  const { ids, error } = await accessibleJobIds(db, auth)
  if (error) return { ok: false, status: 500, error: error.message || 'Could not check job access.' }
  if (!ids || !ids.size) return { ok: false, status: 403, error: NOT_YOUR_COMPANY_MESSAGE }
  const { on, error: qErr } = await companyOnAnyJob(db, companyId, [...ids])
  if (qErr) return { ok: false, status: 500, error: qErr.message || 'Could not check company access.' }
  if (!on) return { ok: false, status: 403, error: NOT_YOUR_COMPANY_MESSAGE }
  return { ok: true }
}
