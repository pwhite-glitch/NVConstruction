import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { ownerJobDenied } from '../../../lib/owner-access'
import { ownerPayApps } from '../../../lib/owner-pay-apps'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?job_id — the owner's view of that job's prime pay applications:
// { apps: [{ app_number, period_from, period_to, status, current_payment_due, ... }],
//   billed_to_date, has_aia }. Drafts and NV-as-sub sequences are left out. The G703
// lines are read with the service role (owners have no SELECT on them).
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const jobId = new URL(request.url).searchParams.get('job_id')
  const denied = await ownerJobDenied(adminSupabase, auth, jobId)
  if (denied) return denied
  try {
    const { data: apps, error } = await adminSupabase.from('aia_applications').select('*').eq('job_id', jobId).is('nv_subcontract_id', null)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const prime = apps || []
    const linesByApp = {}
    if (prime.length) {
      const { data: lines, error: lErr } = await adminSupabase.from('aia_application_lines').select('*').in('application_id', prime.map(a => a.id))
      if (lErr) return Response.json({ error: lErr.message }, { status: 500 })
      for (const l of lines || []) (linesByApp[l.application_id] ||= []).push(l)
    }
    const { data: budgetItems, error: bErr } = prime.length
      ? await adminSupabase.from('budget_items').select('id, job_id, budget_amount, owner_amount').eq('job_id', jobId)
      : { data: [], error: null }
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 })
    return Response.json(ownerPayApps({ apps: prime, linesByApp, budgetItems: budgetItems || [] }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
