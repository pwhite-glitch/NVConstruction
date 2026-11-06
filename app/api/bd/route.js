import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isPrincipal } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Business Dev is Owner-only (principal), like the hidden screen.
const OWNER_ONLY = () => Response.json({ error: 'Only Owners can use Business Dev.' }, { status: 403 })

const num = v => (v === '' || v == null ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null))
const str = v => (v == null || v === '' ? null : String(v))

// The only columns callers may write on bd_opportunities.
function bdFields(body, { partial = false } = {}) {
  const out = {}
  const has = k => Object.prototype.hasOwnProperty.call(body, k)
  if (!partial || has('project_name')) out.project_name = str(body.project_name)
  if (!partial || has('client_name')) out.client_name = str(body.client_name)
  if (!partial || has('stage')) out.stage = body.stage || 'prospect'
  if (!partial || has('bid_amount')) out.bid_amount = num(body.bid_amount)
  if (!partial || has('contract_value')) out.contract_value = num(body.contract_value)
  if (!partial || has('bid_date')) out.bid_date = body.bid_date || null
  if (!partial || has('trade_type')) out.trade_type = str(body.trade_type)
  if (!partial || has('notes')) out.notes = str(body.notes)
  return out
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
  try {
    const body = await request.json()
    const row = bdFields(body || {})
    if (!row.project_name) return Response.json({ error: 'project_name required' }, { status: 400 })
    const { data, error } = await adminSupabase.from('bd_opportunities').insert([row]).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ opportunity: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
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
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const fields = bdFields(body, { partial: true })
    if ('project_name' in fields && !fields.project_name) return Response.json({ error: 'project_name cannot be blank' }, { status: 400 })
    if (!Object.keys(fields).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    const { error } = await adminSupabase.from('bd_opportunities').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!isPrincipal(auth.role)) return OWNER_ONLY()
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
