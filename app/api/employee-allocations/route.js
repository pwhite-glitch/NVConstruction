import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal, denyUnlessOnJob } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Employee pay and labor charges are Owner-only (principal). The one exception
// is the job-centric read the Budget tab uses: PM/APM/super on that job get
// hours/dates/budget line only, with no pay fields.
const OWNER_ONLY = () => Response.json({ error: 'Only Owners can manage employee labor.' }, { status: 403 })
const PAY_EMPLOYEE_COLS = 'employees(id, name, title, type, weekly_salary, weekly_truck, weekly_healthcare, weekly_taxes)'
const SAFE_EMPLOYEE_COLS = 'employees(id, name, title, type)'
// Allocation columns that are not pay figures (no select('*') for non-Owners).
const SAFE_ALLOC_COLS = 'id, job_id, employee_id, allocation_type, percentage, start_date, end_date, budget_item_id, budget_line'
// Columns an Owner may set on a new allocation.
const INSERT_FIELDS = ['job_id', 'employee_id', 'allocation_type', 'percentage', 'start_date', 'end_date', 'budget_item_id', 'budget_line', 'notes']

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const job_id = searchParams.get('job_id')
  const employee_id = searchParams.get('employee_id')

  if (!isPrincipal(auth.role)) {
    // Narrow read: one job the caller is on, no salary/pay columns.
    if (!job_id || employee_id) return OWNER_ONLY()
    const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase
      .from('employee_job_allocations')
      .select(`${SAFE_ALLOC_COLS}, ${SAFE_EMPLOYEE_COLS}`)
      .eq('job_id', job_id)
      .order('start_date', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ allocations: data || [], payHidden: true })
  }

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
    .select(`*, ${PAY_EMPLOYEE_COLS}`)
    .order('start_date', { ascending: false })

  if (job_id) query = query.eq('job_id', job_id)
  if (employee_id) query = query.eq('employee_id', employee_id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ allocations: data || [] })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
  const body = await request.json()
  const row = {}
  for (const k of INSERT_FIELDS) if (body && k in body) row[k] = body[k]
  if (!row.job_id || !row.employee_id) return Response.json({ error: 'job_id and employee_id required' }, { status: 400 })
  const { data, error } = await adminSupabase
    .from('employee_job_allocations')
    .insert(row)
    .select(`*, ${PAY_EMPLOYEE_COLS}, jobs(id, job_number, project_name)`)
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Return both keys so existing callers (data.allocation) and new callers ({ data }) both work
  return Response.json({ allocation: data, data })
}

export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
  const { id, budget_item_id, budget_line } = await request.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { error } = await adminSupabase.from('employee_job_allocations').update({ budget_item_id, budget_line }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
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
