import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { denyJob, isPrincipal, normEmail } from '../../../../lib/roles'
import { jobDetailsUpdate, JOB_DETAILS_WRITER_ROLES, OPTIONAL_JOB_COLS, OWNER_ADDRESS_NEEDS_079 } from '../../../../lib/job-details'
import { isBotAccount, isBotEmail, BOT_NOT_STAFF_MESSAGE } from '../../../../lib/bot-rules'
import { writeWithMissingColumnRetry, isMissingColumnError, missingColumnName } from '../../../../lib/missing-column-retry'
import { CONTRACT_DATE_NEEDS_069, CONTRACT_TIME_MIGRATION } from '../../../../lib/contract-time'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WRITER_ROLES = JOB_DETAILS_WRITER_ROLES
const PM_PICK_ROLES = new Set(['principal', 'pm', 'apm'])

// POST { id, fields } — job Details (residential and commercial pages; the
// field set follows the stored job_type). Only the allow-listed fields in
// lib/job-details.js are written, after checks. Archive is never written here
// except the Owner's deliberate "status → Active" unarchive. PM changes do not
// touch pm_job_assignments.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!WRITER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { id, fields } = body || {}
  if (!id || !fields || typeof fields !== 'object' || Array.isArray(fields)) return Response.json({ error: 'id and fields required' }, { status: 400 })
  const denied = await denyJob(adminSupabase, auth, id)
  if (denied) return denied

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('*').eq('id', id).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })

  const r = jobDetailsUpdate(fields, job, { isOwner: isPrincipal(auth.role) })
  if (r.error) return Response.json({ error: r.error }, { status: 400 })
  const update = r.fields

  // PM must be a staff login (Owner / PM / APM), like the picker offers.
  if (update.pm_email && normEmail(update.pm_email) !== normEmail(job.pm_email)) {
    if (isBotEmail(update.pm_email)) return Response.json({ error: BOT_NOT_STAFF_MESSAGE }, { status: 400 })
    const { data: list } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    const user = (list?.users || []).find(u => normEmail(u.email) === update.pm_email)
    if (!user) return Response.json({ error: 'That PM is not a team login.' }, { status: 400 })
    // '*' so is_bot (migration 036) is read when present without failing before it
    const { data: prof, error: pErr } = await adminSupabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 })
    if (isBotAccount(prof, user.email)) return Response.json({ error: BOT_NOT_STAFF_MESSAGE }, { status: 400 })
    if (!PM_PICK_ROLES.has(prof?.role)) return Response.json({ error: 'The PM must be an Owner, PM or APM.' }, { status: 400 })
  }

  if (!Object.keys(update).length) return Response.json({ ok: true, job })
  // contract_completion_date needs migration 069 and owner_address migration 079: before
  // them, the update is retried without the missing column only, and the answer carries
  // a warning (200, rest saved).
  const { data, error, dropped } = await writeWithMissingColumnRetry(
    row => adminSupabase.from('jobs').update(row).eq('id', id).select('*'),
    update, { fallbackCols: OPTIONAL_JOB_COLS })
  const warningFor = cols => {
    const w = []
    if (cols.includes('contract_completion_date')) w.push(CONTRACT_DATE_NEEDS_069)
    if (cols.includes('owner_address')) w.push(OWNER_ADDRESS_NEEDS_079)
    return w.length ? {
      warning: w.join(' '),
      ...(cols.includes('contract_completion_date') ? { migration_required: CONTRACT_TIME_MIGRATION } : {}),
    } : {}
  }
  if (error) {
    // Only optional columns were left and the one named is missing: nothing else to save.
    const col = missingColumnName(error)
    const onlyOptional = Object.keys(update).every(k => OPTIONAL_JOB_COLS.includes(k))
    if (onlyOptional && isMissingColumnError(error) && OPTIONAL_JOB_COLS.includes(col)) {
      return Response.json({ ok: true, job, ...warningFor([...dropped, col]) })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!data?.length) return Response.json({ error: 'Job not found.' }, { status: 404 })
  return Response.json({
    ok: true, job: data[0], unarchived: update.archived === false,
    ...warningFor(dropped),
  })
}
