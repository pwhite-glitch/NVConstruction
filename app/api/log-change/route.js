import { requireAuth } from '../../../lib/server-auth'
import { logChange } from '../../../lib/change-log'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/log-change
// Allows client-side code (jobdetail) to write change log entries for events that
// happen via direct Supabase calls (job status, prime COs, etc.)
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id, entity_type, entity_id, field_name, old_value, new_value, note } = body
  if (!entity_type) return Response.json({ error: 'entity_type required' }, { status: 400 })

  const { data: prof } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).single()

  await logChange({
    job_id,
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by: auth.userId,
    changed_by_name: prof?.full_name || null,
    note,
  })

  return Response.json({ ok: true })
}
