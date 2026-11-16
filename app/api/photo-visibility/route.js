import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { isMissingColumnError } from '../../../lib/missing-column-retry'
import { MIGRATION_070_TOGGLE_MESSAGE, setReportPhotoInternal } from '../../../lib/photo-visibility'
import { isDraftReport, canEditDraft, isReferencedReportPhoto } from '../../../lib/daily-report-payload'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 })

// POST { jobId, path, internal_only: boolean, fromReport?, reportId? }
// Hide a photo from the owner portal (internal_only true) or show it again (false).
// Same gate as /api/delete-photo: principal | pm | admin (denyJob; job-limited roles only
// for a photo on that job) OR a super with a pm_job_assignments row for the job. Everyone
// else (owner, apm, subs) → 403. Service role: job_photos has no UPDATE RLS policy.
//   gallery photo → job_photos.internal_only (migration 070; before it → 503, no change)
//   daily-report photo → daily_reports.photos[].internal_only (jsonb, no migration);
//     a photo picked from the job's photos (job_photo_id / source:'job_photos') → its job_photos
//     row (the owner portal reads that row's current flag); if that row was deleted, the
//     element becomes a report-only photo and its own flag is set.
// A DRAFT report (prompt 85) can only be changed by its author or Owner / admin / PM → 403.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const { path, jobId, fromReport, reportId } = body || {}
  const internalOnly = body?.internal_only
  if (!path || typeof path !== 'string' || !jobId) return Response.json({ error: 'path and jobId required' }, { status: 400 })
  if (typeof internalOnly !== 'boolean') return Response.json({ error: 'internal_only must be true or false' }, { status: 400 })
  if (fromReport && !reportId) return Response.json({ error: 'reportId required for a daily-report photo' }, { status: 400 })

  const role = auth.role
  const isPmOrAdmin = role === 'principal' || role === 'pm' || role === 'admin'
  const isSuper = role === 'super'
  if (!isPmOrAdmin && !isSuper) return forbidden()

  if (isPmOrAdmin) {
    const denied = await denyJob(adminSupabase, auth, jobId)
    if (denied) return denied
  }
  if (isSuper) {
    const { data: assign, error } = await adminSupabase.from('pm_job_assignments').select('id').eq('job_id', jobId).eq('user_id', auth.userId).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!assign) return forbidden()
  }

  if (fromReport) {
    // '*' so status / super_id (migration 075) are read when present; missing status = final.
    const { data: report, error } = await adminSupabase.from('daily_reports').select('*').eq('id', reportId).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!report) return Response.json({ error: 'Report not found.' }, { status: 404 })
    if (report.job_id !== jobId) return forbidden()
    if (isDraftReport(report) && !canEditDraft(auth, report)) return Response.json({ error: 'This draft belongs to someone else.' }, { status: 403 })
    const element = (Array.isArray(report.photos) ? report.photos : []).find(p => p?.path === path)
    if (!element) return Response.json({ error: 'Photo not found on this report.' }, { status: 404 })
    if (isReferencedReportPhoto(element)) {
      // A picked job photo follows its job_photos row's CURRENT internal_only (prompt 85 M2), so
      // the toggle goes to that row when it still exists.
      const { data: jp, error: jpErr } = await adminSupabase.from('job_photos').select('id').eq('storage_path', path).eq('job_id', jobId).limit(1).maybeSingle()
      if (jpErr) return Response.json({ error: jpErr.message }, { status: 500 })
      if (jp) return setGalleryInternal(path, jobId, internalOnly)
    }
    // Report-only upload — or a picked photo whose job_photos row was deleted: it now lives only
    // on the report, so the reference markers are dropped and the element's own flag applies.
    const { photos: flagged } = setReportPhotoInternal(report.photos, path, internalOnly)
    const photos = flagged.map(p => {
      if (!p || p.path !== path || !isReferencedReportPhoto(p)) return p
      const rest = { ...p }
      delete rest.job_photo_id
      delete rest.source
      return rest
    })
    const { error: upErr } = await adminSupabase.from('daily_reports').update({ photos }).eq('id', reportId).eq('job_id', jobId)
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
    return Response.json({ ok: true, internal_only: internalOnly })
  }

  return setGalleryInternal(path, jobId, internalOnly)
}

// Gallery photo: the row must be on this job.
async function setGalleryInternal(path, jobId, internalOnly) {
  const { data: row, error: findErr } = await adminSupabase.from('job_photos').select('id, job_id').eq('storage_path', path).eq('job_id', jobId).limit(1).maybeSingle()
  if (findErr) return Response.json({ error: findErr.message }, { status: 500 })
  if (!row) return Response.json({ error: 'Photo not found on this job.' }, { status: 404 })
  const { error: upErr } = await adminSupabase.from('job_photos').update({ internal_only: internalOnly }).eq('storage_path', path).eq('job_id', jobId)
  if (upErr) {
    if (isMissingColumnError(upErr)) return Response.json({ error: MIGRATION_070_TOGGLE_MESSAGE, migration_required: '070' }, { status: 503 })
    return Response.json({ error: upErr.message }, { status: 500 })
  }
  return Response.json({ ok: true, internal_only: internalOnly })
}
