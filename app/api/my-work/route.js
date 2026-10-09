import { createClient } from '@supabase/supabase-js'
import { requireAuth, PM_ROLES } from '../../../lib/server-auth'

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

  const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const promises = [
    // Sales tasks assigned to this user
    adminSupabase
      .from('sales_order_tasks')
      .select('id, title, due_date, status, priority, order_id, order_number')
      .eq('assignee_id', auth.userId)
      .in('status', ['open', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50),
  ]

  if (isPM) {
    promises.push(
      adminSupabase
        .from('rfis')
        .select('id, title, question, created_at, job_id, jobs(id, job_number, project_name)')
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(25),

      adminSupabase
        .from('billing_submissions')
        .select('id, company_name, amount_billed, submitted_at, job_id, jobs(id, job_number, project_name)')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true })
        .limit(25),

      fullName
        ? adminSupabase
            .from('meeting_action_items')
            .select('id, description, due_date, job_id, jobs(id, job_number, project_name)')
            .eq('status', 'open')
            .ilike('assigned_to', `%${fullName}%`)
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(25)
        : Promise.resolve({ data: [] }),

      adminSupabase
        .from('milestones')
        .select('id, title, due_date, status, job_id, jobs(id, job_number, project_name)')
        .lte('due_date', in14)
        .neq('status', 'complete')
        .order('due_date', { ascending: true })
        .limit(25)
    )
  }

  const results = await Promise.all(promises)
  const salesTasksRes = results[0]

  return Response.json({
    salesTasks:  salesTasksRes.data || [],
    rfis:        isPM ? (results[1]?.data || []) : [],
    billing:     isPM ? (results[2]?.data || []) : [],
    actionItems: isPM ? (results[3]?.data || []) : [],
    milestones:  isPM ? (results[4]?.data || []) : [],
  })
}
