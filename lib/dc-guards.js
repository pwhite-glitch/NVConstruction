// Server-side checks shared by /api/dc-review and PUT /api/direct-costs.
// `db` is a service-role Supabase client; `auth` is from requireAuth/requirePM.

// PM/APM also count as on a job when jobs.pm_email is their auth email (case-insensitive),
// the same fallback /api/delete-photo uses. Many jobs have pm_email but no assignment row.
const PM_EMAIL_ROLES = new Set(['pm', 'apm'])
const normEmail = e => String(e || '').trim().toLowerCase()
// ilike with LIKE wildcards escaped, so it is a plain case-insensitive equals.
const ilikeExact = s => s.replace(/[\\%_]/g, c => '\\' + c)

// Job ids the caller is on: pm_job_assignments rows, plus (PM/APM) jobs whose pm_email is theirs.
// Returns { ids: Set } or { ids: null } for admins (every job), or { error }.
export async function accessibleJobIds(db, auth) {
  if (auth.role === 'admin') return { ids: null }
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

// Admins can act on any job; everyone else needs a pm_job_assignments row for it,
// or (PM/APM) to be the job's pm_email. Returns null when allowed, or { status, error } to send back.
export async function jobAccessError(db, auth, jobId) {
  if (auth.role === 'admin') return null
  if (!jobId) return { status: 422, error: 'This cost has no job.' }
  const { data, error } = await db
    .from('pm_job_assignments')
    .select('id')
    .eq('job_id', jobId)
    .eq('user_id', auth.userId)
    .limit(1)
  if (error) return { status: 500, error: error.message }
  if (data?.length) return null
  const email = normEmail(auth.email)
  if (PM_EMAIL_ROLES.has(auth.role) && email) {
    const { data: job, error: jobErr } = await db.from('jobs').select('pm_email').eq('id', jobId).maybeSingle()
    if (jobErr) return { status: 500, error: jobErr.message }
    if (normEmail(job?.pm_email) === email) return null
  }
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
