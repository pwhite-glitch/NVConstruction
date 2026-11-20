// SignWell for subcontracts (prompt 98). SERVER ONLY. The routes run auth / role / job checks
// first; everything here takes the service-role client and an optional { env, fetchFn }.
//
// Columns (migration 081): subcontracts.signwell_document_id, signwell_status,
// signwell_sent_at, signwell_completed_at. Before 081 is applied every SignWell action
// returns a clear "run migration 081" error and the built-in e-sign keeps working.
//
// Writes are signing-only: never amounts, billing, numbering or budget.

import * as sw from './signwell'
import { isMissingColumnError } from './missing-column-retry'
import { stampSubcontractSigned, CONTRACT_BUCKET, isUuid } from './generated-contract'
import { isPdfBytes } from './subcontract-exhibits'

export const SIGNWELL_COLUMNS = ['signwell_document_id', 'signwell_status', 'signwell_sent_at', 'signwell_completed_at']
export const SIGNWELL_METHOD = 'signwell'
export const MIGRATION_081_MESSAGE = 'SignWell is turned on, but the database is missing its columns. Run migration 081 (supabase/migrations/081_subcontract_signwell.sql). Nothing was sent.'

const SC_COLS = 'id, job_id, vendor_name, status, signed_at, signed_contract_url, signwell_document_id, signwell_status, signwell_sent_at, signwell_completed_at'

export const signwellPdfPath = (subcontractId, docId) => `contracts/${subcontractId}/signwell-${String(docId).replace(/[^A-Za-z0-9-]/g, '')}.pdf`

/**
 * Load a subcontract with its SignWell columns.
 * { sc } | { error, status, code } — code 'migration_081' when the columns are missing.
 */
export async function loadSignwellSubcontract(admin, subcontractId) {
  const { data, error } = await admin.from('subcontracts').select(SC_COLS).eq('id', subcontractId).maybeSingle()
  if (error) {
    if (isMissingColumnError(error)) return { error: MIGRATION_081_MESSAGE, status: 409, code: 'migration_081' }
    return { error: error.message, status: 500 }
  }
  if (!data) return { error: 'Subcontract not found.', status: 404 }
  return { sc: data }
}

// Before building / sending: columns present, nothing already out for signature.
export async function signwellSendPreflight(admin, subcontractId) {
  const r = await loadSignwellSubcontract(admin, subcontractId)
  if (r.error) return r
  if (r.sc.signwell_document_id && sw.isSignwellOpen(r.sc.signwell_status)) {
    return { error: 'This subcontract is already out for signature on SignWell. Void it first, or send a reminder.', status: 409, code: 'signwell_open' }
  }
  return r
}

/**
 * Create + send the SignWell document and record it on the subcontract.
 *   packet: buildSignwellPacket(...) result
 * Returns { ok, document_id, signwell_status, test_mode } or { error, status }.
 * If the subcontract can't be updated, the SignWell document is deleted again so nothing is
 * left out for signature that the portal doesn't know about.
 */
export async function sendSubcontractViaSignwell(admin, { sc, packet, signerName, signerEmail, title, jobId }, opts = {}) {
  let doc
  try {
    doc = await sw.createDocument({
      name: title || `Subcontract - ${sc.vendor_name || ''}`,
      subject: `Please sign: ${title || 'Subcontract Agreement'}`,
      message: 'NV Construction has sent you a subcontract to review and sign electronically.',
      files: packet.files,
      recipients: [{ id: '1', name: signerName, email: signerEmail }],
      metadata: { subcontract_id: sc.id, job_id: jobId || sc.job_id },
      textTags: packet.textTags,
    }, opts)
  } catch (e) {
    return { error: 'Nothing was sent: ' + (e.message || 'SignWell error'), status: e.status === 429 ? 429 : 502 }
  }
  if (!doc?.id) return { error: 'Nothing was sent: SignWell did not return a document id.', status: 502 }
  const now = new Date().toISOString()
  const signwell_status = sw.mapSignwellStatus(doc.status) || 'sent'
  const { data, error } = await admin.from('subcontracts')
    .update({ signwell_document_id: doc.id, signwell_status, signwell_sent_at: now, signwell_completed_at: null })
    .eq('id', sc.id).select('id')
  if (error || !data?.length) {
    try { await sw.deleteDocument(doc.id, opts) } catch (e) { console.error('signwell: could not delete unrecorded document:', e.message) }
    if (error && isMissingColumnError(error)) return { error: MIGRATION_081_MESSAGE, status: 409, code: 'migration_081' }
    return { error: 'Nothing was sent: could not record the SignWell document (' + (error?.message || 'subcontract not updated') + ').', status: 500 }
  }
  return { ok: true, document_id: doc.id, signwell_status, test_mode: doc.test_mode ?? sw.isSignwellTestMode(opts.env) }
}

// Office "Resend reminder". sc from loadSignwellSubcontract.
export async function remindSignwell(sc, opts = {}) {
  if (!sc.signwell_document_id || !sw.isSignwellOpen(sc.signwell_status)) return { error: 'There is no SignWell request out for signature on this subcontract.', status: 409 }
  try {
    await sw.remind(sc.signwell_document_id, opts)
    return { ok: true }
  } catch (e) {
    return { error: 'Reminder not sent: ' + e.message, status: e.status === 429 ? 429 : 502 }
  }
}

