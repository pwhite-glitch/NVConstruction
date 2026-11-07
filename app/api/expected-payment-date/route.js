import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'
import { isMissingRelation } from '../../../lib/budget-line-refs'
import { isValidDateOnly, MIGRATION_047_REQUIRED } from '../../../lib/cash-outlook'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// Owner-only planning date on a pay app: PATCH { entity, id, expected_payment_date }.
// Writes ONLY expected_payment_date (PROPOSED column, migration 047 — written,
// NOT applied). Never touches amounts, status, paid_at, payment_received,
// amount_received, funded_date or the AIA lock: a locked certificate can get a
// planning date without being unlocked.
// Hard-coded allow-list: the client names an entity, never a table.
const ENTITIES = {
  aia_application: 'aia_applications',
  res_owner_draw: 'res_owner_draws',
  billing_submission: 'billing_submissions',
}
const ALLOWED_KEYS = new Set(['entity', 'id', 'expected_payment_date'])
const UUIDISH = /^[0-9a-fA-F-]{8,64}$/
const NO_STORE = { 'Cache-Control': 'private, no-store' }
const bad = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status, headers: NO_STORE })

export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return bad('Only Owners can set expected payment dates.', 403)

  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Invalid body')
  const extra = Object.keys(body).filter(k => !ALLOWED_KEYS.has(k))
  if (extra.length) return bad(`Only expected_payment_date can be changed here (refused: ${extra.join(', ')}).`)

  const table = Object.prototype.hasOwnProperty.call(ENTITIES, body.entity) ? ENTITIES[body.entity] : null
  if (!table) return bad('Unknown pay app type.')
  if (typeof body.id !== 'string' || !UUIDISH.test(body.id)) return bad('id required')
  if (!('expected_payment_date' in body)) return bad('expected_payment_date required (a YYYY-MM-DD date, or null to clear).')
  const raw = body.expected_payment_date
  let date
  if (raw === null || raw === '') date = null
  else if (isValidDateOnly(raw)) date = raw
  else return bad('expected_payment_date must be a real calendar date as YYYY-MM-DD, or null.')

  const { data: row, error: findErr } = await adminSupabase.from(table).select('id').eq('id', body.id).maybeSingle()
  if (findErr) return bad(findErr.message, 500)
  if (!row) return bad('Pay app not found.', 404)

  const { data, error } = await adminSupabase.from(table).update({ expected_payment_date: date }).eq('id', body.id).select('id, expected_payment_date')
  if (error) {
    if (isMissingRelation(error)) return bad(MIGRATION_047_REQUIRED, 409, { code: 'migration_required' })
    return bad(error.message, 500)
  }
  const saved = Array.isArray(data) ? data[0] : data
  if (!saved || (saved.expected_payment_date ?? null) !== date) return bad('The date was not saved. Refresh and try again.', 500)
  return Response.json({ ok: true, entity: body.entity, id: saved.id, expected_payment_date: saved.expected_payment_date ?? null }, { headers: NO_STORE })
}
