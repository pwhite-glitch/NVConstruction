import { createClient } from '@supabase/supabase-js'
import { requireAuth, isPM, isSub } from '../../../lib/server-auth'
import { denyJobs, isJobLimited } from '../../../lib/roles'
import { canReadBidPackage, canEditBidPackage, NO_BID_ACCESS_MESSAGE } from '../../../lib/bid-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SUB_ACTIONS = new Set(['signed-url', 'bulk-signed-urls'])

// True when every path is a plan on a bid package this sub was invited to.
async function subInvitedToPlans(auth, paths) {
  if (!paths.length || !auth.email) return false
  const { data: plans } = await adminSupabase.from('bid_plans').select('storage_path, bid_package_id').in('storage_path', paths)
  if ((plans || []).length === 0 || new Set(plans.map(p => p.storage_path)).size !== new Set(paths).size) return false
  const pkgIds = [...new Set(plans.map(p => p.bid_package_id))]
  const { data: invites } = await adminSupabase.from('bid_invitations').select('bid_package_id').in('bid_package_id', pkgIds).ilike('sub_email', auth.email)
  const invited = new Set((invites || []).map(i => i.bid_package_id))
  return pkgIds.every(id => invited.has(id))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WRITE_ACTIONS = new Set(['upload-url', 'insert', 'delete'])

// The bid packages behind a request: bid_package_id, bid_plans rows for the
// paths, and the <package id>/ path prefix.
async function planPackageIds(body) {
  const paths = (body.action === 'bulk-signed-urls' ? (body.paths || []) : [body.path || body.storage_path]).filter(Boolean)
  const pkgIds = new Set(body.bid_package_id ? [body.bid_package_id] : [])
  if (paths.length) {
    const { data: plans } = await adminSupabase.from('bid_plans').select('storage_path, bid_package_id').in('storage_path', paths)
    for (const p of plans || []) pkgIds.add(p.bid_package_id)
    for (const path of paths) {
      const prefix = String(path).split('/')[0]
      if (UUID_RE.test(prefix)) pkgIds.add(prefix)
    }
  }
  return [...pkgIds]
}

// Office staff: APMs only on packages they are listed on (allowed_users), supers
// read-only, and PM/APM job limits for packages linked to a job.
async function denyPlanPackages(auth, body) {
  const write = WRITE_ACTIONS.has(body.action)
  if (write && auth.role === 'super') return Response.json({ error: 'Superintendents cannot change bid plans.' }, { status: 403 })
  if (auth.role !== 'apm' && !isJobLimited(auth.role)) return null
  const ids = await planPackageIds(body)
  // An APM must name a package they are on; a bare path with no package is refused.
  if (!ids.length) return auth.role === 'apm' ? Response.json({ error: NO_BID_ACCESS_MESSAGE }, { status: 403 }) : null
  const { data: pkgs, error } = await adminSupabase.from('bid_packages').select('id, job_id, allowed_users').in('id', ids)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (auth.role === 'apm') {
    const ok = (pkgs || []).length === ids.length && pkgs.every(p => (write ? canEditBidPackage : canReadBidPackage)(auth.role, auth.userId, p))
    if (!ok) return Response.json({ error: NO_BID_ACCESS_MESSAGE }, { status: 403 })
  }
  return isJobLimited(auth.role) ? denyJobs(adminSupabase, auth, (pkgs || []).map(p => p.job_id)) : null
}

// Office staff: every action. Sub users: view (signed) URLs for plans on
// packages they were invited to bid on.
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()

    if (!isPM(auth.role)) {
      if (!isSub(auth.role) || !SUB_ACTIONS.has(body.action)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const paths = body.action === 'signed-url' ? [body.path].filter(Boolean) : (body.paths || [])
      if (!(await subInvitedToPlans(auth, paths))) return Response.json({ error: 'Forbidden' }, { status: 403 })
    } else {
      const denied = await denyPlanPackages(auth, body)
      if (denied) return denied
    }
    // Office can issue long-lived links for bid invite emails; sub links last at most an hour
    const expiry = isPM(auth.role) ? (body.expiry || 3600) : Math.min(Number(body.expiry) || 3600, 3600)

    if (body.action === 'upload-url') {
      const { data, error } = await adminSupabase.storage
        .from('bid-plans')
        .createSignedUploadUrl(body.path)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (body.action === 'signed-url') {
      const { data, error } = await adminSupabase.storage
        .from('bid-plans')
        .createSignedUrl(body.path, expiry)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (body.action === 'bulk-signed-urls') {
      const paths = body.paths || []
      const urls = {}
      for (const path of paths) {
        const { data, error } = await adminSupabase.storage.from('bid-plans').createSignedUrl(path, expiry)
        if (!error && data?.signedUrl) urls[path] = data.signedUrl
      }
      return Response.json({ urls })
    }

    if (body.action === 'insert') {
      const { error } = await adminSupabase.from('bid_plans').insert({
        bid_package_id: body.bid_package_id,
        file_name: body.file_name,
        storage_path: body.storage_path,
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    if (body.action === 'delete') {
      await adminSupabase.storage.from('bid-plans').remove([body.path])
      await adminSupabase.from('bid_plans').delete().eq('storage_path', body.path)
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
