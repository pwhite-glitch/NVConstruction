import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WRITER_ROLES = new Set(['pm', 'apm', 'admin'])

// Columns that may not exist if a migration hasn't been run yet.
// On schema cache error, these are stripped and the update is retried.
const OPTIONAL_COLS = new Set(['nv_role', 'billing_type', 'pm_email',
  'sub_billing_start', 'sub_billing_frequency', 'sub_billing_due', 'sub_billing_anchor',
  'owner_billing_start', 'owner_billing_frequency', 'owner_billing_due', 'owner_billing_anchor'])

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!WRITER_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, fields } = body
  if (!id || !fields) return Response.json({ error: 'id and fields required' }, { status: 400 })

  let updateFields = { ...fields }
  let { error } = await adminSupabase.from('jobs').update(updateFields).eq('id', id)

  if (error && error.message && error.message.includes('schema cache')) {
    updateFields = Object.fromEntries(Object.entries(updateFields).filter(([k]) => !OPTIONAL_COLS.has(k)))
    const retry = await adminSupabase.from('jobs').update(updateFields).eq('id', id)
    error = retry.error
  }

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
