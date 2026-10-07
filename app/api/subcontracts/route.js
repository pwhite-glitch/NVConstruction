import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { logChange } from '../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_COLUMNS = new Set([
  'job_id','sub_id','company_id','vendor_name','description','contract_value',
  'budget_item_id','budget_allocations','retainage_pct','status','onedrive_url',
  'bid_proposal_url','signed_contract_url','created_by','start_date','special_terms',
])

function pick(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => ALLOWED_COLUMNS.has(k)))
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const job_id = searchParams.get('job_id')
    const vendor_name = searchParams.get('vendor_name')
    const id = searchParams.get('id')
    if (id) {
      const { data, error } = await adminSupabase.from('subcontracts').select('*').eq('id', id).single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ row: data })
    }
    if (job_id) {
      let q = adminSupabase.from('subcontracts').select('*').eq('job_id', job_id)
      if (vendor_name) q = q.ilike('vendor_name', vendor_name)
      const { data, error } = await q
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ rows: data || [], row: data?.[0] || null })
    }
    return Response.json({ error: 'job_id or id required' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const raw = await request.json()
    const { id } = raw
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const fields = pick(raw)

    // Fetch current values for auditing changed fields
    const { data: current } = await adminSupabase.from('subcontracts').select('contract_value, status, vendor_name, job_id').eq('id', id).single()

    const { error } = await adminSupabase.from('subcontracts').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (current) {
      const fmtAmt = v => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
      if ('contract_value' in fields && String(fields.contract_value) !== String(current.contract_value)) {
        logChange({ job_id: current.job_id, entity_type: 'subcontract', entity_id: id, field_name: 'contract_value', old_value: fmtAmt(current.contract_value), new_value: fmtAmt(fields.contract_value), changed_by: auth.userId, note: `Contract value updated — ${current.vendor_name || ''}` })
      }
      if ('status' in fields && fields.status !== current.status) {
        logChange({ job_id: current.job_id, entity_type: 'subcontract', entity_id: id, field_name: 'status', old_value: current.status, new_value: fields.status, changed_by: auth.userId, note: `Subcontract status changed to "${fields.status}" — ${current.vendor_name || ''}` })
      }
    }

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
