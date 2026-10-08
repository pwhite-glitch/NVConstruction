import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  const { data, error } = await adminSupabase
    .from('order_templates')
    .select('*, order_template_items(id, item_name, category, default_qty, unit, sort_order)')
    .order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data: data || [] })
}

export async function POST(request) {
  const { name, description, items = [], created_by } = await request.json()
  if (!name?.trim()) return Response.json({ error: 'name required' }, { status: 400 })

  const { data: tpl, error: tplErr } = await adminSupabase
    .from('order_templates')
    .insert({ name: name.trim(), description: description?.trim() || null, created_by: created_by || null })
    .select()
    .single()

  if (tplErr) return Response.json({ error: tplErr.message }, { status: 500 })

  const validItems = items.filter(i => i.item_name?.trim())
  if (validItems.length > 0) {
    await adminSupabase.from('order_template_items').insert(
      validItems.map((it, idx) => ({
        template_id: tpl.id,
        item_name: it.item_name.trim(),
        category: it.category?.trim() || null,
        default_qty: parseFloat(it.default_qty) || 1,
        unit: it.unit?.trim() || 'each',
        sort_order: idx,
      }))
    )
  }

  const { data: full } = await adminSupabase
    .from('order_templates')
    .select('*, order_template_items(id, item_name, category, default_qty, unit, sort_order)')
    .eq('id', tpl.id)
    .single()

  return Response.json({ data: full })
}

export async function PATCH(request) {
  const { id, name, description, add_items = [], remove_item_ids = [] } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  if (name !== undefined || description !== undefined) {
    await adminSupabase.from('order_templates').update({ name: name?.trim(), description: description?.trim() || null }).eq('id', id)
  }
  if (remove_item_ids.length > 0) {
    await adminSupabase.from('order_template_items').delete().in('id', remove_item_ids)
  }
  if (add_items.length > 0) {
    const { data: existing } = await adminSupabase.from('order_template_items').select('sort_order').eq('template_id', id).order('sort_order', { ascending: false }).limit(1)
    const startSort = (existing?.[0]?.sort_order ?? -1) + 1
    await adminSupabase.from('order_template_items').insert(
      add_items.filter(i => i.item_name?.trim()).map((it, idx) => ({
        template_id: id, item_name: it.item_name.trim(), category: it.category?.trim() || null,
        default_qty: parseFloat(it.default_qty) || 1, unit: it.unit?.trim() || 'each', sort_order: startSort + idx,
      }))
    )
  }

  const { data } = await adminSupabase
    .from('order_templates')
    .select('*, order_template_items(id, item_name, category, default_qty, unit, sort_order)')
    .eq('id', id)
    .single()

  return Response.json({ data })
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('order_templates').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
