import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../../lib/roles'
import { parsePickerParams, pickerList } from '../../../../lib/job-photo-picker'
import { thumbOf, PHOTO_BUCKET } from '../../../../lib/report-photo-links'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id&date=YYYY-MM-DD&all=1&source=companycam&limit&offset
// Daily report photo picker (prompt 85, Peyton's decision 4): ALL of the job's photos
// (job_photos rows — CompanyCam imports and gallery uploads), newest first, paged
// (default 40, max 100). source=companycam narrows to CompanyCam photos. date filters to
// that America/Chicago day unless all=1. internal_only photos are included and flagged
// (staff picker — they are hidden from the owner, not from staff).
// Who: requirePM (principal / admin / pm / apm / super) + denyUnlessOnJob. Owner-portal
// clients and subs → 403. Service-role read (APM is not in the job_photos SELECT policy).
// Signed 1 h; thumb_url falls back to the full image (CompanyCam imports may skip thumbs).
// → { photos: [{ id, path, name, caption, taken_at, date, internal_only, companycam, creator,
//      tags, url, thumb_url }], total, limit, offset, has_more, companycam_total }
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const q = parsePickerParams(new URL(request.url).searchParams)
  if (!q.jobId) return Response.json({ error: 'job_id is required.' }, { status: 400 })
  const denied = await denyUnlessOnJob(adminSupabase, auth, q.jobId)
  if (denied) return denied

  // select('*'): companycam_* (074) / internal_only (070) are read when present.
  const { data, error } = await adminSupabase.from('job_photos').select('*').eq('job_id', q.jobId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const list = pickerList(data || [], q)
  const companycamTotal = list.filter(p => p.companycam).length
  const page = list.slice(q.offset, q.offset + q.limit)
  const meta = { total: list.length, limit: q.limit, offset: q.offset, has_more: q.offset + page.length < list.length, companycam_total: companycamTotal }
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  if (!page.length) return Response.json({ photos: [], ...meta }, noStore)

  const paths = [...new Set(page.flatMap(p => [p.path, thumbOf(p.path)].filter(Boolean)))]
  const { data: signed, error: sErr } = await adminSupabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 })
  const urls = Object.fromEntries((signed || []).filter(s => s?.path && s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]))
  const photos = page.map(p => ({ ...p, url: urls[p.path] || null, thumb_url: urls[thumbOf(p.path)] || urls[p.path] || null }))
  return Response.json({ photos, ...meta }, noStore)
}
