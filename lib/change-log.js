import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Entity types a browser may ask /api/log-change to record. Server routes log
// their own entries through logChange() directly and are not limited by this.
export const CLIENT_LOG_ENTITY_TYPES = new Set(['job'])
export const CLIENT_LOG_FIELDS = { job: new Set(['status', 'contract_value']) }
export const LOG_NOTE_MAX = 500

/**
 * Insert a change_log entry. Never throws — logging failure must not block the main action.
 * Always written with the service role (browser clients have no INSERT on change_log after
 * migration 055). changed_by_name is ONLY ever the changed_by person's
 * profiles.full_name, looked up here on the server. A caller-supplied
 * changed_by_name is ignored entirely: with no profile name, or no changed_by,
 * the stored name is null (the UI then shows no name).
 */
export async function logChange({ job_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, note }) {
  try {
    const db = adminSupabase
    let name = null
    if (changed_by) {
      const { data } = await db.from('profiles').select('full_name').eq('id', changed_by).maybeSingle()
      name = (typeof data?.full_name === 'string' && data.full_name.trim()) ? data.full_name : null
    }
    const { error } = await db.from('change_log').insert({
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
    if (error) console.error('[change_log]', error.message)
  } catch (e) {
    console.error('[change_log]', e?.message)
  }
}
