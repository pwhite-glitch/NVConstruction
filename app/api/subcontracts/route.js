import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { canAccessSubcontract, ensureContractAssignment } from '../../../lib/sub-access'
import { logChange } from '../../../lib/change-log'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { changedContractTerms, isSubcontractSigned } from '../../../lib/signing'
import { stampSubcontractSigned } from '../../../lib/generated-contract'
import { sanitizeGeneratorFields } from '../../../lib/subcontract-generator'
import { writeWithMissingColumnRetry, isMissingColumnError, missingColumnName } from '../../../lib/missing-column-retry'
import { sanitizeExhibitList, exhibitFileTypeError, fileBaseName, BILLING_SCHEDULE_CATEGORY } from '../../../lib/subcontract-exhibits'

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

const isDraftStatus = s => s === 'draft'

// Prompt 103: a NEW or CHANGED bid proposal (Exhibit A) must be a PDF or image. Existing
// .doc/.docx records keep saving as long as the path is unchanged.
function bidProposalError(next, prev = null) {
  const p = String(next || '').trim()
  if (!p || p === String(prev || '').trim()) return null
  const err = exhibitFileTypeError(fileBaseName(p))
  return err ? `Bid proposal: ${err}` : null
}

// Prompt 103: extra exhibits (generator_fields.exhibits). Every id must be a job document of
// this subcontract's job (inside "<job_id>/"), not the billing schedule (that is Exhibit B),
// and a PDF / image. Returns { list } or { error }.
async function validateExhibitList(raw, jobId) {
  const list = sanitizeExhibitList(raw)
  if (!list) return { error: 'exhibits must be a list.' }
  if (!list.length) return { list }
  const { data, error } = await adminSupabase.from('job_documents')
    .select('id, job_id, category, storage_path, file_name').in('id', list.map(e => e.job_document_id))
  if (error) return { error: error.message, status: 500 }
  const byId = new Map((data || []).map(r => [String(r.id).toLowerCase(), r]))
  for (const e of list) {
    const row = byId.get(e.job_document_id)
    const name = row ? (row.file_name || fileBaseName(row.storage_path)) : ''
    if (!row || row.job_id !== jobId || !String(row.storage_path || '').toLowerCase().startsWith(String(jobId).toLowerCase() + '/')) {
      return { error: `Exhibit ${name ? `"${name}"` : e.job_document_id} is not a document on this job.` }
    }
    if (row.category === BILLING_SCHEDULE_CATEGORY) return { error: `"${name}" is the billing schedule, which is already Exhibit B.` }
    const typeErr = exhibitFileTypeError(name)
    if (typeErr) return { error: `"${name}": ${typeErr}` }
  }
  return { list }
}

// Current generator_fields ({} when unset or when the column is missing).
async function currentGeneratorFields(id) {
  const { data, error } = await adminSupabase.from('subcontracts').select('generator_fields').eq('id', id).maybeSingle()
  if (error) {
    if (isMissingColumnError(error) || /generator_fields/.test(error.message || '')) return { gf: {} }
    return { error: error.message }
  }
  const gf = data?.generator_fields
  return { gf: gf && typeof gf === 'object' && !Array.isArray(gf) ? gf : {} }
}

// A non-draft contract puts its sub on the job with billing off unless they already billed
// on this job (server-side, so Bid
// Leveling, the Bot API and a failed job-page call are all covered). A failure here
// never undoes the contract save; it comes back as assignment_error.
async function assignForContract(c) {
  let r
  try {
    r = await ensureContractAssignment(adminSupabase, {
      jobId: c.job_id, companyId: c.company_id || null, subId: c.sub_id || null, vendorName: c.vendor_name || null,
    })
  } catch (e) {
    r = { ok: false, error: e?.message || String(e) }
  }
  if (!r.ok) console.error('[subcontracts] job assignment failed', r.error)
  return r.ok ? null : (r.error || 'Could not add the sub to the job.')
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
    const bidErr = bidProposalError(body.bid_proposal_url)
    if (bidErr) return Response.json({ error: bidErr }, { status: 400 })
    const { error, data } = await adminSupabase.from('subcontracts').insert(body).select('id').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (body.job_id && !isDraftStatus(body.status)) {
      const assignment_error = await assignForContract(body)
      if (assignment_error) return Response.json({ ok: true, id: data.id, assignment_error })
    }
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
  // Uploading the signed copy signs the contract: stamp signed_at / status 'signed' (server-set, never from the body).
  const stamp = await stampSubcontractSigned(adminSupabase, id)
  if (stamp.error) return Response.json({ ok: true, warning: 'Signed contract saved, but the signed date could not be recorded: ' + stamp.error })
  return Response.json({ ok: true })
}

