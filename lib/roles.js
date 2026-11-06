// Roles: labels, pill colors, and who sees which jobs. The one place for this.
// No imports, so both the browser (dashboard, job pages) and API routes can use it.
// Job helpers take a Supabase client `db` (service role on the server, the
// signed-in browser client in the UI) and `auth` = { role, userId, email }.
//
// 'principal' is the company owner/partner role (UI label "Owner").
// 'owner' is NOT that: it is the CLIENT / building owner (/owner portal).

export const ROLE_LABELS = {
  principal: 'Owner',
  pm: 'PM',
  apm: 'APM',
  super: 'Super',
  admin: 'Admin',
  owner: 'Client Owner',
  owner_rep: 'Owner Rep',
  subcontractor: 'Sub',
  sub_pm: 'Sub PM',
  sub_admin: 'Sub Admin',
  sub_estimator: 'Sub Est',
  roofing_rep: 'Roofing Rep',
  metal_rep: 'Metal Rep',
}

// { background, color, border } for the small role pill.
export const ROLE_PILL_COLORS = {
  principal: { background: '#fefce8', color: '#a16207', border: '#fde047' }, // gold
  pm:        { background: '#faf5ff', color: '#7c3aed', border: '#e9d5ff' },
  apm:       { background: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  super:     { background: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
}
const DEFAULT_PILL = { background: '#fff7ed', color: '#c2410c', border: '#fed7aa' }

export const roleLabel = role => ROLE_LABELS[role] || (role ? String(role) : '')
export const rolePill = role => ROLE_PILL_COLORS[role] || DEFAULT_PILL

export const isPrincipal = role => role === 'principal'
// Everything a PM can do. Principals can do all of it too.
export const atLeastPM = role => role === 'principal' || role === 'pm'
// Sees and can act on every job with no assignment.
export const seesAllJobs = role => role === 'principal' || role === 'admin'
// Limited to "their jobs" (assignment or pm_email) in the job list, job pages and job APIs.
export const JOB_LIMITED_ROLES = new Set(['pm', 'apm'])
export const isJobLimited = role => JOB_LIMITED_ROLES.has(role)
// Roles that also count as on a job when jobs.pm_email is their email.
const PM_EMAIL_ROLES = new Set(['pm', 'apm'])

// Where each staff role lands after login.
export function homePathForRole(role) {
  if (role === 'principal' || role === 'pm' || role === 'apm' || role === 'admin') return '/dashboard'
  if (role === 'super') return '/field'
  if (role === 'owner') return '/owner'
  if (role === 'roofing_rep') return '/sales?division=commercial_roofing'
  if (role === 'metal_rep') return '/sales?division=metal_buildings'
  return '/submit'
}

export const normEmail = e => String(e || '').trim().toLowerCase()
// ilike with LIKE wildcards escaped, so it is a plain case-insensitive equals.
export const ilikeExact = s => s.replace(/[\\%_]/g, c => '\\' + c)

// Job ids the caller is on: pm_job_assignments rows, plus (PM/APM) jobs whose
// pm_email is theirs in any letter case. Returns { ids: null } for principal/admin
// (every job), { ids: Set }, or { error }.
export async function accessibleJobIds(db, auth) {
  if (seesAllJobs(auth?.role)) return { ids: null }
  const { data: assigns, error } = await db.from('pm_job_assignments').select('job_id').eq('user_id', auth.userId)
  if (error) return { error }
  const ids = new Set((assigns || []).map(a => a.job_id))
  const email = normEmail(auth.email)
  if (PM_EMAIL_ROLES.has(auth.role) && email) {
    const { data: jobs, error: jobErr } = await db.from('jobs').select('id, pm_email').ilike('pm_email', ilikeExact(email))
    if (jobErr) return { error: jobErr }
    for (const j of jobs || []) if (normEmail(j.pm_email) === email) ids.add(j.id)
  }
  return { ids }
}

// Is the caller on this job (assignment, or pm_email for PM/APM)? Principal/admin: always.
// Returns { ok: boolean } or { error }.
export async function isOnJob(db, auth, jobId) {
  if (seesAllJobs(auth?.role)) return { ok: true }
  if (!jobId) return { ok: false }
  const { data, error } = await db
    .from('pm_job_assignments')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', auth.userId)
    .limit(1)
  if (error) return { error }
  if (data?.length) return { ok: true }
  const email = normEmail(auth.email)
  if (PM_EMAIL_ROLES.has(auth.role) && email) {
    const { data: job, error: jobErr } = await db.from('jobs').select('pm_email').eq('id', jobId).maybeSingle()
    if (jobErr) return { error: jobErr }
    if (normEmail(job?.pm_email) === email) return { ok: true }
  }
  return { ok: false }
}

export const NOT_ASSIGNED_MESSAGE = "You're not assigned to this job."

// Job-scoped API guard. Only PM/APM are limited; every other role passes
// (its own route checks still apply). Returns null when allowed, else { status, error }.
export async function jobAccessError(db, auth, jobId, message = NOT_ASSIGNED_MESSAGE) {
  if (!isJobLimited(auth?.role)) return null
  if (!jobId) return { status: 404, error: 'Job not found.' }
  const r = await isOnJob(db, auth, jobId)
  if (r.error) return { status: 500, error: r.error.message || 'Could not check job access.' }
  return r.ok ? null : { status: 403, error: message }
}

// Same as jobAccessError but returns a Response to send back (or null).
// Usage: const denied = await denyJob(db, auth, jobId); if (denied) return denied
export async function denyJob(db, auth, jobId, message) {
  const err = await jobAccessError(db, auth, jobId, message)
  return err ? Response.json({ error: err.error }, { status: err.status }) : null
}

// Look up `column` (default job_id) on a job-owned row, then guard that job.
// Missing row: 404 for limited roles, null otherwise (the route handles it).
export async function denyJobOf(db, auth, table, id, column = 'job_id') {
  if (!isJobLimited(auth?.role)) return null
  if (!id) return null
  const { data, error } = await db.from(table).select(column).eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Not found.' }, { status: 404 })
  return denyJob(db, auth, data[column])
}

// Guard several jobs at once (e.g. a list filter or bulk action). Null when all allowed.
export async function denyJobs(db, auth, jobIds) {
  if (!isJobLimited(auth?.role)) return null
  const { ids, error } = await accessibleJobIds(db, auth)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  for (const id of new Set((jobIds || []).filter(Boolean))) {
    if (!ids.has(id)) return Response.json({ error: NOT_ASSIGNED_MESSAGE }, { status: 403 })
  }
  return null
}

// Stricter than denyJob: principal/admin pass; pm/apm/super must be on the job
// (pm_job_assignments row, or jobs.pm_email is theirs); every other role is 403.
// For routes that return money/pay data where an unassigned super must not pass.
export async function denyUnlessOnJob(db, auth, jobId, message = NOT_ASSIGNED_MESSAGE) {
  const role = auth?.role
  if (seesAllJobs(role)) return null
  if (!['pm', 'apm', 'super'].includes(role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (!jobId) return Response.json({ error: 'Job not found.' }, { status: 404 })
  const r = await isOnJob(db, auth, jobId)
  if (r.error) return Response.json({ error: r.error.message || 'Could not check job access.' }, { status: 500 })
  if (r.ok) return null
  // isOnJob only checks pm_email for PM/APM; a super listed as the job's PM counts too.
  const email = normEmail(auth.email)
  if (role === 'super' && email) {
    const { data: job, error } = await db.from('jobs').select('pm_email').eq('id', jobId).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (normEmail(job?.pm_email) === email) return null
  }
  return Response.json({ error: message }, { status: 403 })
}

// Refuse changing/removing an Owner (principal) account when the caller is not
// an Owner, or when it is the last Owner. `newRole` is the role the target would
// end up with (null = account deleted). Returns null when allowed, else
// { status, error }.
export async function ownerChangeError(db, auth, targetUserId, newRole = null) {
  if (!targetUserId) return null
  const { data: target, error } = await db.from('profiles').select('id, role').eq('id', targetUserId).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!target || !isPrincipal(target.role)) return null
  if (isPrincipal(newRole)) return null
  if (!isPrincipal(auth?.role)) return { status: 403, error: 'Only an Owner can change or remove an Owner account.' }
  const { count, error: cntErr } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'principal')
  if (cntErr) return { status: 500, error: cntErr.message }
  if ((count ?? 0) <= 1) return { status: 409, error: 'This is the last Owner account. Add another Owner first.' }
  return null
}
