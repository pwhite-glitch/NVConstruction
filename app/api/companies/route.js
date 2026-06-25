import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')

  if (name) {
    const { data } = await adminSupabase
      .from('companies')
      .select('*')
      .ilike('name', name.trim())
      .limit(1)
      .maybeSingle()
    return Response.json({ company: data || null })
  }

  const { data } = await adminSupabase
    .from('companies')
    .select('id, name, phone, email')
    .order('name')
  return Response.json({ companies: data || [] })
}

export async function POST(request) {
  const body = await request.json()
  const { name, phone, email, find_or_create } = body
  if (!name) return Response.json({ error: 'name required' }, { status: 400 })

  if (find_or_create) {
    const { data: existing } = await adminSupabase
      .from('companies')
      .select('*')
      .ilike('name', name.trim())
      .limit(1)
      .maybeSingle()
    if (existing) return Response.json({ company: existing })
  }

  const { data, error } = await adminSupabase
    .from('companies')
    .insert({ name: name.trim(), phone: phone || null, email: email || null })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ company: data })
}

export async function PATCH(request) {
  const { id, name, phone, email } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const updates = {}
  if (name !== undefined) updates.name = name
  if (phone !== undefined) updates.phone = phone
  if (email !== undefined) updates.email = email
  const { error } = await adminSupabase.from('companies').update(updates).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
