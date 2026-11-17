import { createClient } from '@supabase/supabase-js'
import { denyJob, isJobLimited } from '../../../lib/roles'
import { isDraftReport, canEditDraft, canSeeAllDrafts } from '../../../lib/daily-report-payload'
import { canRemoveReportPhotoFile, canRemoveGalleryPhotoFile, thumbOf, PHOTO_BUCKET } from '../../../lib/report-photo-links'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST { path, jobId, fromReport?, reportId? } — remove a photo.
// Who: principal / pm / admin (denyJob; job-limited roles only for a photo on that job),
// or a super / apm with a pm_job_assignments row for the job (apm: prompt 85, so the field
// app — super | apm — can unlink report photos now that browsers cannot update final
// daily_reports under migration 075 RLS).
//
// Report photo (fromReport): the jsonb element is dropped from that report. The storage
// object is removed ONLY when nothing else uses it (prompt 85): never when the element is a
// reference to a job photo (job_photo_id / source:'job_photos'), a job_photos row exists for
// the path, or another report still lists it. A DRAFT report can only be changed by its
// author or Owner / admin / PM; a FINAL report only by Owner / admin / PM (403 otherwise).
// Gallery photo: the job_photos row is deleted; the storage object is kept while any daily
// report still references that path (the report attachment stays intact).
export async function POST(request) {
  const body = await request.json().catch(() => null)
  const { path, fromReport, reportId, jobId } = body || {}

  if (!path || !jobId) return Response.json({ error: 'path and jobId required' }, { status: 400 })

  // Verify caller is authenticated and has access to this job
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Check user is PM/admin or assigned super / apm for this job
  const { data: profile } = await adminSupabase.from('profiles').select('role').eq('id', user.id).single()
  const role = profile?.role
  const isPmOrAdmin = role === 'principal' || role === 'pm' || role === 'admin'
  const isFieldRole = role === 'super' || role === 'apm'

  if (!isPmOrAdmin && !isFieldRole) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const auth = { userId: user.id, email: user.email, role }

  // Verify job access
  if (isPmOrAdmin) {
    // PM: assigned or jobs.pm_email (any case). Admin: any job.
    const denied = await denyJob(adminSupabase, auth, jobId)
    if (denied) return denied
    // The photo itself must be on that job
    if (isJobLimited(role)) {
      const { data: owner } = fromReport && reportId
        ? await adminSupabase.from('daily_reports').select('job_id').eq('id', reportId).maybeSingle()
        : await adminSupabase.from('job_photos').select('job_id').eq('storage_path', path).limit(1).maybeSingle()
      if (!owner || owner.job_id !== jobId) return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  if (isFieldRole) {
    const { data: assign } = await adminSupabase.from('pm_job_assignments').select('id').eq('job_id', jobId).eq('user_id', user.id).maybeSingle()
    if (!assign) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (fromReport) {
    if (!reportId) return Response.json({ error: 'reportId required for a daily-report photo' }, { status: 400 })
    const { data: report, error: readErr } = await adminSupabase.from('daily_reports').select('*').eq('id', reportId).maybeSingle()
    if (readErr) return Response.json({ error: readErr.message }, { status: 500 })
    if (!report) return Response.json({ error: 'Report not found.' }, { status: 404 })
    if (report.job_id !== jobId) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (isDraftReport(report) && !canEditDraft(auth, report)) return Response.json({ error: 'This draft belongs to someone else.' }, { status: 403 })
    // A FINAL report is locked: only Owner / admin / PM may change its photos. Supers / APMs
    // cannot edit a final (a super must reopen their own report first — prompt 89). Nothing is
    // changed on 403.
    if (!isDraftReport(report) && !canSeeAllDrafts(role)) return Response.json({ error: 'This report is finalized. Only an Owner, admin or PM can change its photos.' }, { status: 403 })
    const current = Array.isArray(report.photos) ? report.photos : []
    const element = current.find(p => p?.path === path) || null
    if (element) {
      const updated = current.filter(p => p?.path !== path)
      const { error: upErr } = await adminSupabase.from('daily_reports').update({ photos: updated.length ? updated : null }).eq('id', reportId)
      if (upErr) return Response.json({ error: `Could not update the daily report (${upErr.message}); nothing was deleted.` }, { status: 500 })
    }
    // Storage only after the DB write, and only when no job photo / other report uses the file.
    const { removeStorage } = await canRemoveReportPhotoFile(adminSupabase, { jobId, reportId, element, path })
    if (removeStorage) await adminSupabase.storage.from(PHOTO_BUCKET).remove([path, thumbOf(path)].filter(Boolean))
    return Response.json({ ok: true, file_removed: removeStorage })
  }

  // Gallery photo: drop the row; keep the file while a daily report still references it.
  const { removeStorage } = await canRemoveGalleryPhotoFile(adminSupabase, { jobId, path })
  const { error: delErr } = await adminSupabase.from('job_photos').delete().eq('storage_path', path).eq('job_id', jobId)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })
  if (removeStorage) await adminSupabase.storage.from(PHOTO_BUCKET).remove([path, thumbOf(path)].filter(Boolean))
  return Response.json({ ok: true, file_removed: removeStorage })
}
