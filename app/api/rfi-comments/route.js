import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM, requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob, isJobLimited, accessibleJobIds, seesAllJobs, normEmail, ilikeExact } from '../../../lib/roles'
import { notifyRfiComment } from '../../../lib/rfi-notify'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 })

// Resolve the RFI (and its real job) or a Response to send back.
async function loadRfi(rfi_id) {
  const { data: rfi, error } = await adminSupabase.from('rfis').select('id, job_id, number, title').eq('id', rfi_id).maybeSingle()
  if (error) return { error: Response.json({ error: error.message }, { status: 500 }) }
  if (!rfi) return { error: Response.json({ error: 'RFI not found.' }, { status: 404 }) }
  return { rfi }
}

// Client owners (owner portal): only jobs whose owner_email is their login email,
// matching how /owner lists their jobs.
async function ownerJobDenied(auth, jobId) {
  if (auth.role !== 'owner' || !auth.email || !jobId) return forbidden()
  // Exact (case-insensitive) match: % and _ in a login email are escaped, never wildcards.
  const email = normEmail(auth.email)
  if (!email) return forbidden()
  const { data: job, error } = await adminSupabase.from('jobs').select('id, owner_email').eq('id', jobId).ilike('owner_email', ilikeExact(email)).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return job && normEmail(job.owner_email) === email ? null : forbidden()
}

// Office staff: principal/admin any job; pm/apm/super only on their job.
// Client owners: their own jobs. Everyone else: 403.
async function jobDenied(auth, jobId) {
  if (isPM(auth.role)) return denyUnlessOnJob(adminSupabase, auth, jobId)
  return ownerJobDenied(auth, jobId)
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const rfi_id = searchParams.get('rfi_id')
  const job_id = searchParams.get('job_id')

  let rfiJobId = null
  if (rfi_id) {
    const r = await loadRfi(rfi_id)
    if (r.error) return r.error
    rfiJobId = r.rfi.job_id
    if (job_id && job_id !== rfiJobId) return forbidden()
  }
  const scopeJob = rfiJobId || job_id
  if (scopeJob) {
    const denied = await jobDenied(auth, scopeJob)
    if (denied) return denied
  } else if (!isPM(auth.role)) {
    return forbidden()
  } else if (!seesAllJobs(auth.role) && !isJobLimited(auth.role)) {
    // Supers: list per job only (no all-jobs comment feed).
    return Response.json({ error: 'job_id or rfi_id required' }, { status: 400 })
  }

  let query = adminSupabase.from('rfi_comments').select('*').order('created_at', { ascending: true })
  if (rfi_id) query = query.eq('rfi_id', rfi_id)
  else if (job_id) query = query.eq('job_id', job_id)
  else if (isJobLimited(auth.role)) {
    const { ids, error: accErr } = await accessibleJobIds(adminSupabase, auth)
    if (accErr) return Response.json({ error: accErr.message }, { status: 500 })
    if (!ids.size) return Response.json({ comments: [] })
    query = query.in('job_id', [...ids])
  }
  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ comments: data || [] })
}

// POST { rfi_id, comment } — author_name comes from the caller's profile,
// author_role from auth, job_id from the RFI itself. Any author_name /
// author_role / job_id in the body is ignored.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const rfi_id = typeof body?.rfi_id === 'string' ? body.rfi_id : ''
    const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''
    if (!rfi_id || !comment) return Response.json({ error: 'rfi_id and comment required' }, { status: 400 })
    if (comment.length > 5000) return Response.json({ error: 'Comment is too long (5000 characters max).' }, { status: 400 })

    const r = await loadRfi(rfi_id)
    if (r.error) return r.error
    const { rfi } = r
    const denied = await jobDenied(auth, rfi.job_id)
    if (denied) return denied

    const { data: profile, error: profErr } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
    if (profErr) return Response.json({ error: profErr.message }, { status: 500 })
    const author_name = (profile?.full_name || '').trim() || auth.email || (auth.role === 'owner' ? 'Owner' : 'NV Construction')

    const { data, error } = await adminSupabase
      .from('rfi_comments')
      .insert({
        rfi_id: rfi.id,
        job_id: rfi.job_id || null,
        author_name,
        author_role: auth.role,
        comment,
      })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Owner comment → that job's PMs (email + bell). The comment is saved either
    // way; a notification problem is only a warning.
    let notifyWarning = null
    if (auth.role === 'owner') {
      try {
        const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('id, job_number, project_name, pm_email').eq('id', rfi.job_id).maybeSingle()
        if (jobErr || !job) notifyWarning = 'PM notification not sent: job lookup failed.'
        else {
          const n = await notifyRfiComment({ rfi, job, comment, author_name, author_user_id: auth.userId })
          if (!n?.ok) notifyWarning = 'PM notification not fully sent' + (n?.emailError ? `: ${n.emailError}` : n?.reason ? `: ${n.reason}` : '.')
        }
      } catch (e) {
        notifyWarning = 'PM notification not sent: ' + e.message
      }
    }
    return Response.json({ comment: data, ...(notifyWarning ? { notifyWarning } : {}) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  // Load the comment and its RFI's real job (fail closed), then the same on-job check
  // as GET/POST — supers included.
  const { data: c, error: cErr } = await adminSupabase.from('rfi_comments').select('id, rfi_id').eq('id', id).maybeSingle()
  if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
  if (!c) return Response.json({ error: 'Comment not found.' }, { status: 404 })
  if (!c.rfi_id) return forbidden()
  const r = await loadRfi(c.rfi_id)
  if (r.error) return r.error
  if (!r.rfi.job_id) return forbidden()
  const denied = await denyUnlessOnJob(adminSupabase, auth, r.rfi.job_id)
  if (denied) return denied
  const { error } = await adminSupabase.from('rfi_comments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
