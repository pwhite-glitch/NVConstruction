import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const rfi_id = searchParams.get('rfi_id')
  const job_id = searchParams.get('job_id')
  let query = adminSupabase.from('rfi_comments').select('*').order('created_at', { ascending: true })
  if (rfi_id) query = query.eq('rfi_id', rfi_id)
  if (job_id) query = query.eq('job_id', job_id)
  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ comments: data || [] })
}

export async function POST(request) {
  try {
    const { rfi_id, job_id, author_name, author_role, comment } = await request.json()
    if (!rfi_id || !comment?.trim()) return Response.json({ error: 'rfi_id and comment required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('rfi_comments')
      .insert({ rfi_id, job_id: job_id || null, author_name: author_name || 'Unknown', author_role: author_role || 'owner', comment: comment.trim() })
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ comment: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('rfi_comments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
