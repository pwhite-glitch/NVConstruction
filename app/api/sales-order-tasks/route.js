import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'
import { isMb, canWorkMbOrder, isOffice } from '../../../lib/mb-orders'
import { actorName } from '../../../lib/mb-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Same write set as /api/sales-orders and /api/sales-order-docs. Super may read (GET), never write.
const SALES_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
// Client fields a task update may change. Everything else is server-owned.
const UPDATE_FIELDS = ['status', 'title', 'description', 'assignee_id', 'assignee_name', 'due_date', 'priority']
const err = (error, status) => Response.json({ error }, { status })

// The real order behind an order id. Fails closed.
async function loadOrder(orderId) {
  if (!orderId || typeof orderId !== 'string') return { status: 400, error: 'order_id required' }
  const { data, error } = await adminSupabase.from('sales_orders').select('id, division, salesperson_id, order_number').eq('id', orderId).maybeSingle()
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

async function loadTask(id) {
  if (!id || typeof id !== 'string') return { status: 400, error: 'id required' }
  const { data, error } = await adminSupabase.from('sales_order_tasks').select('id, order_id, title, created_by').eq('id', id).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!data) return { status: 404, error: 'Task not found' }
  return { task: data }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') return err('Forbidden', 403)

  try {
    const { searchParams } = new URL(request.url)
    const order_id   = searchParams.get('order_id')
    const assigneeId = searchParams.get('assignee_id')
    const myWork     = searchParams.get('my_work') === 'true'

    // Always scoped to one guarded order — never a cross-order list.
    if (!order_id) return err('order_id required', 400)
    const g = await guardOrder(auth, order_id)
    if (g.response) return g.response

    let q = adminSupabase.from('sales_order_tasks').select('*').eq('order_id', g.order.id)
    if (assigneeId) q = q.eq('assignee_id', assigneeId)
    if (myWork)     q = q.eq('assignee_id', auth.userId).in('status', ['open', 'in_progress'])

    q = q.order('due_date', { ascending: true, nullsFirst: false })

    const { data, error } = await q
    if (error) return err(error.message, 500)

    return Response.json({ tasks: data || [] })
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
      // actor_name in the body is ignored; the name comes from the caller's profile.
      const { order_id, title, description, assignee_id, assignee_name, due_date, priority } = body
      if (!order_id || !title) return err('order_id and title required', 400)

      const g = await guardOrder(auth, order_id)
      if (g.response) return g.response
      const order = g.order
      const name = await actorName(adminSupabase, auth.userId)

      const { data, error } = await adminSupabase
        .from('sales_order_tasks')
        .insert({
          order_id: order.id, title, description: description || null,
          assignee_id: assignee_id || null,
          assignee_name: assignee_name || null,
          due_date: due_date || null,
          priority: priority || 'normal',
          status: 'open',
          created_by: auth.userId,
          created_by_name: name,
          order_number: order.order_number || null,
        })
        .select('id')
        .single()

      if (error) return err(error.message, 500)

      await adminSupabase.from('sales_order_history').insert({
        order_id:   order.id,
        actor_id:   auth.userId,
        actor_name: name,
        action:     'task_created',
        details:    { task_id: data.id, title, assignee_name: assignee_name || null },
      })

      // Notify assignee
      if (assignee_id && assignee_id !== auth.userId) {
        await notify({
          recipient_id: assignee_id,
          type:         'sales_task',
          title:        `Task assigned to you: ${title}`,
          body:         order.order_number ? `Order ${order.order_number}` : null,
          link:         `/sales/${order.id}?tab=tasks`,
          entity_type:  'sales_order',
          entity_id:    order.id,
          dedup_key:    `task_assigned_${data.id}`,
        })
      }

      return Response.json({ ok: true, id: data.id })
    }

    if (action === 'update') {
      const { id, fields } = body
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return err('fields must be an object', 400)

      const t = await loadTask(id)
      if (t.error) return err(t.error, t.status)
      const g = await guardOrder(auth, t.task.order_id)
      if (g.response) return g.response

      const now = new Date().toISOString()
      const updateFields = { updated_at: now }
      for (const k of UPDATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, k)) updateFields[k] = fields[k]
      }
      const done = updateFields.status === 'done'
      if (done) updateFields.completed_at = now

      const { error } = await adminSupabase.from('sales_order_tasks').update(updateFields).eq('id', t.task.id)
      if (error) return err(error.message, 500)

      if (done) {
        await adminSupabase.from('sales_order_history').insert({
          order_id:   t.task.order_id,
          actor_id:   auth.userId,
          actor_name: await actorName(adminSupabase, auth.userId),
          action:     'task_completed',
          details:    { task_id: t.task.id, title: updateFields.title ?? t.task.title },
        })
      }

      return Response.json({ ok: true })
    }

    if (action === 'delete') {
      const t = await loadTask(body.id)
      if (t.error) return err(t.error, t.status)
      const g = await guardOrder(auth, t.task.order_id)
      if (g.response) return g.response
      // Office may delete any task on an order they can work; others only their own.
      if (!isOffice(auth.role) && t.task.created_by !== auth.userId) {
        return err('Only office or the task creator can delete this task.', 403)
      }
      const { error } = await adminSupabase.from('sales_order_tasks').delete().eq('id', t.task.id)
      if (error) return err(error.message, 500)
      return Response.json({ ok: true })
    }

    return err('Unknown action', 400)
  } catch (e) {
    return err(e.message, 500)
  }
}
