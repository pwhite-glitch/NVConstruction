import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../../lib/server-auth'
import { denyJob } from '../../../../lib/roles'
import { isUuid } from '../../../../lib/generated-contract'
import { objectPathError } from '../../../../lib/file-upload-server'
import { logChange } from '../../../../lib/change-log'
import { buildSignedUploadPatch, signedUploadPathError, SIGNED_UPLOAD_ROLES, SIGNED_METHOD_COLUMNS } from '../../../../lib/signed-upload'
import { writeWithMissingColumnRetry } from '../../../../lib/missing-column-retry'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// POST /api/subcontracts/signed-upload — office "Upload signed contract" (prompt 97), for
// contracts signed on paper instead of e-sign.
//   { subcontract_id, path, replace? }
// The browser first uploads the file to documents/contracts/<subcontract_id>/… (signed upload URL
// from /api/sub-docs, which checks the same job access). This route:
//   - owner/admin: any job; PM/APM: assigned jobs only (denyJob); supers and subs are refused,
//   - checks the path is under contracts/<this subcontract>/ and is a PDF or image,
//   - refuses to replace a signed file already on file unless replace: true (the page asks first),
//   - sets signed_contract_url, signed_at (now), signed_method 'manual_upload',
//     signed_uploaded_by, and status 'signed' (only from active / blank, as e-sign does).
// Never touches contract value, numbering, billing or budget allocations. Before migration 080
// signed_method / signed_uploaded_by are dropped and the rest still saves (method_saved: false).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!SIGNED_UPLOAD_ROLES.has(auth.role)) return Response.json({ error: 'Only office staff can upload a signed contract.' }, { status: 403 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const id = body?.subcontract_id
  const path = body?.path
  if (!isUuid(id)) return Response.json({ error: 'subcontract_id required' }, { status: 400 })

  const { data: sc, error: scErr } = await adminSupabase.from('subcontracts')
    .select('id, job_id, vendor_name, status, signed_at, signed_contract_url').eq('id', id).maybeSingle()
  if (scErr) return Response.json({ error: scErr.message }, { status: 500 })
  if (!sc) return Response.json({ error: 'Subcontract not found.' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, sc.job_id)
  if (denied) return denied
  if (body.job_id && String(body.job_id) !== String(sc.job_id)) return Response.json({ error: 'That subcontract is on a different job.' }, { status: 400 })

  const pathErr = objectPathError(path) || signedUploadPathError(path, sc.id)
  if (pathErr) return Response.json({ error: pathErr }, { status: 400 })
  if (sc.signed_contract_url && body.replace !== true) {
    return Response.json({ error: 'A signed contract is already on file. Confirm to replace it.', code: 'already_signed' }, { status: 409 })
  }

  // The file must really be there (the upload went straight to Storage).
  try {
    const { data: found, error: infoErr } = await adminSupabase.storage.from('documents').info(path)
    if (infoErr || !found) return Response.json({ error: 'The uploaded file was not found. Upload it again.' }, { status: 422 })
  } catch {
    return Response.json({ error: 'Could not check the uploaded file. Try again.' }, { status: 502 })
  }

  const now = new Date().toISOString()
  const patch = buildSignedUploadPatch({ path, userId: auth.userId, now })
  const { error, dropped } = await writeWithMissingColumnRetry(
    row => adminSupabase.from('subcontracts').update(row).eq('id', sc.id), patch, { fallbackCols: SIGNED_METHOD_COLUMNS })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Same status rule as e-sign (lib/generated-contract.js stampSubcontractSigned): active / blank → signed.
  const { error: stErr } = await adminSupabase.from('subcontracts').update({ status: 'signed' }).eq('id', sc.id).or('status.is.null,status.eq.active')

  logChange({
    job_id: sc.job_id, entity_type: 'subcontract', entity_id: sc.id, field_name: 'signed_contract_url',
    old_value: sc.signed_contract_url || null, new_value: path, changed_by: auth.userId,
    note: `${sc.signed_contract_url ? 'Signed contract replaced' : 'Signed contract uploaded'} by office — ${sc.vendor_name || ''}`,
  })

  return Response.json({
    ok: true,
    signed_contract_url: path,
    signed_at: now,
    method_saved: !dropped.length,
    ...(stErr ? { warning: 'Saved, but the status could not be set to signed: ' + stErr.message } : {}),
  })
}
