import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const { data } = await adminSupabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(30)

  const notifications = data || []
  const unread = notifications.filter(n => !n.read_at).length
  return Response.json({ notifications, unread })
}

export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const body = await request.json()

  if (body.mark_all_read) {
    await adminSupabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', auth.userId)
      .is('read_at', null)
    return Response.json({ ok: true })
  }

  if (body.id) {
    await adminSupabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', body.id)
      .eq('recipient_id', auth.userId)
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'id or mark_all_read required' }, { status: 400 })
}
