import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { ownerJobDenied } from '../../../lib/owner-access'
import { ownerPhotoList, signOwnerPhotos, thumbPath, PHOTO_BUCKET } from '../../../lib/owner-photos'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id — that job's progress photos for the owner portal, signed for 1 hour:
// { photos: [{ path, url, thumb_url, caption, date, source }] }. Read-only; errors are
// returned (never an empty gallery standing in for a failure).
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  const denied = await ownerJobDenied(adminSupabase, auth, jobId)
  if (denied) return denied
  try {
    const [gal, rep] = await Promise.all([
      adminSupabase.from('job_photos').select('storage_path, file_name, caption, tag, taken_at, created_at').eq('job_id', jobId),
      adminSupabase.from('daily_reports').select('id, report_date, photos').eq('job_id', jobId),
    ])
    if (gal.error) return Response.json({ error: gal.error.message }, { status: 500 })
    if (rep.error) return Response.json({ error: rep.error.message }, { status: 500 })
    const list = ownerPhotoList({ jobId, jobPhotos: gal.data || [], reports: rep.data || [] }).slice(0, 500)
    if (!list.length) return Response.json({ photos: [] })
    const paths = [...new Set(list.flatMap(p => [p.path, thumbPath(p.path)].filter(Boolean)))]
    const { data: signed, error: sErr } = await adminSupabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
    if (sErr) return Response.json({ error: sErr.message }, { status: 500 })
    // Thumbnails are optional (fall back to the full image); a full-size image that
    // fails to sign is an error, never silently dropped from the gallery.
    const res = signOwnerPhotos(list, signed)
    if (res.error) {
      console.error('[owner-photos] signing failed', jobId, res.failed.length)
      return Response.json({ error: res.error }, { status: 502 })
    }
    return Response.json({ photos: res.photos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
