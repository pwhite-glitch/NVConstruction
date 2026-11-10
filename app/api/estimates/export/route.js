import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/server-auth'
import { todayCentral } from '../../../../lib/central-date'
import { proposalHash, exportPatch, has065Columns, isMissing065, sortAlternates } from '../../../../lib/estimate-proposal'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/estimates/export { id } → { estimate, changed }
// Loads the SAVED estimate + line items + alternates and decides the proposal revision:
//   first export: revision stays (0 → prints no revision line), proposal_date = today if empty
//   content changed since the last export: revision + 1, proposal_date = today (Central)
//   same content: nothing written
// Writes revision / proposal_date / proposal_exported_at / proposal_export_hash with a
// compare-and-set on (updated_at, revision, proposal_export_hash); a concurrent change → 409.
// updated_at is NOT changed, so the Estimator's save base stays valid.
// Access: principal, pm and apm only — the roles the estimates RLS policy lets read estimates
// (the same set /api/estimates/to-job uses, minus dev). super and admin are in PM_ROLES but
// cannot read estimates under RLS, so they get 403 here before anything is loaded or written.
// No creator / allowed_users fallback: every role that can reach it is already allowed.
// Before migration 065: returns the saved estimate unchanged (no revision, no alternates).
const json = (body, status = 200) => Response.json(body, { status })
const EXPORT_ROLES = new Set(['principal', 'pm', 'apm'])

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!EXPORT_ROLES.has(auth.role)) return json({ error: 'Forbidden' }, 403)
  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const id = body?.id
  if (!id) return json({ error: 'Estimate id is required' }, 400)

  try {
    const { data: est, error } = await adminSupabase
      .from('estimates').select('*, estimate_line_items(*)').eq('id', id).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!est) return json({ error: 'Estimate not found' }, 404)

    const lines = [...(est.estimate_line_items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    let alternates = []
    const { data: alts, error: altErr } = await adminSupabase
      .from('estimate_alternates').select('id, description, kind, amount, accepted, sort_order').eq('estimate_id', id)
    if (altErr && !isMissing065(altErr)) return json({ error: altErr.message }, 500)
    if (!altErr) alternates = sortAlternates(alts)

    const printable = { ...est, estimate_line_items: lines, alternates }
    // Before 065: nothing to record; print the saved estimate as is.
    if (!has065Columns(est)) return json({ estimate: printable, changed: false, migration_missing: true })

    const hash = proposalHash(est, lines, alternates)
    const patch = exportPatch(est, hash, todayCentral())
    if (!patch) return json({ estimate: printable, changed: false })

    const write = { ...patch, proposal_exported_at: new Date().toISOString() }
    let q = adminSupabase.from('estimates').update(write).eq('id', id).eq('revision', est.revision ?? 0)
    q = est.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', est.updated_at)
    q = est.proposal_export_hash == null ? q.is('proposal_export_hash', null) : q.eq('proposal_export_hash', est.proposal_export_hash)
    const { data: rows, error: upErr } = await q.select('id')
    if (upErr) {
      if (isMissing065(upErr)) return json({ estimate: printable, changed: false, migration_missing: true })
      return json({ error: upErr.message }, 500)
    }
    if (!rows?.length) {
      return json({ error: 'This estimate changed while exporting. Try again.', code: 'stale' }, 409)
    }
    return json({ estimate: { ...printable, ...write }, changed: true })
  } catch (e) {
    return json({ error: e?.message || 'Server error' }, 500)
  }
}
