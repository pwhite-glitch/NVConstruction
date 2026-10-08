import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const all = searchParams.get('all')

  if (all) {
    const { data, error } = await adminSupabase
      .from('job_orders')
      .select('*, jobs(job_number, project_name), ordered_by_profile:profiles!job_orders_ordered_by_fkey(full_name)')
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  if (!job_id) return Response.json({ error: 'job_id or all required' }, { status: 400 })

  const [ordersRes, assignRes] = await Promise.all([
    adminSupabase.from('job_orders').select('*, ordered_by_profile:profiles!job_orders_ordered_by_fkey(full_name)').eq('job_id', job_id).order('created_at', { ascending: false }),
    adminSupabase.from('job_template_assignments').select('id, template_id, order_templates(id, name, description, order_template_items(id, item_name, category, default_qty, unit, sort_order))').eq('job_id', job_id),
  ])

  return Response.json({
    orders: ordersRes.data || [],
    assigned_templates: assignRes.data || [],
  })
}

export async function POST(request) {
  const body = await request.json()

  // Assign a template to a job
  if (body.assign_template) {
    const { job_id, template_id } = body
    if (!job_id || !template_id) return Response.json({ error: 'job_id and template_id required' }, { status: 400 })
    const { data, error } = await adminSupabase.from('job_template_assignments').insert({ job_id, template_id, assigned_by: body.assigned_by || null }).select('id, template_id, order_templates(id, name, description, order_template_items(id, item_name, category, default_qty, unit, sort_order))').single()
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'already_assigned' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ data })
  }

  const { job_id, vendor, description, quantity, unit, amount, po_number, tracking_number, carrier, status, notes, ordered_at, template_item_id, ordered_by } = body
  if (!job_id || !description) return Response.json({ error: 'job_id and description required' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('job_orders')
    .insert({ job_id, vendor: vendor || null, description, quantity: parseFloat(quantity) || 1, unit: unit || 'each', amount: amount ? parseFloat(amount) : null, po_number: po_number || null, tracking_number: tracking_number || null, carrier: carrier || null, status: status || 'ordered', notes: notes || null, ordered_at: ordered_at || null, template_item_id: template_item_id || null, ordered_by: ordered_by || null })
    .select('*, ordered_by_profile:profiles!job_orders_ordered_by_fkey(full_name)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function PATCH(request) {
  const body = await request.json()
  const { id, ...updates } = body
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  // Only allow updating safe fields
  const allowed = ['vendor', 'description', 'quantity', 'unit', 'amount', 'po_number', 'tracking_number', 'carrier', 'status', 'notes', 'ordered_at']
  const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))

  const { data, error } = await adminSupabase.from('job_orders').update(patch).eq('id', id).select('*, ordered_by_profile:profiles!job_orders_ordered_by_fkey(full_name)').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

export async function DELETE(request) {
  const body = await request.json()

  if (body.assignment_id) {
    const { error } = await adminSupabase.from('job_template_assignments').delete().eq('id', body.assignment_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('job_orders').delete().eq('id', body.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
