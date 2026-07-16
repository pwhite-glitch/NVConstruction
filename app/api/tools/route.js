import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  try {
    const { data, error } = await adminSupabase
      .from('tools')
      .select('*, assigned_profile:assigned_to(id, full_name)')
      .order('name')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { data, error } = await adminSupabase
      .from('tools')
      .insert(body)
      .select('*, assigned_profile:assigned_to(id, full_name)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const { id, ...fields } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('tools')
      .update(fields)
      .eq('id', id)
      .select('*, assigned_profile:assigned_to(id, full_name)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('tools').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
