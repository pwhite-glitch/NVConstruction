import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { ownerJobDenied } from '../../../lib/owner-access'
import { ownerPhotoList, signOwnerPhotos, thumbPath, PHOTO_BUCKET } from '../../../lib/owner-photos'
import { parseOwnerPaging, pageOwnerPhotos } from '../../../lib/photo-visibility'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id&limit&offset — one page of that job's progress photos for the owner portal,
// signed for 1 hour: { photos: [{ path, url, thumb_url, caption, date, source }], total,
// limit, offset, has_more }. Internal-only photos are dropped server-side before paging
// and signing (total excludes them). limit defaults to 100 (1..100), offset to 0.
// Read-only; errors are returned (never an empty gallery standing in for a failure).
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const params = new URL(request.url).searchParams
  const jobId = params.get('job_id')
  const denied = await ownerJobDenied(adminSupabase, auth, jobId)
  if (denied) return denied
  const { limit, offset } = parseOwnerPaging(params)
  try {
    // select('*'): no hard dependency on optional columns (tag / 068, internal_only / 070,
    // latitude / longitude / 066) — a column that isn't there is simply absent.
    const [gal, rep] = await Promise.all([
      adminSupabase.from('job_photos').select('*').eq('job_id', jobId),
      adminSupabase.from('daily_reports').select('id, report_date, photos').eq('job_id', jobId),
    ])
    if (gal.error) return Response.json({ error: gal.error.message }, { status: 500 })
    if (rep.error) return Response.json({ error: rep.error.message }, { status: 500 })
    const page = pageOwnerPhotos(ownerPhotoList({ jobId, jobPhotos: gal.data || [], reports: rep.data || [] }), { limit, offset })
    const meta = { total: page.total, limit: page.limit, offset: page.offset, has_more: page.has_more }
    const noStore = { headers: { 'Cache-Control': 'no-store' } }
    if (!page.photos.length) return Response.json({ photos: [], ...meta }, noStore)
    const paths = [...new Set(page.photos.flatMap(p => [p.path, thumbPath(p.path)].filter(Boolean)))]
    const { data: signed, error: sErr } = await adminSupabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
    if (sErr) return Response.json({ error: sErr.message }, { status: 500 })
    // Thumbnails are optional (fall back to the full image); a full-size image that
    // fails to sign is an error, never silently dropped from the gallery.
    const res = signOwnerPhotos(page.photos, signed)
    if (res.error) {
      console.error('[owner-photos] signing failed', jobId, res.failed.length)
      return Response.json({ error: res.error }, { status: 502 })
    }
    return Response.json({ photos: res.photos, ...meta }, noStore)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
