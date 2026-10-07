import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Insert a change_log entry.  Never throws — logging failure must not block the main action.
 * If changed_by_name is omitted and changed_by is provided, the name is looked up automatically.
 */
export async function logChange({ job_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_by_name, note }) {
  try {
    let name = changed_by_name
    if (!name && changed_by) {
      const { data } = await adminSupabase.from('profiles').select('full_name').eq('id', changed_by).single()
      name = data?.full_name || null
    }
    await adminSupabase.from('change_log').insert({
      job_id:           job_id   || null,
      entity_type,
      entity_id:        entity_id || null,
      field_name:       field_name || null,
      old_value:        old_value != null ? String(old_value) : null,
      new_value:        new_value != null ? String(new_value) : null,
      changed_by:       changed_by || null,
      changed_by_name:  name,
      note:             note || null,
    })
  } catch (e) {
    console.error('[change_log]', e?.message)
  }
}
