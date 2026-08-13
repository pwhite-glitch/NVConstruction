import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_COLUMNS = new Set([
  'job_id','sub_id','company_id','vendor_name','description','contract_value',
  'budget_item_id','budget_allocations','retainage_pct','status','onedrive_url',
  'bid_proposal_url','signed_contract_url','created_by',
])

function pick(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => ALLOWED_COLUMNS.has(k)))
}

export async function POST(request) {
  try {
    const body = pick(await request.json())
    const { error, data } = await adminSupabase.from('subcontracts').insert(body).select('id').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const raw = await request.json()
    const { id } = raw
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const fields = pick(raw)
    const { error } = await adminSupabase.from('subcontracts').update(fields).eq('id', id)
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
    const { error } = await adminSupabase.from('subcontracts').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
