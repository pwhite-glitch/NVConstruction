import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ draws: [] })
  const { data, error } = await adminSupabase
    .from('draw_requests')
    .select('*')
    .eq('job_id', job_id)
    .order('draw_number')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ draws: data || [] })
}

export async function POST(request) {
  const { job_id, title, dc_ids, po_ids } = await request.json()
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })

  // Auto-increment draw_number for this job
  const { data: existing } = await adminSupabase
    .from('draw_requests')
    .select('draw_number')
    .eq('job_id', job_id)
    .order('draw_number', { ascending: false })
    .limit(1)
  const nextNum = ((existing?.[0]?.draw_number) || 0) + 1

  const { data: draw, error } = await adminSupabase
    .from('draw_requests')
    .insert({ job_id, draw_number: nextNum, title: title || `Draw Request ${nextNum}`, status: 'open' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Tag selected direct costs to this draw
  if (dc_ids && dc_ids.length > 0) {
    await adminSupabase.from('direct_costs').update({ draw_request_id: draw.id }).in('id', dc_ids)
  }

  // Tag selected POs to this draw
  if (po_ids && po_ids.length > 0) {
    await adminSupabase.from('purchase_orders').update({ draw_request_id: draw.id, drawn_at: new Date().toISOString() }).in('id', po_ids)
  }

  return Response.json({ draw })
}

export async function PATCH(request) {
  const { id, status, title, add_dc_ids, remove_dc_ids, add_po_ids, remove_po_ids } = await request.json()
  const updates = {}
  if (status !== undefined) updates.status = status
  if (title !== undefined) updates.title = title
  if (Object.keys(updates).length > 0) {
    const { error } = await adminSupabase.from('draw_requests').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  if (add_dc_ids && add_dc_ids.length > 0) {
    await adminSupabase.from('direct_costs').update({ draw_request_id: id }).in('id', add_dc_ids)
  }
  if (remove_dc_ids && remove_dc_ids.length > 0) {
    await adminSupabase.from('direct_costs').update({ draw_request_id: null }).in('id', remove_dc_ids)
  }
  if (add_po_ids && add_po_ids.length > 0) {
    await adminSupabase.from('purchase_orders').update({ draw_request_id: id, drawn_at: new Date().toISOString() }).in('id', add_po_ids)
  }
  if (remove_po_ids && remove_po_ids.length > 0) {
    await adminSupabase.from('purchase_orders').update({ draw_request_id: null, drawn_at: null }).in('id', remove_po_ids)
  }
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  // Unlink direct costs and POs first
  await adminSupabase.from('direct_costs').update({ draw_request_id: null }).eq('draw_request_id', id)
  await adminSupabase.from('purchase_orders').update({ draw_request_id: null, drawn_at: null }).eq('draw_request_id', id)
  const { error } = await adminSupabase.from('draw_requests').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
