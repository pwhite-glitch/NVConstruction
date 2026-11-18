import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, isPrincipal } from '../../../lib/roles'
import { isAiaLocked } from '../../../lib/aia-lock'
import { isAiaDraft, aiaFinalizeError } from '../../../lib/aia-period'
import { writeWithMissingColumnRetry } from '../../../lib/missing-column-retry'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// POST /api/aia-status — change an owner pay app's (aia_applications) status.
//   { app_id, status: 'draft' | 'submitted' | 'certified', header? }
// Prompt 93: an app cannot leave draft (submitted / certified) without a billing
// period end date (period_to) → 400 with AIA_PERIOD_REQUIRED_MESSAGE. Moving to
// draft is never blocked by the period. Existing rows are never rewritten here
// beyond the status change itself.
// header: only the schedule-freeze columns the job page computes when a prime app
// leaves draft (original_contract_sum, net_change_orders, schedule_frozen_at;
// migration 063 — dropped on retry before it is applied). Back to draft clears
// schedule_frozen_at. Moving a locked (submitted / certified / paid) app back to
// draft is Owner only (the page asks them to type the app number first).
const STATUSES = new Set(['draft', 'submitted', 'certified'])
const FREEZE_COLS = ['original_contract_sum', 'net_change_orders', 'schedule_frozen_at']
const NO_STORE = { 'Cache-Control': 'private, no-store' }
const bad = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status, headers: NO_STORE })

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v) * 100) / 100)

function freezePatch(header) {
  if (!header || typeof header !== 'object') return {}
  const out = {}
  const ocs = num(header.original_contract_sum)
  const nco = num(header.net_change_orders)
  if (ocs !== undefined) out.original_contract_sum = ocs
  if (nco !== undefined) out.net_change_orders = nco
  if (typeof header.schedule_frozen_at === 'string' && !Number.isNaN(Date.parse(header.schedule_frozen_at))) out.schedule_frozen_at = header.schedule_frozen_at
  return out
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  const appId = body?.app_id
  if (!appId) return bad('app_id required')
  const status = String(body?.status ?? '').trim().toLowerCase()
  if (!STATUSES.has(status)) return bad('status must be draft, submitted or certified.')

  const { data: app, error } = await adminSupabase.from('aia_applications').select('*').eq('id', appId).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!app) return bad('Application not found.', 404)
  const denied = await denyJob(adminSupabase, auth, app.job_id)
  if (denied) return denied

  const periodErr = aiaFinalizeError(app, status)
  if (periodErr) return bad(periodErr, 400, { code: 'period_required' })

  const current = isAiaDraft(app) ? 'draft' : String(app.status).toLowerCase()
  if (current === status) return Response.json({ ok: true, app, unchanged: true }, { headers: NO_STORE })
  if (status === 'draft' && isAiaLocked(app) && !isPrincipal(auth.role)) {
    return bad(`App #${app.app_number} is locked. Only an Owner can move it back to draft.`, 403)
  }

  const patch = { status, updated_at: new Date().toISOString() }
  if (!app.nv_subcontract_id) {
    if (status === 'draft') patch.schedule_frozen_at = null
    else if (current === 'draft') Object.assign(patch, freezePatch(body.header))
  }
  const res = await writeWithMissingColumnRetry(
    row => adminSupabase.from('aia_applications').update(row).eq('id', appId).select().maybeSingle(),
    patch,
    { fallbackCols: FREEZE_COLS }
  )
  if (res.error) return bad(res.error.message, 500)
  // patch: exactly what was written (the page merges it into its open app).
  return Response.json({ ok: true, app: res.data || { ...app, ...res.row }, patch: res.row, dropped: res.dropped }, { headers: NO_STORE })
}
