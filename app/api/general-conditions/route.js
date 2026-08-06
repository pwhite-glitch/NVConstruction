import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ entries: [] })

  const { data, error } = await adminSupabase
    .from('general_conditions')
    .select('*')
    .eq('job_id', job_id)
    .order('entry_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data || [] })
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { job_id, description, amount, category, entry_date, budget_item_id, notes, created_by } = body
    if (!job_id || !description || !amount) {
      return Response.json({ error: 'job_id, description, and amount are required' }, { status: 400 })
    }

    const { data, error } = await adminSupabase
      .from('general_conditions')
      .insert({
        job_id,
        description,
        amount: parseFloat(amount),
        category: category || 'general',
        entry_date: entry_date || new Date().toISOString().split('T')[0],
        budget_item_id: budget_item_id || null,
        notes: notes || null,
        created_by: created_by || null,
      })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ entry: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const body = await request.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const updates = {}
    if (fields.description !== undefined) updates.description = fields.description
    if (fields.amount !== undefined) updates.amount = parseFloat(fields.amount)
    if (fields.category !== undefined) updates.category = fields.category
    if (fields.entry_date !== undefined) updates.entry_date = fields.entry_date
    if (fields.budget_item_id !== undefined) updates.budget_item_id = fields.budget_item_id || null
    if (fields.notes !== undefined) updates.notes = fields.notes || null
    if (fields.draw_request_id !== undefined) updates.draw_request_id = fields.draw_request_id || null
    if (fields.drawn_at !== undefined) updates.drawn_at = fields.drawn_at || null

    const { error } = await adminSupabase.from('general_conditions').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('general_conditions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
