import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'
import { cleanActivity, withoutNew033 } from '../../../lib/lookahead-fields'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?from&to — activities on the caller's subcontracts (sub portal Upcoming Work).
// Office staff may pass ?sub_user_id to look at one sub user's contracts.
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
    let query = adminSupabase
      .from('lookahead_activities')
      .select('*, lookaheads(week_start_date, jobs(job_number, project_name))')
      .in('sub_id', contractIds)
      .order('planned_date', { ascending: true })
    if (from) query = query.gte('planned_date', from)
    if (to) query = query.lte('planned_date', to)
    const { data, error } = await query
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
    if (!body.lookahead_id || !body.description || !body.planned_date)
      return Response.json({ error: 'lookahead_id, description, planned_date required' }, { status: 400 })
    const insert = row => adminSupabase.from('lookahead_activities').insert(row).select('*').single()
    let { data, error } = await insert(body)
    let warning
    if (error?.message?.includes('schema cache')) {
      ({ data, error } = await insert(withoutNew033(body)))
      if (!error && body.constraints) warning = 'Activity saved, but Constraints were not saved (migration 033 not applied yet).'
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data, warning })
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
    const update = row => adminSupabase.from('lookahead_activities').update(row).eq('id', id).select('*').single()
    let { data, error } = await update(fields)
    let warning
    if (error?.message?.includes('schema cache')) {
      ({ data, error } = await update(withoutNew033(fields)))
      if (!error && fields.constraints) warning = 'Activity saved, but Constraints were not saved (migration 033 not applied yet).'
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data, warning })
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
