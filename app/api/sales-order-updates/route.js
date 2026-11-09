import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { isMb, canWorkMbOrder, isOffice } from '../../../lib/mb-orders'
import { actorName } from '../../../lib/mb-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Same write set as /api/sales-orders and /api/sales-order-docs. Super may read (GET), never write.
const SALES_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
const err = (error, status) => Response.json({ error }, { status })

// The real order behind an order id. Fails closed.
async function loadOrder(orderId) {
  if (!orderId || typeof orderId !== 'string') return { status: 400, error: 'order_id required' }
  const { data, error } = await adminSupabase.from('sales_orders').select('id, division, salesperson_id').eq('id', orderId).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!data) return { status: 404, error: 'Order not found' }
  return { order: data }
}

// Metal-building orders: office, or a metal_rep on the order. Other divisions keep the role gate only.
async function mbDenied(auth, order) {
  if (!isMb(order)) return null
  const { data: attribution, error } = await adminSupabase.from('sales_attribution').select('salesperson_id').eq('order_id', order.id)
  if (error) return err(error.message, 500)
  if (!canWorkMbOrder(auth, order, attribution || [])) return err('You are not on this order.', 403)
  return null
}

// Load + guard in one step. Returns { order } or { response }.
async function guardOrder(auth, orderId) {
  const o = await loadOrder(orderId)
  if (o.error) return { response: err(o.error, o.status) }
  const denied = await mbDenied(auth, o.order)
  if (denied) return { response: denied }
  return { order: o.order }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') return err('Forbidden', 403)

  try {
    const { searchParams } = new URL(request.url)
    const order_id = searchParams.get('order_id')
    if (!order_id) return err('order_id required', 400)

    const g = await guardOrder(auth, order_id)
    if (g.response) return g.response

    const { data, error } = await adminSupabase
      .from('sales_order_updates')
      .select('*')
      .eq('order_id', g.order.id)
      .order('created_at', { ascending: false })

    if (error) return err(error.message, 500)
    return Response.json({ updates: data || [] })
  } catch (e) {
    return err(e.message, 500)
  }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role)) return err('Forbidden', 403)

  try {
    const body = await request.json()
    const { action } = body || {}

    if (action === 'create') {
      // author_name in the body is ignored; the name comes from the caller's profile.
      const { order_id, body: text, visible_to_customer, update_type } = body
      if (!order_id || !text) return err('order_id and body required', 400)

      const g = await guardOrder(auth, order_id)
      if (g.response) return g.response
      const name = await actorName(adminSupabase, auth.userId)

      const { data, error } = await adminSupabase
        .from('sales_order_updates')
        .insert({
          order_id:            g.order.id,
          author_id:           auth.userId,
          author_name:         name,
          body:                text,
          visible_to_customer: !!visible_to_customer,
          update_type:         update_type || 'note',
        })
        .select('id')
        .single()

      if (error) return err(error.message, 500)

      await adminSupabase.from('sales_order_history').insert({
        order_id:   g.order.id,
        actor_id:   auth.userId,
        actor_name: name,
        action:     visible_to_customer ? 'customer_update_posted' : 'internal_note_posted',
        details:    { update_id: data.id },
      })

      return Response.json({ ok: true, id: data.id })
    }

    if (action === 'delete') {
      if (!isOffice(auth.role)) return err('Forbidden', 403)
      const { id } = body
      if (!id || typeof id !== 'string') return err('id required', 400)

      const { data: row, error: rowErr } = await adminSupabase.from('sales_order_updates').select('id, order_id').eq('id', id).maybeSingle()
      if (rowErr) return err(rowErr.message, 500)
      if (!row) return err('Update not found', 404)
      const g = await guardOrder(auth, row.order_id)
      if (g.response) return g.response

      const { error } = await adminSupabase.from('sales_order_updates').delete().eq('id', row.id)
      if (error) return err(error.message, 500)
      return Response.json({ ok: true })
    }

    return err('Unknown action', 400)
  } catch (e) {
    return err(e.message, 500)
  }
}
