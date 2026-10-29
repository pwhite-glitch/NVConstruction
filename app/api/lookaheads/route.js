import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'
import { escapeHtml } from '../../../lib/email'
import { writeWithFallback, droppedWarning } from '../../../lib/lookahead-fields'
import { addDays, planCopyForward } from '../../../lib/lookahead-dates'
import { jobPmUserIds } from '../../../lib/lookahead-recipients'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OFFICE_ROLES = new Set(['pm', 'apm', 'admin'])

async function userName(userId) {
  const { data } = await adminSupabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name || null
}

// GET ?job_id&week_start — lookaheads with their activities.
// ?status=submitted&summary=1 — no activities, with the job (dashboard Lookahead tab).
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('job_id')
    const weekStart = searchParams.get('week_start')
    const status = searchParams.get('status')
    const summary = searchParams.get('summary')
    let query = adminSupabase
      .from('lookaheads')
      .select(summary ? '*, jobs(id, job_number, project_name, status)' : '*, lookahead_activities(*)')
      .order('week_start_date', { ascending: false })
    if (jobId) query = query.eq('job_id', jobId)
    if (weekStart) query = query.eq('week_start_date', weekStart)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST { job_id, week_start_date } creates a draft.
// POST { action: 'copy_forward', job_id, week_start_date } creates it if needed and
// copies last week's unfinished activities in (see planCopyForward).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { action, job_id, week_start_date, submitted_by, notes } = await request.json()
    if (!job_id || !week_start_date) return Response.json({ error: 'job_id and week_start_date required' }, { status: 400 })
    const create = () => adminSupabase
      .from('lookaheads')
      .insert({ job_id, week_start_date, submitted_by: submitted_by || null, notes: notes || null, status: 'draft' })
      .select('*, lookahead_activities(*)')
      .single()

    if (action !== 'copy_forward') {
      const { data, error } = await create()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ data })
    }

    // First match, like the job page and field app (a week may have a duplicate row)
    const find = async week => {
      const { data, error } = await adminSupabase.from('lookaheads').select('*, lookahead_activities(*)').eq('job_id', job_id).eq('week_start_date', week).limit(1)
      return { data: data?.[0] || null, error }
    }
    const { data: prev } = await find(addDays(week_start_date, -7))
    let { data: current, error } = await find(week_start_date)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = planCopyForward(prev?.lookahead_activities || [], current?.lookahead_activities || [], week_start_date)
    if (!prev) return Response.json({ error: 'There is no lookahead for last week to copy from.' }, { status: 404 })
    if (!current) {
      ({ data: current, error } = await create())
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    let warning
    if (rows.length) {
      const insertRows = rows.map(r => ({ ...r, lookahead_id: current.id }))
      const { error: insErr, dropped } = await writeWithFallback(
        r => adminSupabase.from('lookahead_activities').insert(r).select('id'), insertRows)
      if (insErr) return Response.json({ error: insErr.message }, { status: 500 })
      warning = droppedWarning(dropped, insertRows, 'Activities copied')
    }
    const { data } = await find(week_start_date)
    return Response.json({ data, added: rows.length, warning })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT { id, status?, notes? }. submitted: super taps Submit to PM (email + in-portal
// notification to the job's PMs). approved: PM marks it reviewed (office roles only).
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { id, status, notes } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const updates = {}
    if (notes !== undefined) updates.notes = notes
    const now = new Date().toISOString()
    if (status === 'submitted') {
      Object.assign(updates, { status: 'submitted', submitted_at: now, submitted_by: auth.userId, submitted_by_name: await userName(auth.userId) })
    } else if (status === 'approved') {
      if (!OFFICE_ROLES.has(auth.role)) return Response.json({ error: 'Only the PM can approve a lookahead.' }, { status: 403 })
      Object.assign(updates, { status: 'approved', approved_at: now, approved_by: auth.userId, approved_by_name: await userName(auth.userId) })
    } else if (status === 'draft') {
      updates.status = 'draft'
    }
    const { data, error, dropped } = await writeWithFallback(row => adminSupabase
      .from('lookaheads')
      .update(row)
      .eq('id', id)
      .select('*, jobs(id, job_number, project_name, pm_email), lookahead_activities(*)')
      .single(), updates)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const warning = dropped.length ? 'Saved, but who did this step was not recorded (migration 035 not applied yet).' : undefined

    if (status === 'submitted' && data?.jobs) {
      const weekStr = new Date(data.week_start_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      const link = `/jobdetail?id=${data.job_id}&tab=lookahead&week=${data.week_start_date}`
      const pmIds = await jobPmUserIds(data.jobs, auth.userId)
      await Promise.all(pmIds.map(recipient_id => notify({
        recipient_id,
        type: 'lookahead_submitted',
        title: `Lookahead submitted: ${data.jobs.project_name}`,
        body: `${updates.submitted_by_name || 'The superintendent'} submitted the 2-week lookahead for the week of ${weekStr} (${(data.lookahead_activities || []).length} activities). Review it and send it to subs.`,
        link,
        job_id: data.job_id,
        entity_type: 'lookahead',
        entity_id: data.id,
        dedup_key: `lookahead:submitted:${data.id}`,
      })))
      if (data.jobs.pm_email) await sendSubmittedEmail(data, weekStr)
    }
    return Response.json({ data, warning })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function sendSubmittedEmail(data, weekStr) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)

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
          return `<li><strong>${escapeHtml(eqMap[eid] || 'Unknown')}</strong> — ${dateStr}: ${escapeHtml(a.description)}</li>`
        }))
      eqHtml = `<p style="margin-top:16px"><strong style="color:#f59e0b">⚠ Company Equipment Required:</strong></p><ul style="margin:8px 0;padding-left:20px">${lines.join('')}</ul>`
    }

    await resend.emails.send({
      from: 'NV Construction <noreply@nvim.co>',
      to: data.jobs.pm_email,
      subject: `2-Week Lookahead Submitted — ${data.jobs.project_name}`,
      html: `<p>A 2-week lookahead has been submitted for <strong>${escapeHtml(data.jobs.project_name)}</strong> (Job #${escapeHtml(data.jobs.job_number)}) for the week of <strong>${weekStr}</strong>.</p>${eqHtml}<p style="margin-top:16px">Log in to review the full lookahead.</p>`,
    })
  } catch {}
}
