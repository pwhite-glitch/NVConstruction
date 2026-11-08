import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, isJobLimited, accessibleJobIds } from '../../../lib/roles'
import { isMissingRelation } from '../../../lib/budget-line-refs'
import {
  canReadBidPackage, canCreateBidPackage, bidPatchError, bidDeleteError,
  normalizeAllowedUsers, NO_BID_ACCESS_MESSAGE,
} from '../../../lib/bid-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Guard the package's job when it has one (packages with no job are not job-scoped).
async function denyPackageJob(auth, pkg) {
  if (!isJobLimited(auth.role)) return null
  return pkg?.job_id ? denyJob(adminSupabase, auth, pkg.job_id) : null
}

async function loadPackage(id) {
  return adminSupabase.from('bid_packages').select('*').eq('id', id).maybeSingle()
}

const fail = e => Response.json({ error: e.error }, { status: e.status })

// GET ?id=… — the package and its plans, invitations, submissions and RFIs,
// only for someone allowed on it (APMs: listed in allowed_users) AND, for a
// job-limited PM / APM, on the package's job when it has one. /bid/[id]
// loads through here so an APM who is not on the package sees "no access".
// GET (no id) — the packages the caller may read (same two rules). Jobless
// pre-award packages follow the package-role rules only.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    const { data, error } = await adminSupabase.from('bid_packages').select('*').order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    let jobIds = null
    if (isJobLimited(auth.role)) {
      const r = await accessibleJobIds(adminSupabase, auth)
      if (r.error) return Response.json({ error: r.error.message || 'Could not check job access.' }, { status: 500 })
      jobIds = r.ids
    }
    const onJob = p => !p.job_id || !jobIds || jobIds.has(p.job_id)
    return Response.json({ packages: (data || []).filter(p => canReadBidPackage(auth.role, auth.userId, p) && onJob(p)) })
  }
  const { data: pkg, error } = await loadPackage(id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!pkg) return Response.json({ error: 'Bid package not found.' }, { status: 404 })
  if (!canReadBidPackage(auth.role, auth.userId, pkg)) return Response.json({ error: NO_BID_ACCESS_MESSAGE, code: 'no_access' }, { status: 403 })
  const deniedJob = await denyPackageJob(auth, pkg)
  if (deniedJob) return deniedJob

  const [plans, invitations, submissions, rfis] = await Promise.all([
    adminSupabase.from('bid_plans').select('*').eq('bid_package_id', id).order('uploaded_at'),
    adminSupabase.from('bid_invitations').select('*').eq('bid_package_id', id).order('sent_at'),
    adminSupabase.from('bid_submissions').select('*').eq('bid_package_id', id).order('submitted_at'),
    adminSupabase.from('bid_rfis').select('*').eq('bid_package_id', id).order('rfi_number'),
  ])
  for (const r of [plans, invitations, submissions]) if (r.error) return Response.json({ error: r.error.message }, { status: 500 })
  const rfiTableExists = !(rfis.error && isMissingRelation(rfis.error))
  if (rfis.error && rfiTableExists) return Response.json({ error: rfis.error.message }, { status: 500 })
  return Response.json({
    package: pkg, plans: plans.data || [], invitations: invitations.data || [], submissions: submissions.data || [],
    rfis: rfis.data || [], rfi_table_exists: rfiTableExists,
  })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canCreateBidPackage(auth.role)) return Response.json({ error: 'Superintendents cannot create bid packages.' }, { status: 403 })

  try {
    const body = await request.json()
    const { title, description, scope_of_work, due_date, job_id, project_address, owner_name, insurance_req, bid_instructions } = body
    if (!title?.trim()) return Response.json({ error: 'title is required' }, { status: 400 })
    // A package with no job yet is not job-scoped
    if (job_id) {
      const denied = await denyJob(adminSupabase, auth, job_id)
      if (denied) return denied
    }

    const { data, error } = await adminSupabase.from('bid_packages').insert({
      title: title.trim(),
      description: description || null,
      scope_of_work: scope_of_work || null,
      due_date: due_date || null,
      job_id: job_id || null,
      project_address: project_address || null,
      owner_name: owner_name || null,
      insurance_req: insurance_req || null,
      bid_instructions: bid_instructions || null,
      created_by: auth.userId,
      status: 'open',
      // An APM who creates a package is put on it, or they could not open it.
      ...(auth.role === 'apm' ? { allowed_users: [auth.userId] } : {}),
    }).select('id').single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const allowed = ['status', 'due_date', 'job_id', 'allowed_users']
    const updates = {}
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key]
    }

    if (Object.keys(updates).length === 0) return Response.json({ ok: true })
    if ('allowed_users' in updates) {
      const n = normalizeAllowedUsers(updates.allowed_users)
      if (n.error) return Response.json({ error: n.error }, { status: 400 })
      updates.allowed_users = n.list
    }

    const { data: pkg, error: pkgErr } = await loadPackage(id)
    if (pkgErr) return Response.json({ error: pkgErr.message }, { status: 500 })
    if (!pkg) return Response.json({ error: 'Bid package not found.' }, { status: 404 })
    const refused = bidPatchError(auth, pkg, updates)
    if (refused) return fail(refused)

    const denied = await denyPackageJob(auth, pkg) || (updates.job_id ? await denyJob(adminSupabase, auth, updates.job_id) : null)
    if (denied) return denied

    const { error } = await adminSupabase.from('bid_packages').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const refused = bidDeleteError(auth)
    if (refused) return fail(refused)
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: pkg, error: pkgErr } = await loadPackage(id)
    if (pkgErr) return Response.json({ error: pkgErr.message }, { status: 500 })
    if (!pkg) return Response.json({ error: 'Bid package not found.' }, { status: 404 })
    const denied = await denyPackageJob(auth, pkg)
    if (denied) return denied
    const { error } = await adminSupabase.from('bid_packages').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
