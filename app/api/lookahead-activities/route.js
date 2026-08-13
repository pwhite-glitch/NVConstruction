import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED = new Set([
  'lookahead_id', 'planned_date', 'description', 'location',
  'responsible_type', 'sub_id', 'manpower', 'equipment',
  'materials_status', 'inspection_required', 'inspection_scheduled',
  'preceding_work_complete', 'committed', 'constraints_notes',
  'company_equipment_ids',
])

function pick(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => ALLOWED.has(k)))
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const subUserId = searchParams.get('sub_user_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!subUserId) return Response.json({ error: 'sub_user_id required' }, { status: 400 })
    const { data: contracts } = await adminSupabase
      .from('subcontracts')
      .select('id')
      .eq('sub_id', subUserId)
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
  try {
    const body = pick(await request.json())
    if (!body.lookahead_id || !body.description || !body.planned_date)
      return Response.json({ error: 'lookahead_id, description, planned_date required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('lookahead_activities')
      .insert(body)
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const raw = await request.json()
    const { id } = raw
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('lookahead_activities')
      .update(pick(raw))
      .eq('id', id)
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
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