// Whether a completed e-sign request exists for this subcontract. Errors count as
// signed so a failed lookup never unlocks a signed contract.
async function hasSignedRequest(subcontractId) {
  const { data, error } = await adminSupabase.from('signing_requests').select('id').eq('subcontract_id', subcontractId).eq('status', 'signed').limit(1)
  return !!error || !!data?.length
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
    // Generator form fields (prompt 96, migration 079): known text keys only, never
    // contract value / numbering / status / signing. Not a contract term, so allowed
    // on signed contracts too.
    if ('generator_fields' in raw) {
      const gf = sanitizeGeneratorFields(raw.generator_fields)
      if (!gf) return Response.json({ error: 'generator_fields must be an object.' }, { status: 400 })
      fields.generator_fields = gf
    }

    if ('exhibits' in raw && !Array.isArray(raw.exhibits)) return Response.json({ error: 'exhibits must be a list.' }, { status: 400 })

    // Fetch current values for auditing changed fields
    const { data: current, error: curErr } = await adminSupabase.from('subcontracts')
      .select('contract_value, description, special_terms, status, signed_at, vendor_name, job_id, company_id, sub_id, signed_contract_url, bid_proposal_url').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Subcontract not found.' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, current?.job_id) ||
      (fields.job_id && fields.job_id !== current?.job_id ? await denyJob(adminSupabase, auth, fields.job_id) : null)
    if (denied) return denied

    if ('bid_proposal_url' in fields) {
      const bidErr = bidProposalError(fields.bid_proposal_url, current.bid_proposal_url)
      if (bidErr) return Response.json({ error: bidErr }, { status: 400 })
    }

    // Prompt 103: extra exhibits live in generator_fields.exhibits. A text-only save keeps the
    // saved list; an exhibits-only save keeps the text fields. Not a contract term (allowed on
    // signed contracts; it doesn't change what was signed).
    if ('exhibits' in raw || 'generator_fields' in fields) {
      const cur = await currentGeneratorFields(id)
      if (cur.error) return Response.json({ error: cur.error }, { status: 500 })
      let exhibits = Array.isArray(cur.gf.exhibits) ? sanitizeExhibitList(cur.gf.exhibits) : undefined
      if ('exhibits' in raw) {
        const v = await validateExhibitList(raw.exhibits, current.job_id)
        if (v.error) return Response.json({ error: v.error }, { status: v.status || 400 })
        exhibits = v.list
      }
      const base = 'generator_fields' in fields ? fields.generator_fields : (() => { const { exhibits: _x, ...rest } = cur.gf; return rest })()
      fields.generator_fields = exhibits !== undefined ? { ...base, exhibits } : base
    }

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
      if (isSubcontractSigned(current) || await hasSignedRequest(id)) {
        return Response.json({ error: 'This subcontract has been signed and can\'t be moved back to draft.' }, { status: 400 })
      }
    }

    // Once signed, the contract terms change only through a change order.
    // Signed = signed_at, status 'signed', a signed PDF on file, or a signed e-sign request.
    const extraSkipped = {}
    const termsChanged = changedContractTerms(current, fields)
    if (termsChanged.length && (isSubcontractSigned(current) || await hasSignedRequest(id))) {
      return Response.json({ error: `This subcontract is signed. ${termsChanged.join(', ').replace(/_/g, ' ')} can only change through a change order.` }, { status: 409 })
    }

    // Before migration 079 there is no generator_fields column: the rest still saves,
    // and a generator-only save is skipped (ok, with generator_fields_skipped).
    const { error, dropped } = await writeWithMissingColumnRetry(
      row => adminSupabase.from('subcontracts').update(row).eq('id', id), fields, { fallbackCols: ['generator_fields'] })
    if (error) {
      const onlyGen = Object.keys(fields).length === 1 && 'generator_fields' in fields
      if (onlyGen && isMissingColumnError(error) && missingColumnName(error) === 'generator_fields') {
        return Response.json({ ok: true, voidedSigningRequests: 0, generator_fields_skipped: true })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }
    if (dropped.includes('generator_fields')) extraSkipped.generator_fields_skipped = true

    // Became non-draft (draft/null → active, …), or a non-draft contract moved job / company / sub:
    // make sure the sub is on the job (billing off unless they already billed on this job;
    // existing rows are never changed).
    const next = { ...current, ...fields }
    const becameLive = (current.status == null || isDraftStatus(current.status)) && next.status != null && !isDraftStatus(next.status)
    const partyMoved = !isDraftStatus(next.status) && ['job_id', 'company_id', 'sub_id'].some(k => k in fields && (fields[k] || null) !== (current[k] || null))
    const assignment_error = next.job_id && (becameLive || partyMoved) ? await assignForContract(next) : null
    const extra = { ...(assignment_error ? { assignment_error } : {}), ...extraSkipped }

    // Terms changed after a signing request went out: that link would sign the old terms.
    let voidedSigningRequests = 0
    if (termsChanged.length) {
      const { data: voided, error: voidErr } = await adminSupabase.from('signing_requests')
        .update({ status: 'voided' }).eq('subcontract_id', id).eq('status', 'pending').select('id')
      if (voidErr) return Response.json({ ok: true, warning: 'Saved, but pending signing links could not be cancelled: ' + voidErr.message, ...extra })
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

    return Response.json({ ok: true, voidedSigningRequests, ...extra })
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
    const { data: sc, error: scErr } = await adminSupabase.from('subcontracts').select('id, job_id, vendor_name, status, signed_at, signed_contract_url').eq('id', id).maybeSingle()
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
