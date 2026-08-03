import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ purchase_orders: [] })

  const { data: pos, error } = await adminSupabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const sorted = (pos || []).map(po => ({
    ...po,
    purchase_order_items: (po.purchase_order_items || []).sort((a, b) => a.sort_order - b.sort_order),
  }))

  return Response.json({ purchase_orders: sorted })
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { job_id, vendor_name, description, budget_item_id, notes, status = 'draft', items = [], created_by } = body

    if (!job_id || !vendor_name) return Response.json({ error: 'job_id and vendor_name required' }, { status: 400 })

    // Generate PO number
    const { data: jobRow } = await adminSupabase.from('jobs').select('job_number').eq('id', job_id).single()
    const { count } = await adminSupabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('job_id', job_id)
    const seq = String((count || 0) + 1).padStart(3, '0')
    const po_number = `PO-${jobRow?.job_number || 'XX'}-${seq}`

    const amount = items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0)

    const { data: po, error: poErr } = await adminSupabase
      .from('purchase_orders')
      .insert({ job_id, po_number, vendor_name, description: description || null, budget_item_id: budget_item_id || null, notes: notes || null, status, amount, issued_date: status === 'issued' ? new Date().toISOString().split('T')[0] : null, created_by: created_by || null })
      .select()
      .single()

    if (poErr) return Response.json({ error: poErr.message }, { status: 500 })

    if (items.length > 0) {
      const lineItems = items.map((i, idx) => ({
        po_id: po.id,
        description: i.description,
        qty: parseFloat(i.qty) || 1,
        unit: i.unit || null,
        unit_price: parseFloat(i.unit_price) || 0,
        amount: (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0),
        sort_order: idx,
      }))
      await adminSupabase.from('purchase_order_items').insert(lineItems)
    }

    return Response.json({ purchase_order: po })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const body = await request.json()
    const { id, items, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const updates = {}
    if (fields.status !== undefined) {
      updates.status = fields.status
      if (fields.status === 'issued' && !fields.issued_date) updates.issued_date = new Date().toISOString().split('T')[0]
    }
    if (fields.vendor_name !== undefined) updates.vendor_name = fields.vendor_name
    if (fields.description !== undefined) updates.description = fields.description || null
    if (fields.budget_item_id !== undefined) updates.budget_item_id = fields.budget_item_id || null
    if (fields.notes !== undefined) updates.notes = fields.notes || null
    if (fields.draw_request_id !== undefined) updates.draw_request_id = fields.draw_request_id || null
    if (fields.drawn_at !== undefined) updates.drawn_at = fields.drawn_at || null

    if (items !== undefined) {
      updates.amount = items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0)
      await adminSupabase.from('purchase_order_items').delete().eq('po_id', id)
      if (items.length > 0) {
        await adminSupabase.from('purchase_order_items').insert(
          items.map((i, idx) => ({
            po_id: id,
            description: i.description,
            qty: parseFloat(i.qty) || 1,
            unit: i.unit || null,
            unit_price: parseFloat(i.unit_price) || 0,
            amount: (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0),
            sort_order: idx,
          }))
        )
      }
    }

    if (Object.keys(updates).length > 0) {
      await adminSupabase.from('purchase_orders').update(updates).eq('id', id)
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    await adminSupabase.from('purchase_orders').delete().eq('id', id)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
