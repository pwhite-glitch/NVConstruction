import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { ownerJobDenied } from '../../../lib/owner-access'
import { ownerResDraws } from '../../../lib/owner-res-draws'
import { isMissingRelation } from '../../../lib/budget-line-refs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const isResidential = job => String(job?.job_type ?? '').trim().toLowerCase() === 'residential'

// Base columns (before migration 046) and the 046 funded amount. Internal fields
// (notes, schedule lines, attachments, link ids) are never read for the owner.
const BASE_COLS = 'id, job_id, draw_number, title, period_start, period_end, amount_requested, status, submitted_date, funded_date'

// GET ?job_id — the homeowner's view of a RESIDENTIAL job's owner/lender draws
// (res_owner_draws): non-draft, non-void draws with number, period, requested, received
// when known, status; plus totals. A funded draw with no recorded amount is "unknown",
// never its requested amount. Commercial jobs answer { residential: false } with no draws
// (they bill through AIA pay apps: /api/owner-pay-apps).
// Access: client owner whose email is the job's owner_email; office preview per
// ownerJobDenied (principal/admin any job, pm/apm/super on their job). Others 403.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  const denied = await ownerJobDenied(adminSupabase, auth, jobId)
  if (denied) return denied
  try {
    const { data: job, error: jobErr } = await adminSupabase.from('jobs').select('id, job_type').eq('id', jobId).maybeSingle()
    if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 })
    if (!isResidential(job)) return Response.json({ residential: false, draws: [], totals: null }, { headers: { 'Cache-Control': 'no-store' } })

    let { data, error } = await adminSupabase.from('res_owner_draws').select(`${BASE_COLS}, amount_funded`).eq('job_id', jobId).order('draw_number')
    let fundedTracked = true
    if (error && isMissingRelation(error)) {
      // 046 not applied: no funded amounts exist, so every funded draw's received is unknown.
      ({ data, error } = await adminSupabase.from('res_owner_draws').select(BASE_COLS).eq('job_id', jobId).order('draw_number'))
      fundedTracked = false
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ residential: true, funded_tracked: fundedTracked, ...ownerResDraws(data || []) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
