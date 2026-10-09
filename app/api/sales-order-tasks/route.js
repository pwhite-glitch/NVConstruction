import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'

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
    const order_id   = searchParams.get('order_id')
    const assigneeId = searchParams.get('assignee_id')
    const myWork     = searchParams.get('my_work') === 'true'

    let q = adminSupabase.from('sales_order_tasks').select('*')

    if (order_id)   q = q.eq('order_id', order_id)
    if (assigneeId) q = q.eq('assignee_id', assigneeId)
    if (myWork)     q = q.eq('assignee_id', auth.userId).in('status', ['open', 'in_progress'])

    q = q.order('due_date', { ascending: true, nullsFirst: false })

    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ tasks: data || [] })
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
      const { order_id, title, description, assignee_id, assignee_name, due_date, priority, actor_name } = body
      if (!order_id || !title) return Response.json({ error: 'order_id and title required' }, { status: 400 })

      // Get order_number for My Work display
      const { data: order } = await adminSupabase.from('sales_orders').select('order_number').eq('id', order_id).maybeSingle()

      const { data, error } = await adminSupabase
        .from('sales_order_tasks')
        .insert({
          order_id, title, description: description || null,
          assignee_id: assignee_id || null,
          assignee_name: assignee_name || null,
          due_date: due_date || null,
          priority: priority || 'normal',
          status: 'open',
          created_by: auth.userId,
          created_by_name: actor_name || null,
          order_number: order?.order_number || null,
        })
        .select('id')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('sales_order_history').insert({
        order_id,
        actor_id:   auth.userId,
        actor_name: actor_name || 'Staff',
        action:     'task_created',
        details:    { task_id: data.id, title, assignee_name: assignee_name || null },
      })

      // Notify assignee
      if (assignee_id && assignee_id !== auth.userId) {
        await notify({
          recipient_id: assignee_id,
          type:         'sales_task',
          title:        `Task assigned to you: ${title}`,
          body:         order?.order_number ? `Order ${order.order_number}` : null,
          link:         `/sales/${order_id}?tab=tasks`,
          entity_type:  'sales_order',
          entity_id:    order_id,
          dedup_key:    `task_assigned_${data.id}`,
        })
      }

      return Response.json({ ok: true, id: data.id })
    }

    if (action === 'update') {
      const { id, fields, actor_name } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      const updateFields = {
        ...fields,
        updated_at: new Date().toISOString(),
      }
      if (fields.status === 'done') updateFields.completed_at = new Date().toISOString()

      const { error } = await adminSupabase.from('sales_order_tasks').update(updateFields).eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })

      if (fields.status === 'done') {
        const { data: task } = await adminSupabase.from('sales_order_tasks').select('order_id,title').eq('id', id).maybeSingle()
        if (task) {
          await adminSupabase.from('sales_order_history').insert({
            order_id:   task.order_id,
            actor_id:   auth.userId,
            actor_name: actor_name || 'Staff',
            action:     'task_completed',
            details:    { task_id: id, title: task.title },
          })
        }
      }

      return Response.json({ ok: true })
    }

    if (action === 'delete') {
      const { id } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      const { error } = await adminSupabase.from('sales_order_tasks').delete().eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
