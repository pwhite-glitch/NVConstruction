import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyJob } from '../../../../lib/roles'
import { isUuid } from '../../../../lib/generated-contract'
import { SIGNED_UPLOAD_ROLES } from '../../../../lib/signed-upload'
import { isSignwellEnabled, isSignwellTestMode } from '../../../../lib/signwell'
import { loadSignwellSubcontract, remindSignwell, voidSignwell } from '../../../../lib/signwell-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// Office SignWell actions for subcontracts (prompt 98).
// Owner/admin: any job; PM/APM: assigned jobs (denyJob). Supers and subs are refused.

// GET → { enabled, test_mode }. Booleans only; the key is never sent.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!SIGNED_UPLOAD_ROLES.has(auth.role)) return Response.json({ enabled: false, test_mode: false })
  const enabled = isSignwellEnabled()
  return Response.json({ enabled, test_mode: enabled && isSignwellTestMode() })
}

// POST { subcontract_id, action: 'remind' | 'void' }
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!SIGNED_UPLOAD_ROLES.has(auth.role)) return Response.json({ error: 'Only office staff can manage SignWell requests.' }, { status: 403 })
  if (!isSignwellEnabled()) return Response.json({ error: 'SignWell is not configured.' }, { status: 409 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const id = body?.subcontract_id
  const action = body?.action
  if (!isUuid(id) || !['remind', 'void'].includes(action)) return Response.json({ error: 'subcontract_id and action (remind | void) required' }, { status: 400 })

  const r = await loadSignwellSubcontract(adminSupabase, id)
  if (r.error) return Response.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status })
  const denied = await denyJob(adminSupabase, auth, r.sc.job_id)
  if (denied) return denied

  const out = action === 'remind' ? await remindSignwell(r.sc) : await voidSignwell(adminSupabase, r.sc)
  if (out.error) return Response.json({ error: out.error }, { status: out.status })
  return Response.json(out)
}
