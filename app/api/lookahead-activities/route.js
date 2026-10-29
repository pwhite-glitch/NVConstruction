import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'
import { cleanActivity, validateActivity, writeWithFallback, droppedWarning, missingColumn } from '../../../lib/lookahead-fields'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?from&to — activities on the caller's subcontracts (sub portal Upcoming Work).
// Office staff may pass ?sub_user_id to look at one sub user's contracts.
// A multi-day activity is included when any part of it falls in from..to.
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    let contracts
    if (isSub(auth.role)) {
      contracts = await getSubContracts(auth)
    } else if (isPM(auth.role)) {
      const subUserId = searchParams.get('sub_user_id')
      if (!subUserId) return Response.json({ error: 'sub_user_id required' }, { status: 400 })
      contracts = (await adminSupabase.from('subcontracts').select('id').eq('sub_id', subUserId)).data
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!contracts || contracts.length === 0) return Response.json({ data: [] })
    const contractIds = contracts.map(c => c.id)
    const run = withEndDate => {
      let query = adminSupabase
        .from('lookahead_activities')
        .select('*, lookaheads(week_start_date, jobs(job_number, project_name))')
        .in('sub_id', contractIds)
        .order('planned_date', { ascending: true })
      // end_date >= from, where a one-day activity's end is planned_date
      if (from) query = withEndDate ? query.or(`end_date.gte.${from},planned_date.gte.${from}`) : query.gte('planned_date', from)
      if (to) query = query.lte('planned_date', to)
      return query
    }
    let { data, error } = await run(true)
    if (missingColumn(error?.message) === 'end_date') ({ data, error } = await run(false)) // before migration 035
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = cleanActivity(await request.json())
    if (!body.lookahead_id) return Response.json({ error: 'lookahead_id required' }, { status: 400 })
    const problem = validateActivity(body)
    if (problem) return Response.json({ error: problem }, { status: 400 })
    const { data, error, dropped } = await writeWithFallback(
      row => adminSupabase.from('lookahead_activities').insert(row).select('*').single(), body)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data, warning: droppedWarning(dropped, body) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const raw = await request.json()
    const { id } = raw
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const fields = cleanActivity(raw)
    delete fields.lookahead_id
    // An end date sent without a start is checked against the stored start
    if (fields.end_date && !('planned_date' in fields)) {
      const { data: cur } = await adminSupabase.from('lookahead_activities').select('planned_date').eq('id', id).maybeSingle()
      if (cur && fields.end_date < cur.planned_date) return Response.json({ error: 'End date can\'t be before the start date.' }, { status: 400 })
    }
    const problem = validateActivity(fields, { partial: true })
    if (problem) return Response.json({ error: problem }, { status: 400 })
    const { data, error, dropped } = await writeWithFallback(
      row => adminSupabase.from('lookahead_activities').update(row).eq('id', id).select('*').single(), fields)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data, warning: droppedWarning(dropped, fields) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('lookahead_activities').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
