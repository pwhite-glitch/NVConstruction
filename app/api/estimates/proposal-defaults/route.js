import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { isMissing065, MAX_SECTION_CHARS } from '../../../../lib/estimate-proposal'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Company default exclusions / clarifications for estimate proposals (one row, id = 1,
// migration 065 estimate_proposal_defaults).
//   GET: pm / principal / apm      PUT { default_exclusions?, default_clarifications? }: principal / pm
// Before 065: 503 with a friendly message.
const READ_ROLES = new Set(['pm', 'principal', 'apm'])
const WRITE_ROLES = new Set(['principal', 'pm'])
const COLS = 'id, default_exclusions, default_clarifications, updated_at, updated_by'
const json = (body, status = 200) => Response.json(body, { status })
const missing = () => json({ error: 'Default exclusions are not available yet (database migration 065 has not been applied).', code: 'migration_missing' }, 503)

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!READ_ROLES.has(auth.role)) return json({ error: 'Forbidden' }, 403)
  const { data, error } = await adminSupabase.from('estimate_proposal_defaults').select(COLS).eq('id', 1).maybeSingle()
  if (error) return isMissing065(error) ? missing() : json({ error: error.message }, 500)
  return json({ defaults: data || { id: 1, default_exclusions: null, default_clarifications: null, updated_at: null, updated_by: null } })
}

export async function PUT(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!WRITE_ROLES.has(auth.role)) return json({ error: 'Forbidden' }, 403)
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const patch = {}
  for (const k of ['default_exclusions', 'default_clarifications']) {
    if (!(k in (body || {}))) continue
    const v = body[k]
    if (v !== null && typeof v !== 'string') return json({ error: `${k} must be text.` }, 400)
    if (typeof v === 'string' && v.length > MAX_SECTION_CHARS) return json({ error: `${k} is too long (max ${MAX_SECTION_CHARS} characters).` }, 400)
    patch[k] = typeof v === 'string' && v.trim() ? v : null
  }
  if (!Object.keys(patch).length) return json({ error: 'Nothing to change.' }, 400)
  const row = { ...patch, updated_at: new Date().toISOString(), updated_by: auth.userId || null }

  const { data: existing, error: readErr } = await adminSupabase.from('estimate_proposal_defaults').select('id').eq('id', 1).maybeSingle()
  if (readErr) return isMissing065(readErr) ? missing() : json({ error: readErr.message }, 500)
  const { data, error } = existing
    ? await adminSupabase.from('estimate_proposal_defaults').update(row).eq('id', 1).select(COLS)
    : await adminSupabase.from('estimate_proposal_defaults').insert({ id: 1, ...row }).select(COLS)
  if (error) return isMissing065(error) ? missing() : json({ error: error.message }, 500)
  return json({ defaults: Array.isArray(data) ? data[0] : data })
}
