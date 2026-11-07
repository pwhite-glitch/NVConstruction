// E-signing (signing_requests). status is text: 'pending' -> 'signed', or
// 'voided' (cancelled, replaced by a resend, or the contract changed after sending).
// Pure helpers; no imports.

export const SIGNING_STATUSES = ['pending', 'signed', 'voided']

// Only a pending request can be signed (the sign update is also filtered on it).
export const canSign = status => status === 'pending'

const norm = s => String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

// The typed signature must be the signer's name (trimmed, any letter case,
// runs of spaces treated as one). When the request has no signer name, any
// non-blank signature is accepted.
export function signatureMatchesName(signatureText, signerName) {
  const sig = norm(signatureText)
  if (!sig) return false
  const name = norm(signerName)
  return !name || sig === name
}

// Subcontract fields that make an already-sent signing request stale.
export const CONTRACT_TERMS_FIELDS = ['contract_value', 'description', 'special_terms']

export function changedContractTerms(current, fields) {
  return CONTRACT_TERMS_FIELDS.filter(k => {
    if (!(k in fields)) return false
    if (k === 'contract_value') return Number(fields[k] || 0) !== Number(current?.[k] || 0)
    return String(fields[k] ?? '').trim() !== String(current?.[k] ?? '').trim()
  })
}

// Signed: signed_at set, status 'signed', a non-blank signed_contract_url
// (e-signed or uploaded signed PDF), or a signed signing_request. The helper is
// pure, so a caller that queried signing_requests passes { hasSignedRequest: true }
// (or sets sc.has_signed_request). Same meaning as the job page's isContractSigned
// and migration 044's delete_job_if_unprotected.
export const isSubcontractSigned = (sc, { hasSignedRequest = false } = {}) => !!(sc && (
  sc.signed_at ||
  sc.status === 'signed' ||
  (typeof sc.signed_contract_url === 'string' && sc.signed_contract_url.trim() !== '') ||
  sc.has_signed_request === true ||
  hasSignedRequest === true
))
