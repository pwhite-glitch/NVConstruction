// Stored copies of subcontract documents, kept in the 'documents' storage bucket.
//   subcontracts/<id>/generated-<time>.html  every contract generated for print or e-signature
//   contracts/<id>/esigned-<time>.html       the e-signed contract with its signature record
// The e-signed copy lives under contracts/<id>/ because that is where signed_contract_url
// files go (the sub portal upload checks that prefix).

export const CONTRACT_BUCKET = 'documents'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

const stamp = (at) => new Date(at).toISOString().replace(/[:.]/g, '-')

export function generatedContractPath(subcontractId, at = new Date()) {
  if (!isUuid(subcontractId)) throw new Error('invalid subcontract id')
  return `subcontracts/${subcontractId}/generated-${stamp(at)}.html`
}

export function esignedContractPath(subcontractId, at = new Date()) {
  if (!isUuid(subcontractId)) throw new Error('invalid subcontract id')
  return `contracts/${subcontractId}/esigned-${stamp(at)}.html`
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Signature record appended to the e-signed copy
export function signatureCertificateHtml({ signature_text, signer_name, signer_email, signed_at, signer_ip, request_id }) {
  const row = (label, value) => value ? `<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>` : ''
  const when = signed_at ? new Date(signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' }) + ' CT' : ''
  return `<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12pt;padding:40px;max-width:700px">
<h2 style="margin:0 0 16px">Electronic Signature Record</h2>
<p style="font-family:'Brush Script MT',cursive;font-size:28pt;margin:0 0 16px">${escapeHtml(signature_text)}</p>
<table style="border-collapse:collapse;font-size:11pt">
${row('Signed by', signer_name)}${row('Email', signer_email)}${row('Signed at', when)}${row('IP address', signer_ip)}${row('Request ID', request_id)}
</table>
</div>`
}

export function withSignatureCertificate(html, cert) {
  const block = signatureCertificateHtml(cert)
  const i = String(html).lastIndexOf('</body>')
  return i === -1 ? `${html}\n${block}` : `${html.slice(0, i)}${block}\n${html.slice(i)}`
}

async function upload(admin, path, html) {
  const { error } = await admin.storage.from(CONTRACT_BUCKET)
    .upload(path, Buffer.from(String(html), 'utf8'), { contentType: 'text/html; charset=utf-8', upsert: false })
  if (error) throw new Error(`upload failed: ${error.message}`)
}

/**
 * Store a generated contract and record it on the subcontract.
 * The file is kept even if recording fails (e.g. migration 031 not applied yet);
 * `recorded` says whether the subcontract row was updated.
 */
export async function saveGeneratedContract(admin, { subcontractId, html, userId, at = new Date() }) {
  if (!html) throw new Error('html required')
  const path = generatedContractPath(subcontractId, at)
  await upload(admin, path, html)
  const generated_at = new Date(at).toISOString()
  const { error } = await admin.from('subcontracts')
    .update({ generated_contract_path: path, generated_at, generated_by: userId || null })
    .eq('id', subcontractId)
  if (error) console.error('saveGeneratedContract: could not record on subcontract:', error.message)
  return { path, generated_at, recorded: !error }
}

/**
 * Store the e-signed contract (document + signature record) and set it as the
 * subcontract's signed_contract_url, unless a signed contract is already on file.
 */
export async function saveSignedContract(admin, { subcontractId, html, certificate, at = new Date() }) {
  const path = esignedContractPath(subcontractId, at)
  await upload(admin, path, withSignatureCertificate(html || '', certificate))
  const { data, error } = await admin.from('subcontracts')
    .update({ signed_contract_url: path })
    .eq('id', subcontractId)
    .is('signed_contract_url', null)
    .select('id')
  if (error) throw new Error(`could not set signed_contract_url: ${error.message}`)
  return { path, linked: (data || []).length > 0 }
}

// Path of the newest generated copy in storage, for when the subcontract row has none recorded
export async function latestGeneratedContractPath(admin, subcontractId) {
  if (!isUuid(subcontractId)) return null
  const folder = `subcontracts/${subcontractId}`
  const { data } = await admin.storage.from(CONTRACT_BUCKET)
    .list(folder, { limit: 1, sortBy: { column: 'name', order: 'desc' }, search: 'generated-' })
  return data?.[0]?.name ? `${folder}/${data[0].name}` : null
}
