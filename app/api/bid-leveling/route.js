import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, isJobLimited } from '../../../lib/roles'
import { canReadBidPackage, bidPatchError, NO_BID_ACCESS_MESSAGE } from '../../../lib/bid-access'
import { parseLevelingAmount } from '../../../lib/bid-leveling'

// bid_leveling_entries has RLS on with no policies (browser reads/writes are denied),
// so leveling goes through here with the service role and the bid-package rules.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const err = (status, error) => Response.json({ error }, { status })

async function loadPackage(auth, id, forWrite) {
  if (!id) return { res: err(400, 'bid_package_id required') }
  const { data: pkg, error } = await adminSupabase.from('bid_packages').select('*').eq('id', id).maybeSingle()
  if (error) return { res: err(500, error.message) }
  if (!pkg) return { res: err(404, 'Bid package not found.') }
  if (forWrite) {
    const bad = bidPatchError(auth, pkg, {})
    if (bad) return { res: err(bad.status, bad.error) }
  } else if (!canReadBidPackage(auth.role, auth.userId, pkg)) {
    return { res: err(403, NO_BID_ACCESS_MESSAGE) }
  }
  if (isJobLimited(auth.role) && pkg.job_id) {
    const denied = await denyJob(adminSupabase, auth, pkg.job_id)
    if (denied) return { res: denied }
  }
  return { pkg }
}

// GET ?bid_package_id — every leveling entry on that package's submissions.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const id = new URL(request.url).searchParams.get('bid_package_id')
  const { res } = await loadPackage(auth, id, false)
  if (res) return res
  const { data: subs, error } = await adminSupabase.from('bid_submissions').select('id').eq('bid_package_id', id)
  if (error) return err(500, error.message)
  if (!subs?.length) return Response.json({ entries: [] })
  const { data, error: eErr } = await adminSupabase.from('bid_leveling_entries').select('*').in('bid_submission_id', subs.map(s => s.id))
  if (eErr) return err(500, eErr.message)
  return Response.json({ entries: data || [] })
}

// PUT { bid_package_id, bid_submission_id, bid_scope_item_id, amount?, included? }
// Upserts one cell. Blank amount = not quoted (null). Supers and APMs not on the
// package are refused (same rule as editing the package).
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return err(400, 'Invalid JSON') }
  const { bid_package_id, bid_submission_id, bid_scope_item_id } = body || {}
  const { res } = await loadPackage(auth, bid_package_id, true)
  if (res) return res
  if (!bid_submission_id || !bid_scope_item_id) return err(400, 'bid_submission_id and bid_scope_item_id required')

  const [{ data: sub, error: sErr }, { data: item, error: iErr }] = await Promise.all([
    adminSupabase.from('bid_submissions').select('id, bid_package_id').eq('id', bid_submission_id).maybeSingle(),
    adminSupabase.from('bid_scope_items').select('id, bid_package_id').eq('id', bid_scope_item_id).maybeSingle(),
  ])
  if (sErr || iErr) return err(500, (sErr || iErr).message)
  if (!sub || sub.bid_package_id !== bid_package_id) return err(404, 'Bid not found on this package.')
  if (!item || item.bid_package_id !== bid_package_id) return err(404, 'Scope item not found on this package.')

  const fields = {}
  if ('amount' in body) {
    const p = parseLevelingAmount(body.amount)
    if (p.error) return err(400, p.error)
    fields.amount = p.amount
  }
  if ('included' in body) fields.included = body.included !== false

  const find = () => adminSupabase.from('bid_leveling_entries').select('*')
    .eq('bid_submission_id', bid_submission_id).eq('bid_scope_item_id', bid_scope_item_id).maybeSingle()
  const { data: cur, error: cErr } = await find()
  if (cErr) return err(500, cErr.message)
  const update = id => adminSupabase.from('bid_leveling_entries').update(fields).eq('id', id).select('*').single()
  if (cur) {
    if (!Object.keys(fields).length) return Response.json({ entry: cur })
    const { data, error } = await update(cur.id)
    if (error) return err(500, error.message)
    return Response.json({ entry: data })
  }
  const row = { bid_submission_id, bid_scope_item_id, amount: fields.amount ?? null, included: fields.included ?? true }
  const { data, error } = await adminSupabase.from('bid_leveling_entries').insert(row).select('*').single()
  if (error?.code === '23505') {
    // Someone else created the cell at the same moment: update theirs.
    const { data: again } = await find()
    if (!again) return err(409, 'This cell changed. Reload and try again.')
    const { data: d2, error: e2 } = await update(again.id)
    if (e2) return err(500, e2.message)
    return Response.json({ entry: d2 })
  }
  if (error) return err(500, error.message)
  return Response.json({ entry: data })
}
