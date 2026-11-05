import { createClient } from '@supabase/supabase-js'
import { requireAuth, PM_ROLES } from '../../../lib/server-auth'
import { addDaysCentral } from '../../../lib/central-date'
import { isJobLimited, accessibleJobIds } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MY_WORK_ROLES = new Set([...PM_ROLES, 'metal_rep', 'roofing_rep'])

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!MY_WORK_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const isPM = PM_ROLES.has(auth.role)

  const { data: prof } = await adminSupabase
    .from('profiles')
    .select('full_name')
    .eq('id', auth.userId)
    .single()
  const fullName = prof?.full_name || null

  const in14 = addDaysCentral(14)

  // PM/APM: job items only from their jobs (null = no filter)
  let jobIds = null
  if (isPM && isJobLimited(auth.role)) {
    const { ids, error: accErr } = await accessibleJobIds(adminSupabase, auth)
    if (accErr) return Response.json({ error: accErr.message }, { status: 500 })
    jobIds = [...ids]
  }
  const onMyJobs = q => (jobIds ? q.in('job_id', jobIds) : q)
  const none = jobIds && !jobIds.length

  const promises = [
    // Sales tasks assigned to this user — exclude tasks on preview/test orders
    adminSupabase
      .from('sales_order_tasks')
      .select('id, title, due_date, status, priority, order_id, order_number, sales_orders!inner(division, is_preview_data)')
      .eq('assignee_id', auth.userId)
      .in('status', ['open', 'in_progress'])
      .eq('sales_orders.is_preview_data', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50),
  ]

  if (isPM) {
    const job = q => (none ? Promise.resolve({ data: [] }) : onMyJobs(q))
    promises.push(
      job(adminSupabase
        .from('rfis')
        // rfis has no `question` column; the RFI text is `description` (migrations/040)
        .select('id, title, description, status, created_at, job_id, jobs(id, job_number, project_name)')
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(25)),

      job(adminSupabase
        .from('billing_submissions')
        .select('id, company_name, amount_billed, submitted_at, job_id, jobs(id, job_number, project_name)')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true })
        .limit(25)),

      fullName
        ? job(adminSupabase
            .from('meeting_action_items')
            .select('id, description, due_date, job_id, jobs(id, job_number, project_name)')
            .eq('status', 'open')
            .ilike('assigned_to', `%${fullName}%`)
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(25))
        : Promise.resolve({ data: [] }),

      job(adminSupabase
        .from('milestones')
        .select('id, title, due_date, status, job_id, jobs(id, job_number, project_name)')
        .lte('due_date', in14)
        .neq('status', 'complete')
        .order('due_date', { ascending: true })
        .limit(25))
    )
  }

  const results = await Promise.all(promises)
  const salesTasksRes = results[0]

  return Response.json({
    salesTasks:  (salesTasksRes.data || []).map(t => ({ ...t, division: t.sales_orders?.division || null, sales_orders: undefined })),
    rfis:        isPM ? (results[1]?.data || []) : [],
    billing:     isPM ? (results[2]?.data || []) : [],
    actionItems: isPM ? (results[3]?.data || []) : [],
    milestones:  isPM ? (results[4]?.data || []) : [],
  })
}
