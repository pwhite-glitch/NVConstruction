import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, isJobLimited, accessibleJobIds } from '../../../lib/roles'
import { notify } from '../../../lib/notify'
import { escapeHtml } from '../../../lib/email'
import { writeWithFallback, droppedWarning, missingColumn, lookaheadTransitionError, activityLockError, LOOKAHEAD_OFFICE_ROLES, RETURN_COLS } from '../../../lib/lookahead-fields'
import { addDays, mondayOf, planCopyForward } from '../../../lib/lookahead-dates'
import { jobPmUserIds } from '../../../lib/lookahead-recipients'
import { loadJobForecast, lookaheadWeatherFlags, weatherWarningHtml } from '../../../lib/lookahead-forecast'
import { siteUrl } from '../../../lib/site-url'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OFFICE_ROLES = LOOKAHEAD_OFFICE_ROLES
const RETURN_MIGRATION = 'Send back needs database migration 045 (return note columns), which is not applied yet. Nothing was changed.'
const fieldLink = la => `/field?job=${la.job_id}&tab=lookahead&week=${la.week_start_date}`
const weekLabel = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Lookaheads always start on a Monday; snap any other 'YYYY-MM-DD' to its week's
// Monday. Anything else is returned as-is.
const weekStartOf = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? mondayOf(s) : s)

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
    const weekStart = weekStartOf(searchParams.get('week_start'))
    const status = searchParams.get('status')
    const summary = searchParams.get('summary')
    let query = adminSupabase
      .from('lookaheads')
      .select(summary ? '*, jobs(id, job_number, project_name, status)' : '*, lookahead_activities(*)')
      .order('week_start_date', { ascending: false })
    if (jobId) {
      const denied = await denyJob(adminSupabase, auth, jobId)
      if (denied) return denied
      query = query.eq('job_id', jobId)
    } else if (isJobLimited(auth.role)) {
      const { ids, error: accErr } = await accessibleJobIds(adminSupabase, auth)
      if (accErr) return Response.json({ error: accErr.message }, { status: 500 })
      if (!ids.size) return Response.json({ data: [] })
      query = query.in('job_id', [...ids])
    }
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
    // submitted_by from the body is ignored: a new lookahead is a draft with no submitter yet.
    const { action, job_id, week_start_date: rawWeek, notes } = await request.json()
    const week_start_date = weekStartOf(rawWeek)
    if (!job_id || !week_start_date) return Response.json({ error: 'job_id and week_start_date required' }, { status: 400 })
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const create = () => adminSupabase
      .from('lookaheads')
      .insert({ job_id, week_start_date, notes: notes || null, status: 'draft' })
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
      const locked = activityLockError(current, auth.role, null)
      if (locked) return Response.json({ error: locked.error }, { status: locked.status })
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

