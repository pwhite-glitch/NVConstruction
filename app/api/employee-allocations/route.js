import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, isJobLimited, accessibleJobIds } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const employee_id = searchParams.get('employee_id')

  // PM/APM: one of their jobs, or (no job_id) only rows on their jobs
  let limitIds = null
  if (job_id) {
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
  } else if (isJobLimited(auth.role)) {
    const { ids, error } = await accessibleJobIds(adminSupabase, auth)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    limitIds = [...ids]
  }

  // Employee-centric view: return all allocations for one employee, joined with job info
  if (employee_id && !job_id) {
    if (limitIds && limitIds.length === 0) return Response.json({ data: [] })
    let empQuery = adminSupabase
      .from('employee_job_allocations')
      .select('*, jobs(id, job_number, project_name)')
      .eq('employee_id', employee_id)
      .order('start_date', { ascending: false })
    if (limitIds) empQuery = empQuery.in('job_id', limitIds)
    const { data, error } = await empQuery
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
  if (limitIds) {
    if (limitIds.length === 0) return Response.json({ allocations: [] })
    query = query.in('job_id', limitIds)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ allocations: data || [] })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const body = await request.json()
  const denied = await denyJob(adminSupabase, auth, body?.job_id)
  if (denied) return denied
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { id, budget_item_id, budget_line } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const denied = await denyJobOf(adminSupabase, auth, 'employee_job_allocations', id)
  if (denied) return denied
  const { error } = await adminSupabase.from('employee_job_allocations').update({ budget_item_id, budget_line }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
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
  const denied = await denyJobOf(adminSupabase, auth, 'employee_job_allocations', id)
  if (denied) return denied
  const { error } = await adminSupabase.from('employee_job_allocations').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
