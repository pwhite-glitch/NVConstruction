import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { CONTRACT_BUCKET, isUuid, recordGeneratedContract, latestGeneratedContractPath } from '../../../lib/generated-contract'
import { rejectMultipart, verifyAttachment, attachmentErrorResponse, privateJson } from '../../../lib/file-upload-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Save a copy of a contract generated from the job page ("Edit & Print Contract").
// The browser uploads the generated HTML straight to Storage (POST /api/file-upload, target
// generated-contract → documents/subcontracts/<id>/generated-…html) and sends
// { subcontract_id, attachment: { path, uploadReceipt } }. The HTML itself never passes through
// this function. Recording keeps the recorded:false fallback (migration 031 not applied).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(request)
  if (multipart) return multipart
  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const { subcontract_id, attachment } = body || {}
    if (body && 'html' in body) return Response.json({ error: 'Send the contract with a direct upload, not inline HTML.', code: 'direct_upload_required' }, { status: 413 })
    if (!isUuid(subcontract_id) || !attachment) return Response.json({ error: 'subcontract_id and attachment required' }, { status: 400 })
    const { data: sc, error: scErr } = await adminSupabase.from('subcontracts').select('id, job_id').eq('id', subcontract_id).maybeSingle()
    if (scErr) return Response.json({ error: scErr.message }, { status: 500 })
    if (!sc) return Response.json({ error: 'Subcontract not found' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, sc.job_id)
    if (denied) return denied
    const v = await verifyAttachment(adminSupabase, attachment, { target: 'generated-contract', subject: auth.userId, ctx: { job: sc.job_id, rec: sc.id } })
    if (!v.ok) return attachmentErrorResponse(v)
    const saved = await recordGeneratedContract(adminSupabase, { subcontractId: sc.id, path: v.path, userId: auth.userId })
    return Response.json({ data: saved })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// A short-lived signed link to a stored contract's HTML, so the page fetches the document
// straight from Storage (no document body buffered through this function).
// kind=generated: last generated copy. kind=signed: the e-signed copy in signed_contract_url.
// Only the path stored on THIS subcontract (or its newest generated file) is ever signed.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const subcontract_id = searchParams.get('subcontract_id')
  const kind = searchParams.get('kind') || 'generated'
  if (!isUuid(subcontract_id)) return Response.json({ error: 'subcontract_id required' }, { status: 400 })
  const denied = await denyJobOf(adminSupabase, auth, 'subcontracts', subcontract_id)
  if (denied) return denied

  let path = null
  if (kind === 'signed') {
    const { data } = await adminSupabase.from('subcontracts').select('signed_contract_url').eq('id', subcontract_id).maybeSingle()
    path = data?.signed_contract_url || null
    if (path && !path.toLowerCase().endsWith('.html')) return Response.json({ error: 'Signed contract is not an HTML document' }, { status: 400 })
  } else {
    // Errors if migration 031 isn't applied yet; fall back to the newest file in storage
    const { data, error } = await adminSupabase.from('subcontracts').select('generated_contract_path').eq('id', subcontract_id).maybeSingle()
    path = (!error && data?.generated_contract_path) || await latestGeneratedContractPath(adminSupabase, subcontract_id)
  }
  if (!path) return Response.json({ error: 'No stored contract found' }, { status: 404 })

  const { data: signed, error: signErr } = await adminSupabase.storage.from(CONTRACT_BUCKET).createSignedUrl(path, 300)
  if (signErr || !signed?.signedUrl) return Response.json({ error: 'Could not load the stored contract' }, { status: 500 })
  return privateJson({ url: signed.signedUrl, path })
}
