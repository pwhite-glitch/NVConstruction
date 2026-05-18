import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  const { data, error } = await adminSupabase
    .from('employees')
    .select('*')
    .order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employees: data || [] })
}

export async function POST(request) {
  const body = await request.json()
  const { data, error } = await adminSupabase
    .from('employees')
    .insert(body)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employee: data })
}

export async function PATCH(request) {
  const { id, ...updates } = await request.json()
  const { data, error } = await adminSupabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ employee: data })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('employees').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
