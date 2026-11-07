import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { isPrincipal } from '../../../../lib/roles'
import { jobDeleteBlockers } from '../../../../lib/job-lifecycle'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Rows read to decide whether the job has protected financial history.
const HISTORY = [
  { key: 'billings', table: 'billing_submissions', cols: 'id, status, draw_request_id, paid_at, payment_amount' },
  { key: 'draws', table: 'draw_requests', cols: 'id, draw_number, status' },
  { key: 'aiaApps', table: 'aia_applications', cols: 'id, app_number, status, payment_received' },
  { key: 'subcontracts', table: 'subcontracts', cols: 'id, status, signed_at, signed_contract_url' },
  { key: 'directCosts', table: 'direct_costs', cols: 'id, draw_request_id, nv_paid' },
  { key: 'purchaseOrders', table: 'purchase_orders', cols: 'id, draw_request_id' },
  { key: 'generalConditions', table: 'general_conditions', cols: 'id, draw_request_id' },
  { key: 'reimbInvoices', table: 'owner_reimb_invoices', cols: 'id, status' },
]

// POST { job_id } — Owner-only "Delete permanently".
// Refuses (409) when the job has any billing, a closed draw, a locked owner pay
// app, a signed subcontract, drawn/paid costs, or an issued reimbursement
// invoice. Never deletes billings to make a job deletable. The delete itself is
// one transaction in delete_job_if_unprotected() (migrations/044), which
// re-checks the same rules under a row lock; until 044 is applied nothing is
// deleted.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Only an Owner can delete a job.' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const jobId = body?.job_id
  if (!jobId) return Response.json({ error: 'job_id required' }, { status: 400 })

  const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('id').eq('id', jobId).maybeSingle()
  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
  if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })

  const history = {}
  for (const h of HISTORY) {
    const { data, error } = await adminSupabase.from(h.table).select(h.cols).eq('job_id', jobId)
    if (error) return Response.json({ error: `Could not check ${h.table}: ${error.message}` }, { status: 500 })
    history[h.key] = data || []
  }
  // A completed e-sign request also makes a subcontract signed (same as 044).
  const scIds = history.subcontracts.map(sc => sc.id)
  if (scIds.length) {
    const { data: signedReqs, error } = await adminSupabase.from('signing_requests').select('subcontract_id').in('subcontract_id', scIds).eq('status', 'signed')
    if (error) return Response.json({ error: `Could not check signing_requests: ${error.message}` }, { status: 500 })
    const signedIds = new Set((signedReqs || []).map(r => r.subcontract_id))
    history.subcontracts = history.subcontracts.map(sc => ({ ...sc, has_signed_request: signedIds.has(sc.id) }))
  }
  const reasons = jobDeleteBlockers(history)
  if (reasons.length) {
    return Response.json({ error: `This job can't be deleted: ${reasons.join(' ')} Archive it instead.`, reasons }, { status: 409 })
  }

  const { data, error } = await adminSupabase.rpc('delete_job_if_unprotected', { p_job_id: jobId })
  if (error) {
    const missing = error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message || '')
    if (missing) return Response.json({ error: 'Job delete needs migration 044 (delete_job_if_unprotected). Nothing was deleted.' }, { status: 503 })
    return Response.json({ error: `Delete failed, nothing was deleted: ${error.message}` }, { status: 500 })
  }
  if (!data?.ok) {
    const rpcReasons = data?.reasons || []
    return Response.json({ error: `This job can't be deleted: ${rpcReasons.join(' ') || 'it has protected financial history.'}`, reasons: rpcReasons }, { status: 409 })
  }
  return Response.json({ ok: true })
}
