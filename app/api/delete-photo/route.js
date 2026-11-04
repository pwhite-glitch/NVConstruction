import { createClient } from '@supabase/supabase-js'
import { denyJob, isJobLimited } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function thumb(path) { return path?.replace(/\.jpg$/i, '_thumb.jpg') ?? null }

export async function POST(request) {
  const body = await request.json()
  const { path, fromReport, reportId, jobId } = body

  if (!path || !jobId) return Response.json({ error: 'path and jobId required' }, { status: 400 })

  // Verify caller is authenticated and has access to this job
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Check user is PM/admin or assigned super for this job
  const { data: profile } = await adminSupabase.from('profiles').select('role').eq('id', user.id).single()
  const isPmOrAdmin = profile?.role === 'principal' || profile?.role === 'pm' || profile?.role === 'admin'
  const isSuper = profile?.role === 'super'

  if (!isPmOrAdmin && !isSuper) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Verify job access
  if (isPmOrAdmin) {
    // PM: assigned or jobs.pm_email (any case). Admin: any job.
    const auth = { userId: user.id, email: user.email, role: profile.role }
    const denied = await denyJob(adminSupabase, auth, jobId)
    if (denied) return denied
    // The photo itself must be on that job
    if (isJobLimited(profile.role)) {
      const { data: owner } = fromReport && reportId
        ? await adminSupabase.from('daily_reports').select('job_id').eq('id', reportId).maybeSingle()
        : await adminSupabase.from('job_photos').select('job_id').eq('storage_path', path).limit(1).maybeSingle()
      if (!owner || owner.job_id !== jobId) return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  if (isSuper) {
    const { data: assign } = await adminSupabase.from('pm_job_assignments').select('id').eq('job_id', jobId).eq('user_id', user.id).maybeSingle()
    if (!assign) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Delete from storage (ignore errors — file may already be missing)
  await adminSupabase.storage.from('daily-report-photos').remove([path, thumb(path)].filter(Boolean))

  // Delete from DB
  if (fromReport && reportId) {
    const { data: report } = await adminSupabase.from('daily_reports').select('photos').eq('id', reportId).single()
    if (report) {
      const updated = (report.photos || []).filter(p => p.path !== path)
      await adminSupabase.from('daily_reports').update({ photos: updated.length ? updated : null }).eq('id', reportId)
    }
  } else {
    await adminSupabase.from('job_photos').delete().eq('storage_path', path)
  }

  return Response.json({ ok: true })
}
