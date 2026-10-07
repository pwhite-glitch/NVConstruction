import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Insert a notification for a user. Never throws — errors are logged only.
 * If dedup_key is provided, skips insert when an unread notification with
 * the same dedup_key already exists for this recipient.
 */
export async function notify({ recipient_id, type, title, body, link, job_id, entity_type, entity_id, dedup_key }) {
  if (!recipient_id) return
  try {
    if (dedup_key) {
      const { count } = await adminSupabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', recipient_id)
        .eq('dedup_key', dedup_key)
        .is('read_at', null)
      if ((count || 0) > 0) return
    }
    await adminSupabase.from('notifications').insert({
      recipient_id,
      type,
      title,
      body:        body        || null,
      link:        link        || null,
      job_id:      job_id      || null,
      entity_type: entity_type || null,
      entity_id:   entity_id   || null,
      dedup_key:   dedup_key   || null,
    })
  } catch (e) {
    console.error('[notify]', e?.message)
  }
}
