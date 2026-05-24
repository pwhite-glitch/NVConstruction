import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ setting: null })
  const { data } = await adminSupabase.from('warranty_settings').select('*').eq('job_id', job_id).single()
  return Response.json({ setting: data || null })
}

export async function POST(request) {
  const { job_id, start_date, end_date, coverage_notes } = await request.json()
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
  const { data, error } = await adminSupabase
    .from('warranty_settings')
    .upsert({ job_id, start_date: start_date || null, end_date: end_date || null, coverage_notes: coverage_notes || null }, { onConflict: 'job_id' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ setting: data })
}
