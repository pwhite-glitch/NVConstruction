import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SALES_ROLES = new Set(['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep', 'super'])

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const order_id = searchParams.get('order_id')
    if (!order_id) return Response.json({ error: 'order_id required' }, { status: 400 })

    const { data, error } = await adminSupabase
      .from('sales_order_updates')
      .select('*')
      .eq('order_id', order_id)
      .order('created_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ updates: data || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'create') {
      const { order_id, body: text, visible_to_customer, author_name, update_type } = body
      if (!order_id || !text) return Response.json({ error: 'order_id and body required' }, { status: 400 })

      const { data, error } = await adminSupabase
        .from('sales_order_updates')
        .insert({
          order_id,
          author_id:          auth.userId,
          author_name:        author_name || 'Staff',
          body:               text,
          visible_to_customer: !!visible_to_customer,
          update_type:        update_type || 'note',
        })
        .select('id')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id,
        actor_id:   auth.userId,
        actor_name: author_name || 'Staff',
        action:     visible_to_customer ? 'customer_update_posted' : 'internal_note_posted',
        details:    { update_id: data.id },
      })

      return Response.json({ ok: true, id: data.id })
    }

    if (action === 'delete') {
      if (!['pm', 'apm', 'admin'].includes(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { id } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { error } = await adminSupabase.from('sales_order_updates').delete().eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
