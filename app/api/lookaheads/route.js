import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('job_id')
    const weekStart = searchParams.get('week_start')
    let query = adminSupabase
      .from('lookaheads')
      .select('*, lookahead_activities(*)')
      .order('week_start_date', { ascending: false })
    if (jobId) query = query.eq('job_id', jobId)
    if (weekStart) query = query.eq('week_start_date', weekStart)
    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { job_id, week_start_date, submitted_by, notes } = await request.json()
    if (!job_id || !week_start_date) return Response.json({ error: 'job_id and week_start_date required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('lookaheads')
      .insert({ job_id, week_start_date, submitted_by: submitted_by || null, notes: notes || null, status: 'draft' })
      .select('*, lookahead_activities(*)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const body = await request.json()
    const { id, status, notes } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const updates = {}
    if (notes !== undefined) updates.notes = notes
    if (status === 'submitted') {
      updates.status = 'submitted'
      updates.submitted_at = new Date().toISOString()
    } else if (status === 'draft') {
      updates.status = 'draft'
    }
    const { data, error } = await adminSupabase
      .from('lookaheads')
      .update(updates)
      .eq('id', id)
      .select('*, jobs(job_number, project_name, pm_email), lookahead_activities(*)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (status === 'submitted' && data?.jobs?.pm_email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const d = new Date(data.week_start_date + 'T12:00:00Z')
        const weekStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        await resend.emails.send({
          from: 'NV Construction <noreply@nvim.co>',
          to: data.jobs.pm_email,
          subject: `2-Week Lookahead Submitted — ${data.jobs.project_name}`,
          html: `<p>A 2-week lookahead has been submitted for <strong>${data.jobs.project_name}</strong> (Job #${data.jobs.job_number}) for the week of <strong>${weekStr}</strong>.</p><p>Log in to review it.</p>`,
        })
      } catch {}
    }
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
