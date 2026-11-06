import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { canAccessSubcontract } from '../../../lib/sub-access'
import { logChange } from '../../../lib/change-log'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { changedContractTerms, isSubcontractSigned } from '../../../lib/signing'

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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const job_id = searchParams.get('job_id')
    const vendor_name = searchParams.get('vendor_name')
    const id = searchParams.get('id')
    if (id) {
      const { data, error } = await adminSupabase.from('subcontracts').select('*').eq('id', id).single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      const denied = await denyJob(adminSupabase, auth, data?.job_id)
      if (denied) return denied
      return Response.json({ row: data })
    }
    if (job_id) {
      const denied = await denyJob(adminSupabase, auth, job_id)
      if (denied) return denied
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = pick(await request.json())
    const denied = await denyJob(adminSupabase, auth, body.job_id)
    if (denied) return denied
    const { error, data } = await adminSupabase.from('subcontracts').insert(body).select('id').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Sub portal "upload signed contract": a sub may set signed_contract_url, and
// nothing else, on a contract they can access. The path must be the one their
// upload URL was issued for (contracts/<id>/...).
async function subUploadSignedContract(auth, raw) {
  const { id, signed_contract_url } = raw
  const otherFields = Object.keys(pick(raw)).filter(k => k !== 'signed_contract_url')
  if (!id || !signed_contract_url || otherFields.length) {
    return Response.json({ error: 'Subs can only attach a signed contract' }, { status: 403 })
  }
  if (!String(signed_contract_url).startsWith(`contracts/${id}/`) || String(signed_contract_url).includes('..')) {
    return Response.json({ error: 'Invalid document path' }, { status: 400 })
  }
  if (!(await canAccessSubcontract(auth, id))) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { error } = await adminSupabase.from('subcontracts').update({ signed_contract_url }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function PUT(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  try {
    const raw = await request.json()
    if (isSub(auth.role)) return await subUploadSignedContract(auth, raw)
    if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = raw
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const fields = pick(raw)

    // Fetch current values for auditing changed fields
    const { data: current, error: curErr } = await adminSupabase.from('subcontracts')
      .select('contract_value, description, special_terms, status, signed_at, vendor_name, job_id, signed_contract_url').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Subcontract not found.' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, current?.job_id) ||
      (fields.job_id && fields.job_id !== current?.job_id ? await denyJob(adminSupabase, auth, fields.job_id) : null)
    if (denied) return denied

    // Draft → active is the "Activate" step; stamp who did it and when
    if (fields.status === 'active' && current?.status === 'draft') {
      fields.activated_at = new Date().toISOString()
      fields.activated_by = auth.userId
    }

    // Active → draft ("Move back to draft") is only allowed while the contract is unsigned
    if (fields.status === 'draft' && current && current.status !== 'draft') {
      if (current.status && current.status !== 'active') {
        return Response.json({ error: `Only active subcontracts can be moved back to draft (this one is "${current.status}").` }, { status: 400 })
      }
      const { data: signedReq } = await adminSupabase.from('signing_requests').select('id').eq('subcontract_id', id).eq('status', 'signed').limit(1)
      if (current.signed_contract_url || signedReq?.length) {
        return Response.json({ error: 'This subcontract has been signed and can\'t be moved back to draft.' }, { status: 400 })
      }
    }

    // Once signed, the contract terms change only through a change order.
    const termsChanged = changedContractTerms(current, fields)
    if (termsChanged.length && isSubcontractSigned(current)) {
      return Response.json({ error: `This subcontract is signed. ${termsChanged.join(', ').replace(/_/g, ' ')} can only change through a change order.` }, { status: 409 })
    }

    const { error } = await adminSupabase.from('subcontracts').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Terms changed after a signing request went out: that link would sign the old terms.
    let voidedSigningRequests = 0
    if (termsChanged.length) {
      const { data: voided, error: voidErr } = await adminSupabase.from('signing_requests')
        .update({ status: 'voided' }).eq('subcontract_id', id).eq('status', 'pending').select('id')
      if (voidErr) return Response.json({ ok: true, warning: 'Saved, but pending signing links could not be cancelled: ' + voidErr.message })
      voidedSigningRequests = voided?.length || 0
    }

    if (current) {
      const fmtAmt = v => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
      if ('contract_value' in fields && String(fields.contract_value) !== String(current.contract_value)) {
        logChange({ job_id: current.job_id, entity_type: 'subcontract', entity_id: id, field_name: 'contract_value', old_value: fmtAmt(current.contract_value), new_value: fmtAmt(fields.contract_value), changed_by: auth.userId, note: `Contract value updated — ${current.vendor_name || ''}` })
      }
      if ('status' in fields && fields.status !== current.status) {
        logChange({ job_id: current.job_id, entity_type: 'subcontract', entity_id: id, field_name: 'status', old_value: current.status, new_value: fields.status, changed_by: auth.userId, note: `Subcontract status changed to "${fields.status}" — ${current.vendor_name || ''}` })
      }
    }

    return Response.json({ ok: true, voidedSigningRequests })
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
    const denied = await denyJobOf(adminSupabase, auth, 'subcontracts', id)
    if (denied) return denied
    const { data: sc, error: scErr } = await adminSupabase.from('subcontracts').select('id, job_id, vendor_name, status, signed_at').eq('id', id).maybeSingle()
    if (scErr) return Response.json({ error: scErr.message }, { status: 500 })
    if (!sc) return Response.json({ error: 'Subcontract not found.' }, { status: 404 })
    if (isSubcontractSigned(sc)) return Response.json({ error: 'This subcontract is signed and can’t be deleted.' }, { status: 409 })
    // Anything billed or ordered against it keeps it.
    const [sov, cos, pos, signed] = await Promise.all([
      adminSupabase.from('subcontract_sov_lines').select('id').eq('subcontract_id', id),
      adminSupabase.from('change_orders').select('id', { count: 'exact', head: true }).eq('subcontract_id', id),
      // purchase_orders has no subcontract_id: same job + same vendor name counts
      sc.vendor_name?.trim()
        ? adminSupabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('job_id', sc.job_id).ilike('vendor_name', sc.vendor_name.trim().replace(/[\\%_]/g, c => '\\' + c))
        : Promise.resolve({ count: 0, error: null }),
      adminSupabase.from('signing_requests').select('id', { count: 'exact', head: true }).eq('subcontract_id', id).eq('status', 'signed'),
    ])
    for (const r of [sov, cos, pos, signed]) if (r.error) return Response.json({ error: 'Could not check what is attached: ' + r.error.message }, { status: 500 })
    if (signed.count) return Response.json({ error: 'This subcontract has a signed e-signature and can’t be deleted.' }, { status: 409 })
    const sovIds = (sov.data || []).map(l => l.id)
    let billings = 0
    if (sovIds.length) {
      const { count, error: bErr } = await adminSupabase.from('billing_sov_lines').select('id', { count: 'exact', head: true }).in('sov_line_id', sovIds)
      if (bErr) return Response.json({ error: 'Could not check billings: ' + bErr.message }, { status: 500 })
      billings = count || 0
    }
    const attached = [
      billings && `${billings} billing line${billings === 1 ? '' : 's'}`,
      cos.count && `${cos.count} change order${cos.count === 1 ? '' : 's'}`,
      pos.count && `${pos.count} purchase order${pos.count === 1 ? '' : 's'}`,
    ].filter(Boolean)
    if (attached.length) return Response.json({ error: `Can’t delete: this subcontract has ${attached.join(', ')}.` }, { status: 409 })
    const { error } = await adminSupabase.from('subcontracts').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
