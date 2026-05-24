import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ notices: [] })
  const { data, error } = await adminSupabase
    .from('prelim_notices')
    .select('*')
    .eq('job_id', job_id)
    .order('received_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ notices: data || [] })
}

export async function POST(request) {
  const { job_id, from_company, amount_claimed, received_at, notes } = await request.json()
  if (!job_id || !from_company) return Response.json({ error: 'job_id and from_company required' }, { status: 400 })
  const { data: notice, error } = await adminSupabase
    .from('prelim_notices')
    .insert({ job_id, from_company, amount_claimed: amount_claimed || null, received_at: received_at || new Date().toISOString().split('T')[0], notes: notes || null })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ notice })
}

export async function PATCH(request) {
  const { id, status, notes } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const updates = {}
  if (status !== undefined) updates.status = status
  if (notes !== undefined) updates.notes = notes
  const { error } = await adminSupabase.from('prelim_notices').update(updates).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('prelim_notices').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
