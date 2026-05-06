import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET() {
  try {
    const [{ data: opps, error: oppsErr }, { data: goals }] = await Promise.all([
      adminSupabase.from('bd_opportunities').select('*').order('created_at', { ascending: false }),
      adminSupabase.from('bd_goals').select('*').order('year', { ascending: false })
    ])
    if (oppsErr) return Response.json({ error: oppsErr.message }, { status: 500 })
    return Response.json({ opportunities: opps || [], goals: goals || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { data, error } = await adminSupabase.from('bd_opportunities').insert([{
      project_name: body.project_name,
      client_name: body.client_name || null,
      stage: body.stage || 'prospect',
      bid_amount: body.bid_amount ? parseFloat(body.bid_amount) : null,
      contract_value: body.contract_value ? parseFloat(body.contract_value) : null,
      bid_date: body.bid_date || null,
      trade_type: body.trade_type || null,
      notes: body.notes || null,
    }]).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ opportunity: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json()
    if (body.type === 'goal') {
      const { error } = await adminSupabase.from('bd_goals').upsert(
        { year: body.year, revenue_goal: parseFloat(body.revenue_goal) || 0 },
        { onConflict: 'year' }
      )
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('bd_opportunities').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('bd_opportunities').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
