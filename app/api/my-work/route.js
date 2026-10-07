import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  const { data: prof } = await adminSupabase
    .from('profiles')
    .select('full_name')
    .eq('id', auth.userId)
    .single()
  const fullName = prof?.full_name || null

  const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [rfisRes, billingRes, actionRes, milestoneRes] = await Promise.all([
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
      .limit(25),
  ])

  return Response.json({
    rfis:        rfisRes.data      || [],
    billing:     billingRes.data   || [],
    actionItems: actionRes.data    || [],
    milestones:  milestoneRes.data || [],
  })
}