// PUT { id, status?, notes? } and PUT { id, action: 'return', note }.
//   status 'submitted' — submit (from draft only; a returned lookahead is a draft). Each
//     submission gets its own submitted_at, used in the notification dedup key.
//   status 'approved'  — office review roles only, from submitted only.
//   action 'return'    — "Send back": office only, from submitted / approved, note required.
//     Goes back to draft with the note (PROPOSED columns, migration 045), approval and send
//     flags cleared, and a bell notice to the original submitter.
//   status 'draft'     — only a no-op on a draft; reviewed lookahead must use Send back.
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { id, status, notes, action, note } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'lookaheads', id)
    if (denied) return denied
    const { data: current, error: curErr } = await adminSupabase.from('lookaheads').select('*').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Lookahead not found.' }, { status: 404 })

    const act = action === 'return' ? 'return'
      : status === 'submitted' ? 'submit'
      : status === 'approved' ? 'approve'
      : status === 'draft' ? 'draft'
      : status !== undefined || action !== undefined ? 'unknown' : null
    if (act) {
      const bad = lookaheadTransitionError(current, act, auth.role, { note })
      if (bad) return Response.json({ error: bad.error }, { status: bad.status })
    }
    const updates = {}
    if (notes !== undefined) {
      if (!OFFICE_ROLES.has(auth.role) && (current.status || 'draft') !== 'draft') {
        return Response.json({ error: 'Notes are locked after the lookahead is submitted.' }, { status: 409 })
      }
      updates.notes = notes
    }
    const now = new Date().toISOString()
    const clearReview = { approved_at: null, approved_by: null, approved_by_name: null, sent_to_subs_at: null, sent_to_subs_by: null, sent_to_subs_by_name: null, sent_to_subs_recipients: null }
    if (act === 'submit') {
      Object.assign(updates, { status: 'submitted', submitted_at: now, submitted_by: auth.userId, submitted_by_name: await userName(auth.userId) }, clearReview)
    } else if (act === 'approve') {
      // The submitter (submitted_by / submitted_by_name) is never replaced by the reviewer.
      Object.assign(updates, { status: 'approved', approved_at: now, approved_by: auth.userId, approved_by_name: await userName(auth.userId) })
    } else if (act === 'return') {
      Object.assign(updates, clearReview, { status: 'draft', returned_at: now, returned_by: auth.userId, returned_by_name: await userName(auth.userId), return_note: String(note).trim() })
    }
    if (!Object.keys(updates).length) return Response.json({ data: current })

    // Only from the stage we checked (two people clicking at once can't both win).
    const { data, error, dropped } = await writeWithFallback(row => {
      let q = adminSupabase.from('lookaheads').update(row).eq('id', id)
      q = current.status ? q.eq('status', current.status) : q.is('status', null)
      return q.select('*, jobs(id, job_number, project_name, pm_email), lookahead_activities(*)').single()
    }, updates)
    if (error) {
      if (act === 'return' && RETURN_COLS.includes(missingColumn(error.message))) {
        return Response.json({ error: RETURN_MIGRATION, migration_required: '045' }, { status: 503 })
      }
      if (error.code === 'PGRST116') return Response.json({ error: 'This lookahead was changed by someone else. Refresh and try again.' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    const lost = dropped.filter(c => !(c in clearReview && updates[c] === null))
    const warning = lost.length ? `Saved, but ${lost.join(', ')} was not recorded (migration ${lost.includes('approved_at') ? '045' : '035'} not applied yet).` : undefined

    if (act === 'submit' && data?.jobs) {
      const weekStr = weekLabel(data.week_start_date)
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
        // One key per submission, so a resubmit notifies again even if the last one is unread
        dedup_key: `lookahead:submitted:${data.id}:${now}`,
      })))
      if (data.jobs.pm_email) await sendSubmittedEmail(data, weekStr)
    }
    if ((act === 'approve' || act === 'return') && current.submitted_by && current.submitted_by !== auth.userId) {
      const weekStr = weekLabel(current.week_start_date)
      const proj = data?.jobs?.project_name || 'your job'
      await notify({
        recipient_id: current.submitted_by,
        type: act === 'approve' ? 'lookahead_approved' : 'lookahead_returned',
        title: act === 'approve' ? `Lookahead approved: ${proj}` : `Lookahead sent back: ${proj}`,
        body: act === 'approve'
          ? `${updates.approved_by_name || 'The PM'} approved the lookahead for the week of ${weekStr}.`
          : `${updates.returned_by_name || 'The PM'} sent back the lookahead for the week of ${weekStr}: ${updates.return_note}`,
        link: fieldLink(current),
        job_id: current.job_id,
        entity_type: 'lookahead',
        entity_id: current.id,
        dedup_key: `lookahead:${act === 'approve' ? 'approved' : 'returned'}:${current.id}:${now}`,
      })
      // Send back needs action from the super: email too (the bell alone is easy to miss).
      if (act === 'return') await sendReturnedEmail(current, proj, weekStr, updates)
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

    // Rain / freeze warnings on the submitted activities (best effort; no forecast → no block).
    let wxHtml = ''
    try {
      const { days } = await loadJobForecast(adminSupabase, data.job_id)
      wxHtml = weatherWarningHtml(lookaheadWeatherFlags(data.lookahead_activities || [], data.week_start_date, days))
    } catch {}

    await resend.emails.send({
      from: 'NV Construction <noreply@nvim.co>',
      to: data.jobs.pm_email,
      subject: `2-Week Lookahead Submitted — ${data.jobs.project_name}`,
      html: `<p>A 2-week lookahead has been submitted for <strong>${escapeHtml(data.jobs.project_name)}</strong> (Job #${escapeHtml(data.jobs.job_number)}) for the week of <strong>${weekStr}</strong>.</p>${wxHtml}${eqHtml}<p style="margin-top:16px">Log in to review the full lookahead.</p>`,
    })
  } catch {}
}

// "Lookahead sent back" email to the super who submitted it. Never throws.
async function sendReturnedEmail(la, proj, weekStr, updates) {
  try {
    const { data } = await adminSupabase.auth.admin.getUserById(la.submitted_by)
    const to = data?.user?.email
    if (!to) return
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'NV Construction <noreply@nvim.co>',
      to,
      subject: `Lookahead sent back — ${proj}`,
      html: `<p>${escapeHtml(updates.returned_by_name || 'The PM')} sent back your 2-week lookahead for <strong>${escapeHtml(proj)}</strong> (week of <strong>${escapeHtml(weekStr)}</strong>).</p><p><strong>Note:</strong> ${escapeHtml(updates.return_note)}</p><p><a href="${siteUrl(fieldLink(la))}">Open the lookahead</a> to make the changes and resubmit.</p>`,
    })
  } catch {}
}
