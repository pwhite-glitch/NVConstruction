// Prompt 107b: the network half of "Send for e-Signature", shared by the portal-tab sign panel
// (sendForESign) and the Edit & Print window (handleContractEditsMessage, action 'send').
// The contract HTML is staged in Storage (uploadThenSend, target 'signing-html'), then
// POST /api/signing-requests with the signer and the exhibit include; the server merges and
// attaches the exhibits and stores the sent HTML as the generated contract (saved_contract).
// fetch / upload are injected so this runs in jest; no DOM needed (makeFile defaults to File).

import { uploadThenSend as defaultUploadThenSend } from './file-upload-client'
import { fetchJson, jsonInit } from './fetch-json'
import { exhibitLettersText } from './subcontract-exhibits'

// Same rule as the sign panel: a name (the person who signs, not the company) and an email.
export const SIGNER_MISSING_MESSAGE = "Enter the signer's full legal name and email"
// Simple shape check (same regex as the Edit & Print window script).
export const isEmailShape = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim())
export function signerError({ signerName, signerEmail } = {}) {
  return !String(signerName ?? '').trim() || !isEmailShape(signerEmail) ? SIGNER_MISSING_MESSAGE : null
}

// "Jane Doe <jane@x.com>"
export const signerLabel = (name, email) => `${String(name ?? '').trim()} <${String(email ?? '').trim().toLowerCase()}>`

// Success text, same wording the sign panel used before (SignWell / test mode / exhibits / voided / warning).
export function sentMessage(json, { edited = false } = {}) {
  const j = json || {}
  const exLetters = j.exhibits_included_letters?.length
    ? j.exhibits_included_letters
    : (j.exhibits_included || []).map(k => (k === 'proposal' ? 'A' : k === 'billing' ? 'B' : null)).filter(Boolean)
  const editedTag = edited ? ' (edited version)' : ''
  const lead = j.provider === 'signwell'
    ? `Sent through SignWell${editedTag}${j.data?.test_mode ? ' (TEST MODE — not legally binding)' : ''}. The subcontractor will receive a SignWell email to sign.`
    : `Sent${editedTag}! The subcontractor will receive an email link to sign.`
  return lead + (exLetters.length ? ` Exhibit${exLetters.length > 1 ? 's' : ''} ${exhibitLettersText(exLetters)} attached.` : '') +
    (j.voided ? ` The older link${j.voided === 1 ? ' was' : 's were'} cancelled.` : '') + (j.warning ? ' ' + j.warning : '')
}

/**
 * Stage the contract HTML and create the signing request.
 *   { jobId, contractId, html, signerName, signerEmail, include, edited, documentTitle }
 *   include: { proposal, billing, extras } — sent as exhibits only with a contractId.
 *   deps: { fetchFn (authFetch), putFn (fetch), uploadThenSend?, makeFile? }
 * Returns { ok, message, json, error, stage }. Never throws.
 */
export async function postContractForSignature(
  { jobId, contractId = null, html, signerName, signerEmail, include = null, edited = false, documentTitle = 'Subcontract Agreement' } = {},
  { fetchFn, putFn, uploadThenSend = defaultUploadThenSend, makeFile = (text, name) => new File([text], name, { type: 'text/html' }) } = {},
) {
  try {
    const r = await uploadThenSend({
      fetchFn, putFn, target: 'signing-html',
      file: makeFile(String(html ?? ''), 'signing.html'),
      context: { job_id: jobId, ...(contractId ? { record_id: contractId } : {}) },
      send: attachment => fetchJson(fetchFn, '/api/signing-requests', jsonInit('POST', {
        job_id: jobId,
        subcontract_id: contractId || null,
        signer_email: String(signerEmail ?? '').trim().toLowerCase(),
        signer_name: String(signerName ?? '').trim(),
        document_attachment: attachment,
        document_title: documentTitle,
        // The server merges and attaches Exhibit A / B (prompt 97) and the extras C, D, …
        // (prompt 103, include.extras); a missing one the user continued without is left out.
        ...(contractId && include ? { exhibits: include } : {}),
      })),
    })
    if (!r.ok) {
      const error = (r.stage === 'upload' ? 'could not stage the document: ' : '') + (r.error || 'unknown error')
      return { ok: false, message: 'Error: ' + error, error, json: r.data || null, stage: r.stage }
    }
    const json = r.data || {}
    return { ok: true, message: sentMessage(json, { edited }), json, error: null }
  } catch (e) {
    const error = e?.message || String(e)
    return { ok: false, message: 'Error: ' + error, error, json: null }
  }
}
