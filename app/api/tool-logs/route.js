import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const tool_id = searchParams.get('tool_id')
    const assigned_to = searchParams.get('assigned_to')

    let query = adminSupabase
      .from('tool_logs')
      .select('*, logged_by_profile:logged_by(full_name), assigned_profile:assigned_to(full_name)')
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (tool_id) query = query.eq('tool_id', tool_id)
    if (assigned_to) query = query.eq('assigned_to', assigned_to)

    const { data, error } = await query
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
      .from('tool_logs')
      .insert(body)
      .select('*, logged_by_profile:logged_by(full_name), assigned_profile:assigned_to(full_name)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
