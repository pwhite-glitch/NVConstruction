import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { canReadBidPackage, NO_BID_ACCESS_MESSAGE } from '../../../lib/bid-access'
import { privateJson } from '../../../lib/file-upload-server'
import { itbEntries, itbSlug, itbZipName, itbReadme, MANIFEST_PAGE_SIZE, MAX_SELECTED_IDS } from '../../../lib/export-manifest'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'super'])
const SIGNED_URL_SECONDS = 3600

// POST /api/itb-export — ITB package MANIFEST (prompt 78). No file bytes and no ZIP here.
// Body: { bidPackageId, selectedPlanIds: [id…] (≤ 1000), projectName?, offset? }
// → { project_name, zip_name, total, offset, next_offset, entries: [{ name, url }], readme_text }
// Every page re-checks the caller and the package and returns only plans of THAT package among
// the requested ids; a missing / foreign requested id refuses the whole export. Entry names are
// assigned here from one stable order over ALL selected plans, so pages never collide. URLs are
// 1-hour signed links from the bid-plans bucket. The ITB HTML is generated in the browser and
// never sent here.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!ALLOWED_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { bidPackageId, selectedPlanIds, projectName } = body || {}
  if ('itbHtml' in (body || {})) return Response.json({ error: 'The ITB document is added in the browser; do not send it.' }, { status: 400 })
  if (!bidPackageId || typeof bidPackageId !== 'string' || !Array.isArray(selectedPlanIds)) {
    return Response.json({ error: 'bidPackageId and selectedPlanIds are required' }, { status: 400 })
  }
  if (!selectedPlanIds.length) return Response.json({ error: 'Select at least one document to export.' }, { status: 400 })
  if (selectedPlanIds.length > MAX_SELECTED_IDS || selectedPlanIds.some(id => typeof id !== 'string' || !id || id.length > 64)) {
    return Response.json({ error: `Select up to ${MAX_SELECTED_IDS} documents.` }, { status: 400 })
  }
  if (projectName !== undefined && projectName !== null && (typeof projectName !== 'string' || projectName.length > 200)) {
    return Response.json({ error: 'projectName must be a short string.' }, { status: 400 })
  }
  const offset = body.offset === undefined ? 0 : body.offset
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid offset.' }, { status: 400 })

  const { data: pkg, error: pkgErr } = await adminSupabase
    .from('bid_packages')
    .select('id, title, job_id, allowed_users')
    .eq('id', bidPackageId)
    .maybeSingle()
  if (pkgErr || !pkg) return Response.json({ error: 'Bid package not found' }, { status: 404 })
  if (!canReadBidPackage(auth.role, auth.userId, pkg)) return Response.json({ error: NO_BID_ACCESS_MESSAGE }, { status: 403 })
  // A package with no job is not job-scoped
  if (pkg.job_id) {
    const denied = await denyJob(adminSupabase, auth, pkg.job_id)
    if (denied) return denied
  }

  // Only plans of this package among the requested ids (metadata only).
  const wanted = [...new Set(selectedPlanIds)]
  const { data: plans, error: plansErr } = await adminSupabase
    .from('bid_plans')
    .select('id, file_name, storage_path, bid_package_id')
    .eq('bid_package_id', bidPackageId)
    .in('id', wanted)
  if (plansErr) return Response.json({ error: 'Failed to load document records' }, { status: 500 })
  const mine = (plans || []).filter(p => p.bid_package_id === bidPackageId && p.storage_path)
  const found = new Set(mine.map(p => p.id))
  const missing = wanted.filter(id => !found.has(id))
  if (missing.length) {
    return Response.json({ error: `${missing.length} selected document${missing.length > 1 ? 's are' : ' is'} not in this bid package (or ${missing.length > 1 ? 'were' : 'was'} removed). Refresh and select again. Export aborted.` }, { status: 422 })
  }

  const all = itbEntries(mine)
  const page = all.slice(offset, offset + MANIFEST_PAGE_SIZE)
  let entries = []
  if (page.length) {
    const { data: signed, error: signErr } = await adminSupabase.storage.from('bid-plans').createSignedUrls(page.map(e => e.storage_path), SIGNED_URL_SECONDS)
    const failed = signErr ? page : page.filter((e, i) => !signed?.[i]?.signedUrl || signed[i].error)
    if (failed.length) {
      return Response.json({ error: `Could not prepare the following file${failed.length > 1 ? 's' : ''}: ${failed.map(e => e.name.replace(/^Documents\//, '')).join(', ')}. Export aborted. Verify storage and try again.` }, { status: 422 })
    }
    entries = page.map((e, i) => ({ name: e.name, url: signed[i].signedUrl }))
  }

  const name = projectName || pkg.title
  return privateJson({
    project_name: name,
    zip_name: itbZipName(itbSlug(projectName, pkg.title)),
    total: all.length,
    offset,
    next_offset: offset + MANIFEST_PAGE_SIZE < all.length ? offset + MANIFEST_PAGE_SIZE : null,
    entries,
    readme_text: itbReadme({ projectName: name, docCount: all.length }),
  })
}