// Office "Void": delete (= cancel) the SignWell document, then signwell_status 'canceled'.
// The send never changed subcontracts.status, so there is no status to revert.
export async function voidSignwell(admin, sc, opts = {}) {
  if (!sc.signwell_document_id || !sw.isSignwellOpen(sc.signwell_status)) return { error: 'Only a SignWell request still out for signature can be voided.', status: 409 }
  try {
    await sw.deleteDocument(sc.signwell_document_id, opts)
  } catch (e) {
    if (e.status !== 404) return { error: 'Not voided: ' + e.message, status: e.status === 429 ? 429 : 502 }
  }
  const { error } = await admin.from('subcontracts').update({ signwell_status: 'canceled' })
    .eq('id', sc.id).eq('signwell_document_id', sc.signwell_document_id)
  if (error) return { error: 'Voided on SignWell, but the portal could not record it: ' + error.message, status: 500 }
  return { ok: true, signwell_status: 'canceled' }
}

// ── Webhook ──────────────────────────────────────────────────────────────────
const STATUS_EVENTS = new Set([
  'document_sent', 'document_viewed', 'document_in_progress', 'document_signed',
  'document_declined', 'document_canceled', 'document_expired', 'document_bounced', 'document_error',
])
export const SIGNWELL_HANDLED_EVENTS = new Set([...STATUS_EVENTS, 'document_completed'])
// Once here, only a completion (from the re-fetched document) changes anything.
const FINAL = new Set(['completed', 'canceled'])

/**
 * Verified webhook payload → { status, body }. Acts only on GET /documents/{id}, never on the
 * posted body, and only when metadata.subcontract_id names a subcontract whose stored
 * signwell_document_id is that document. Repeat events are no-ops.
 */
export async function processSignwellWebhook(admin, payload, opts = {}) {
  const type = payload?.event?.type
  if (!SIGNWELL_HANDLED_EVENTS.has(type)) return { status: 200, body: { ok: true, ignored: 'event' } }
  const postedId = payload?.data?.object?.id
  if (typeof postedId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(postedId)) return { status: 400, body: { error: 'document id missing' } }

  let doc
  try {
    doc = await sw.getDocument(postedId, opts)
  } catch (e) {
    if (e.status === 404) return { status: 200, body: { ok: true, ignored: 'document not found' } }
    return { status: 502, body: { error: 'Could not load the document from SignWell.' } }
  }
  if (!doc || doc.id !== postedId) return { status: 409, body: { error: 'document mismatch' } }
  const scId = doc.metadata?.subcontract_id
  if (!isUuid(scId)) return { status: 404, body: { error: 'no matching subcontract' } }

  const r = await loadSignwellSubcontract(admin, scId)
  if (r.code === 'migration_081') return { status: 503, body: { error: 'run migration 081' } }
  if (r.error) return { status: r.status === 404 ? 404 : 500, body: { error: r.status === 404 ? 'no matching subcontract' : 'database error' } }
  const sc = r.sc
  if (!sc.signwell_document_id || sc.signwell_document_id !== doc.id) return { status: 404, body: { error: 'no matching subcontract' } }
  if (doc.metadata?.job_id && sc.job_id && String(doc.metadata.job_id) !== String(sc.job_id)) return { status: 404, body: { error: 'no matching subcontract' } }

  const status = sw.mapSignwellStatus(doc.status)
  if (status === 'completed') return completeSignwell(admin, sc, doc, opts)
  if (!status || FINAL.has(sc.signwell_status) || sc.signwell_status === status) return { status: 200, body: { ok: true, unchanged: true } }
  const { error } = await admin.from('subcontracts').update({ signwell_status: status })
    .eq('id', sc.id).eq('signwell_document_id', doc.id)
  if (error) return { status: 500, body: { error: 'database error' } }
  return { status: 200, body: { ok: true, signwell_status: status } }
}

async function completeSignwell(admin, sc, doc, opts) {
  const path = signwellPdfPath(sc.id, doc.id)
  // Idempotent: already recorded with the signed file on file.
  if (sc.signwell_status === 'completed' && sc.signwell_completed_at && sc.signed_contract_url) {
    return { status: 200, body: { ok: true, unchanged: true } }
  }
  let pdf
  try {
    pdf = await sw.getCompletedPdf(doc.id, opts)
  } catch (e) {
    return { status: 502, body: { error: 'Could not download the completed PDF.' } }
  }
  if (!isPdfBytes(pdf)) return { status: 502, body: { error: 'The completed PDF was not a PDF.' } }
  // Same storage client / bucket / folder as the other signed contracts. A fixed name per
  // document, so a retry overwrites the same file instead of adding another.
  const { error: upErr } = await admin.storage.from(CONTRACT_BUCKET).upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true })
  if (upErr) return { status: 500, body: { error: 'Could not store the signed PDF.' } }

  const completedAt = new Date().toISOString()
  // signed_contract_url: never replaces a different signed file already on file (same rule as e-sign).
  let linked = sc.signed_contract_url === path
  if (!linked) {
    const { data, error } = await admin.from('subcontracts').update({ signed_contract_url: path })
      .eq('id', sc.id).is('signed_contract_url', null).select('id')
    if (error) return { status: 500, body: { error: 'database error' } }
    linked = (data || []).length > 0
  }
  if (linked) {
    // signed_method is migration 080; before it is applied this is skipped (as for e-sign).
    const m = await admin.from('subcontracts').update({ signed_method: SIGNWELL_METHOD }).eq('id', sc.id).eq('signed_contract_url', path)
    if (m?.error && !isMissingColumnError(m.error)) console.error('signwell: could not record signed_method:', m.error.message)
  }
  const { error: swErr } = await admin.from('subcontracts').update({ signwell_status: 'completed', signwell_completed_at: completedAt })
    .eq('id', sc.id).eq('signwell_document_id', doc.id)
  if (swErr) return { status: 500, body: { error: 'database error' } }
  const stamped = await stampSubcontractSigned(admin, sc.id, completedAt)
  if (stamped.error) console.error('signwell: could not record signed_at / status:', stamped.error)
  return { status: 200, body: { ok: true, signwell_status: 'completed', linked } }
}
