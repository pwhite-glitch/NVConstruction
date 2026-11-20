// Office "Upload signed contract" (prompt 97). Pure helpers shared by
// /api/subcontracts/signed-upload, the job page and tests.

// owner (principal) / admin: any job; pm / apm: their assigned jobs (denyJob). Not supers, not subs.
export const SIGNED_UPLOAD_ROLES = new Set(['principal', 'admin', 'pm', 'apm'])
export const canUploadSignedContract = role => SIGNED_UPLOAD_ROLES.has(role)

// Migration 080 columns: dropped on retry before it is applied.
export const SIGNED_METHOD_COLUMNS = ['signed_method', 'signed_uploaded_by']
export const SIGNED_METHODS = { manual: 'manual_upload', esign: 'esign', signwell: 'signwell' }

export const SIGNED_UPLOAD_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif', 'webp']
export const SIGNED_UPLOAD_ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.heif,.webp,application/pdf,image/*'

const extOf = name => (String(name || '').split('.').pop() || '').toLowerCase()

// Why a stored path is not acceptable for this subcontract's signed contract, or null.
export function signedUploadPathError(path, subcontractId) {
  const p = String(path || '')
  if (!p) return 'path required'
  if (!subcontractId || !p.startsWith(`contracts/${subcontractId}/`)) return 'The file must be uploaded under this subcontract (contracts/<id>/).'
  if (p.includes('..') || p.includes('//') || p.includes('\\')) return 'Invalid document path'
  const rest = p.slice(`contracts/${subcontractId}/`.length)
  if (!rest || rest.includes('/')) return 'Invalid document path'
  if (!SIGNED_UPLOAD_EXTS.includes(extOf(rest)) || !rest.includes('.')) return 'Upload the signed contract as a PDF or an image.'
  return null
}

// Storage path the browser uploads to (the route re-checks it).
export function signedUploadPath(subcontractId, fileName, now = Date.now()) {
  const ext = extOf(fileName)
  return `contracts/${subcontractId}/office-signed-${now}.${SIGNED_UPLOAD_EXTS.includes(ext) ? ext : 'pdf'}`
}

// Exactly the columns the route writes: signing only, never amounts / numbering / billing / budget.
export function buildSignedUploadPatch({ path, userId, now }) {
  return { signed_contract_url: path, signed_at: now, signed_method: SIGNED_METHODS.manual, signed_uploaded_by: userId || null }
}

// Card label: 'Signed (uploaded)' / 'Signed (e-sign)' when the method is known, else null.
export function signedMethodLabel(method) {
  if (method === SIGNED_METHODS.manual) return 'Signed (uploaded)'
  if (method === SIGNED_METHODS.esign) return 'Signed (e-sign)'
  if (method === SIGNED_METHODS.signwell) return 'Signed (SignWell)'
  return null
}
