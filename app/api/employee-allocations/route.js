import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const employee_id = searchParams.get('employee_id')

  // Employee-centric view: return all allocations for one employee, joined with job info
  if (employee_id && !job_id) {
    const { data, error } = await adminSupabase
      .from('employee_job_allocations')
      .select('*, jobs(id, job_number, project_name)')
      .eq('employee_id', employee_id)
      .order('start_date', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data: data || [] })
  }

  // Job-centric view (existing behaviour)
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
    .select('*, employees(id, name, title, type, weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes), jobs(id, job_number, project_name)')
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Return both keys so existing callers (data.allocation) and new callers ({ data }) both work
  return Response.json({ allocation: data, data })
}

export async function PUT(request) {
  const { id, budget_item_id, budget_line } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('employee_job_allocations').update({ budget_item_id, budget_line }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  let id = searchParams.get('id')

  // Support body-based delete (dashboard sends { id } in body)
  if (!id) {
    try {
      const body = await request.json()
      id = body?.id
    } catch {}
  }

  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('employee_job_allocations').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
