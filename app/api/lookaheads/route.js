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
    } else if (status === 'approved') {
      updates.status = 'approved'
      updates.approved_at = new Date().toISOString()
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

        // Build equipment section if any activities need company equipment
        let eqHtml = ''
        const activitiesWithEq = (data.lookahead_activities || []).filter(a => a.company_equipment_ids?.length > 0)
        if (activitiesWithEq.length > 0) {
          const allIds = [...new Set(activitiesWithEq.flatMap(a => a.company_equipment_ids))]
          const { data: eqRows } = await adminSupabase.from('company_equipment').select('id, name').in('id', allIds)
          const eqMap = Object.fromEntries((eqRows || []).map(e => [e.id, e.name]))
          const lines = activitiesWithEq
            .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
            .flatMap(a => (a.company_equipment_ids || []).map(eid => {
              const dateStr = new Date(a.planned_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
              return `<li><strong>${eqMap[eid] || 'Unknown'}</strong> — ${dateStr}: ${a.description}</li>`
            }))
          eqHtml = `<p style="margin-top:16px"><strong style="color:#f59e0b">⚠ Company Equipment Required:</strong></p><ul style="margin:8px 0;padding-left:20px">${lines.join('')}</ul>`
        }

        await resend.emails.send({
          from: 'NV Construction <noreply@nvim.co>',
          to: data.jobs.pm_email,
          subject: `2-Week Lookahead Submitted — ${data.jobs.project_name}`,
          html: `<p>A 2-week lookahead has been submitted for <strong>${data.jobs.project_name}</strong> (Job #${data.jobs.job_number}) for the week of <strong>${weekStr}</strong>.</p>${eqHtml}<p style="margin-top:16px">Log in to review the full lookahead.</p>`,
        })
      } catch {}
    }
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
