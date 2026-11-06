import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Owner-only. The whole merge (contacts, people, contracts, job assignments,
// company delete) runs in one transaction in the merge_companies() function
// from migrations/043_merge_companies.sql. Until 043 is applied this returns
// the "function does not exist" error and nothing is changed.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return Response.json({ error: 'Only an Owner can merge companies.' }, { status: 403 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { keep_company_id, remove_company_id } = body || {}
  if (!keep_company_id || !remove_company_id) return Response.json({ error: 'keep_company_id and remove_company_id required' }, { status: 400 })
  if (keep_company_id === remove_company_id) return Response.json({ error: 'Cannot merge a company with itself' }, { status: 400 })

  const { data, error } = await adminSupabase.rpc('merge_companies', { p_keep: keep_company_id, p_remove: remove_company_id })
  if (error) return Response.json({ error: error.message || 'Merge failed' }, { status: 500 })

  const summary = data || {}
  return Response.json({
    ok: true,
    profiles_moved: summary.profiles_moved ?? 0,
    contacts_moved: summary.contacts_moved ?? 0,
    contacts_skipped_dup_email: summary.contacts_skipped_dup_email ?? 0,
    assignments_moved: summary.assignments_moved ?? 0,
    assignments_folded: summary.assignments_folded ?? 0,
    contracts_moved: summary.contracts_moved ?? 0,
    kept: summary.kept_name ?? null,
  })
}
