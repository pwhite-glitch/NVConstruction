import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const employee_id = searchParams.get('employee_id')

  let query = adminSupabase
    .from('employee_job_allocations')
    .select('*, employees(id, name, title, type, weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes)')
    .order('start_date', { ascending: false })

  if (job_id) query = query.eq('job_id', job_id)
  if (employee_id) query = query.eq('employee_id', employee_id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ allocations: data || [] })
}

export async function POST(request) {
  const body = await request.json()
  const { data, error } = await adminSupabase
    .from('employee_job_allocations')
    .insert(body)
    .select('*, employees(id, name, title, type, weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes)')
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ allocation: data })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const { error } = await adminSupabase.from('employee_job_allocations').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
