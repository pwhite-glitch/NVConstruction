import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sub_id = searchParams.get('sub_id')
  const job_id = searchParams.get('job_id')
  let q = adminSupabase.from('sub_ratings').select('*, jobs(job_number, project_name)')
  if (sub_id) q = q.eq('sub_id', sub_id)
  if (job_id) q = q.eq('job_id', job_id)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ratings: data || [] })
}

export async function POST(request) {
  const { sub_id, job_id, rated_by, quality, timeliness, communication, notes } = await request.json()
  if (!sub_id || !job_id || !rated_by) {
    return Response.json({ error: 'sub_id, job_id, rated_by required' }, { status: 400 })
  }
  const { data: rating, error } = await adminSupabase
    .from('sub_ratings')
    .upsert({ sub_id, job_id, rated_by, quality, timeliness, communication, notes: notes || null }, { onConflict: 'sub_id,job_id' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rating })
}
