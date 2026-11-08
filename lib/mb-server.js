// Server-side metal-building order helpers: access loading, Owner payment
// instructions, the pinned client order form (PDF) and its signed copy, and the
// durable automatic deposit-request email. The Supabase client and the Resend
// client are passed in, so routes and tests share the same code.

import { createHash } from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { escapeHtml } from './email'
import { siteUrl } from './site-url'
import { winAnsiSafe, wrapLines } from './pdf-text'
import { toCents, formatCents } from './mb-commission'
import { isMb, canWorkMbOrder, SATISFIED_PAYMENT, validDepositAmount } from './mb-orders'
import { isValidEmail } from './customer-portal'

export const SALES_BUCKET = 'sales-docs'
export const SCHEMA_HINT = 'Metal-building workflow storage is not set up yet (migration 050 has not been applied).'

// Stale 'sending' claims may be re-tried after this long (a send still in flight is never doubled).
export const STALE_SENDING_MS = 10 * 60 * 1000
// Resend keeps idempotency keys for 24 hours; re-sending an uncertain message is only safe inside it.
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000

export function isMissingSchema(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(code)) return true
  return /does not exist|schema cache|Could not find the/i.test(String(error.message || ''))
}

export const sha256Hex = buf => createHash('sha256').update(buf).digest('hex')

export async function actorName(db, userId) {
  if (!userId) return 'Staff'
  const { data } = await db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  return data?.full_name || data?.email || 'Staff'
}

// ── Order + access ────────────────────────────────────────────────────────────
// Loads the order and its attribution. Fails closed on any lookup error.
// Returns { order, attribution } or { status, error }.
export async function loadMbOrder(db, orderId) {
  if (!orderId || typeof orderId !== 'string') return { status: 400, error: 'id required' }
  const { data: order, error } = await db.from('sales_orders').select('*').eq('id', orderId).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!order) return { status: 404, error: 'Order not found' }
  if (!isMb(order)) return { status: 400, error: 'This action is only for metal-building orders.' }
  const { data: attribution, error: aErr } = await db.from('sales_attribution').select('*').eq('order_id', orderId)
  if (aErr) return { status: 500, error: aErr.message }
  return { order, attribution: attribution || [] }
}

export async function requireMbWorker(db, auth, orderId) {
  const ctx = await loadMbOrder(db, orderId)
  if (ctx.error) return ctx
  if (!canWorkMbOrder(auth, ctx.order, ctx.attribution)) return { status: 403, error: 'You are not on this order.' }
  return ctx
}

// ── Signing requests for an order ─────────────────────────────────────────────
const MB_REQ_COLS = 'id, token, status, signer_email, signer_name, document_title, created_at, signed_at, sales_order_id, sales_doc_id, document_storage_path, document_file_name, document_sha256, deposit_amount_snapshot, mb_supplier_id, signed_document_path, signed_doc_id, signature_text, signer_ip, created_by'

export async function mbRequestsForOrder(db, orderId) {
  const { data, error } = await db.from('signing_requests').select(MB_REQ_COLS).eq('sales_order_id', orderId)
  if (error) return { error, missingSchema: isMissingSchema(error) }
  const rows = [...(data || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return {
    rows,
    pending: rows.find(r => r.status === 'pending') || null,
    signed: rows.find(r => r.status === 'signed') || null,
  }
}

// MB columns of a request by token. { mb: null } when the request is not an MB one
// or migration 050 is not applied (then no MB request can exist).
export async function mbRequestByToken(db, token) {
  const { data, error } = await db.from('signing_requests').select(MB_REQ_COLS).eq('token', token).maybeSingle()
  if (error) return isMissingSchema(error) ? { mb: null } : { error }
  return { mb: data?.sales_order_id ? data : null }
}

// ── Owner payment instructions ────────────────────────────────────────────────
export async function getPaymentInstructions(db) {
  const { data, error } = await db.from('company_payment_settings').select('payment_instructions, updated_at, updated_by_name').eq('id', 1).maybeSingle()
  if (error) return { error: isMissingSchema(error) ? SCHEMA_HINT : error.message, missingSchema: isMissingSchema(error) }
  const text = typeof data?.payment_instructions === 'string' ? data.payment_instructions : ''
  return { configured: text.trim().length > 0, text, updated_at: data?.updated_at || null, updated_by_name: data?.updated_by_name || null }
}

// ── Storage / PDF ─────────────────────────────────────────────────────────────
export async function downloadBytes(db, path, bucket = SALES_BUCKET) {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error || !data) return { error: error?.message || 'File not found in storage' }
  return { bytes: Buffer.from(await data.arrayBuffer()) }
}

export async function checkStoredFile(db, path) {
  const r = await downloadBytes(db, path)
  if (r.error) return { error: r.error }
  if (!r.bytes.length) return { error: 'The stored file is empty' }
  return { bytes: r.bytes }
}

// A client order form must be an ordinary PDF the signer can see.
export async function validateSignablePdf(bytes) {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1')
  if (!head.includes('%PDF-')) return { error: 'The client order form is not a PDF. Upload it as a PDF to send it for signature.' }
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const pages = doc.getPageCount()
    if (!pages) return { error: 'The client order form PDF has no pages.' }
    return { pages }
  } catch (e) {
    const enc = /encrypt/i.test(e?.message || '')
    return { error: enc
      ? 'The client order form PDF is password-protected or encrypted. Save an unprotected copy and upload it again.'
      : 'The client order form PDF could not be read. Export it again as a regular PDF and upload it.' }
  }
}

// Load the exact pinned document and verify it is the same bytes that were sent.
export async function loadPinnedPdf(db, request) {
  if (!request?.document_storage_path || !request?.document_sha256) return { error: 'This signing request has no pinned document.' }
  const r = await downloadBytes(db, request.document_storage_path)
  if (r.error) return { error: 'The order form for this signing link is missing. Ask NV Construction for a new link.' }
  if (sha256Hex(r.bytes) !== request.document_sha256) return { error: 'The order form for this signing link has changed. Ask NV Construction for a new link.' }
  return { bytes: r.bytes }
}

const fmtCT = at => new Date(at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' }) + ' CT'

// Original PDF pages + an "Electronic Signature Record" page bound to its SHA-256.
export async function buildSignedPdf(originalBytes, cert) {
  const doc = await PDFDocument.load(originalBytes, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])
  let y = 740
  const line = (label, value) => {
    if (!value) return
    page.drawText(winAnsiSafe(label), { x: 54, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) })
    for (const l of wrapLines(String(value), font, 11, 360)) {
      page.drawText(l, { x: 190, y, size: 11, font })
      y -= 16
    }
    y -= 4
  }
  page.drawText('Electronic Signature Record', { x: 54, y, size: 18, font: bold })
  y -= 36
  for (const l of wrapLines(cert.signature_text, bold, 22, 500)) { page.drawText(l, { x: 54, y, size: 22, font: bold }); y -= 30 }
  y -= 10
  line('Document', cert.file_name)
  line('Order', cert.order_number)
  line('Signed by', cert.signer_name)
  line('Email', cert.signer_email)
  line('Signed at', fmtCT(cert.signed_at))
  line('IP address', cert.signer_ip)
  line('Request ID', cert.request_id)
  line('Document SHA-256', cert.document_sha256)
  y -= 8
  for (const l of wrapLines('The signer reviewed the pages above (the exact file identified by the SHA-256 fingerprint) and signed electronically by typing their name.', font, 10, 500)) {
    page.drawText(l, { x: 54, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) }); y -= 14
  }
  const at = new Date(cert.signed_at)
  doc.setModificationDate(at)
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

export const signedCopyPath = (orderId, requestId) => `${orderId}/signed/${requestId}.pdf`

// Store the signed copy once and link it on the request. Safe to call again.
export async function saveMbSignedCopy(db, { order, request }) {
  if (request.signed_doc_id) return { doc_id: request.signed_doc_id, already: true }
  if (request.status !== 'signed') return { error: 'Request is not signed.' }
  const pin = await loadPinnedPdf(db, request)
  if (pin.error) return { error: pin.error }
  const bytes = await buildSignedPdf(pin.bytes, {
    signature_text: request.signature_text || request.signer_name,
    signer_name: request.signer_name, signer_email: request.signer_email,
    signed_at: request.signed_at, signer_ip: request.signer_ip, request_id: request.id,
    file_name: request.document_file_name, document_sha256: request.document_sha256, order_number: order.order_number,
  })
  const path = signedCopyPath(order.id, request.id)
  const { error: upErr } = await db.storage.from(SALES_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return { error: `Could not store the signed copy: ${upErr.message}` }
  const { data: doc, error: docErr } = await db.from('sales_order_docs').insert({
    order_id: order.id,
    file_name: `Signed - ${request.document_file_name || 'client order form.pdf'}`,
    storage_path: path,
    category: 'contract',
    visible_to_customer: false,
    uploaded_by: null,
    uploaded_by_name: 'E-signature',
    notes: `E-signed ${fmtCT(request.signed_at)} by ${request.signer_name || request.signer_email}. Request ${request.id}. Original SHA-256 ${request.document_sha256}.`,
    file_size_bytes: bytes.length,
    replaces_doc_id: request.sales_doc_id || null,
  }).select('id').single()
  if (docErr) return { error: `Could not record the signed copy: ${docErr.message}` }
  const { data: linked, error: linkErr } = await db.from('signing_requests')
    .update({ signed_document_path: path, signed_doc_id: doc.id })
    .eq('id', request.id).is('signed_doc_id', null).select('id')
  if (linkErr) return { error: `Could not link the signed copy: ${linkErr.message}`, doc_id: doc.id }
  if (!linked?.length) {
    // Someone else linked a copy first; drop ours (same path, same evidence).
    await db.from('sales_order_docs').delete().eq('id', doc.id)
    return { already: true }
  }
  return { doc_id: doc.id, path }
}

// ── Deposit-request email ─────────────────────────────────────────────────────
export function depositRequestEmail({ order, amountCents, instructions }) {
  const name = escapeHtml(String(order.customer_name || '').trim().split(/\s+/)[0] || 'there')
  const orderNo = escapeHtml(order.order_number || '')
  const amount = escapeHtml(formatCents(amountCents))
  const instr = escapeHtml(String(instructions || '').trim()).replace(/\r\n|\r|\n/g, '<br>')
  const logo = siteUrl('logo.png')
  const subject = `Deposit due for your metal building order ${order.order_number || ''}`.trim()
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#1a2332;padding:18px 24px;border-radius:8px 8px 0 0">
    <img src="${logo}" alt="NV Construction" width="40" height="40" style="vertical-align:middle;object-fit:contain" />
    <span style="color:#fff;font-weight:700;font-size:16px;margin-left:8px;vertical-align:middle">NV Construction</span>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:15px">Hi ${name},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151">Thank you for signing your order form${orderNo ? ` for order <strong>${orderNo}</strong>` : ''}. To get your building ordered, please send your deposit.</p>
    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">Deposit due</p>
    <p style="margin:0 0 20px;font-size:22px;font-weight:800;color:#111827">${amount}</p>
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">How to pay</p>
    <div style="font-size:14px;color:#111827;line-height:1.6;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin-bottom:16px">${instr}</div>
    <p style="margin:0;font-size:12px;color:#6b7280">Questions? Reply to this email.</p>
  </div>
</div></body></html>`
  const text = `Hi ${String(order.customer_name || '').trim().split(/\s+/)[0] || 'there'},\n\nThank you for signing your order form${order.order_number ? ` for order ${order.order_number}` : ''}. Deposit due: ${formatCents(amountCents)}\n\nHow to pay:\n${String(instructions || '').trim()}\n\nQuestions? Reply to this email.`
  return { subject, html, text }
}

async function readWorkflow(db, orderId) {
  const { data, error } = await db.from('mb_order_workflow').select('*').eq('order_id', orderId).maybeSingle()
  if (error) return { error: isMissingSchema(error) ? SCHEMA_HINT : error.message, missingSchema: isMissingSchema(error) }
  return { row: data || null }
}

// EVERY column of mb_order_workflow as defined by migration 050's CREATE TABLE (not a
// hand-picked subset). SELECT * succeeds when one of them is absent (a partly applied
// 050), so the preflight names them all explicitly: Postgres/PostgREST then errors
// (42703 / PGRST204) and we fail closed (503) before any write.
export const WORKFLOW_COLUMNS = [
  'order_id', 'created_at', 'updated_at',
  'signing_request_id',
  'deposit_email_status', 'deposit_email_key', 'deposit_email_key_gen', 'deposit_email_attempts',
  'deposit_email_claimed_at', 'deposit_email_first_attempt_at', 'deposit_email_sent_at', 'deposit_email_provider_id',
  'deposit_email_failure_kind', 'deposit_email_last_error', 'deposit_email_to', 'deposit_email_amount', 'deposit_email_payload',
  'deposit_receipt_source', 'deposit_receipt_marked_at', 'deposit_receipt_marked_by', 'deposit_receipt_marked_by_name',
  'deposit_received_amount', 'deposit_received_amount_at',
  'supplier_turned_in_at', 'supplier_turned_in_by', 'supplier_turned_in_by_name', 'supplier_turned_in_supplier_id',
  'supplier_turned_in_doc_id', 'supplier_order_row_id',
]
export const WORKFLOW_REQUIRED_COLS = WORKFLOW_COLUMNS.join(', ')

// A uuid no order ever has: lets the preflight probe the schema before an order exists.
export const NO_ORDER_ID = '00000000-0000-0000-0000-000000000000'

// Schema preflight before any MB mutation that depends on mb_order_workflow.
// Probes the table AND the required columns, then returns the full row.
// Returns { row } or { status, error } (503 + SCHEMA_HINT when migration 050 is missing/partial).
export async function preflightWorkflow(db, orderId) {
  const { error: probeErr } = await db.from('mb_order_workflow').select(WORKFLOW_REQUIRED_COLS).eq('order_id', orderId || NO_ORDER_ID).limit(1)
  if (probeErr) return { status: isMissingSchema(probeErr) ? 503 : 500, error: isMissingSchema(probeErr) ? SCHEMA_HINT : probeErr.message }
  if (!orderId) return { row: null }
  const wf = await readWorkflow(db, orderId)
  if (wf.error) return { status: wf.missingSchema ? 503 : 500, error: wf.error }
  return { row: wf.row }
}

// DB guard errors raised by the migration-050 triggers (see the SQL file).
export function lockErrorMessage(error) {
  const m = String(error?.message || '')
  if (/mb_signing_locked/.test(m)) return 'Deposit amount, customer name/email and supplier are locked while the client order form is out for signature or signed. Cancel the pending signature request first.'
  if (/mb_deposit_locked/.test(m)) return 'The deposit amount cannot change after the deposit is recorded received.'
  if (/mb_snapshot_mismatch/.test(m)) return 'The order changed while the signature request was being created. Reload the page and send again.'
  return null
}

const depositSatisfied = order => order?.deposit_received === true || SATISFIED_PAYMENT.has(order?.payment_status)

// Durable "a deposit request is owed for this signed request" marker. Idempotent:
// an existing marker is never reset. A deposit that is already received/paid gets
// 'not_needed' (no demand is ever emailed for it).
export async function ensureDepositQueued(db, { order, request }) {
  const cur = await readWorkflow(db, order.id)
  if (cur.error) return { error: cur.error }
  const status = depositSatisfied(order) ? 'not_needed' : 'queued'
  const fields = {
    signing_request_id: String(request.id),
    deposit_email_status: status,
    deposit_email_key: `mb-deposit-${request.id}`,
    deposit_email_to: request.signer_email,
    deposit_email_amount: request.deposit_amount_snapshot,
    updated_at: new Date().toISOString(),
  }
  if (cur.row?.deposit_email_status) return { status: cur.row.deposit_email_status, existing: true }
  if (cur.row) {
    const { data, error } = await db.from('mb_order_workflow').update(fields).eq('order_id', order.id).is('deposit_email_status', null).select('deposit_email_status')
    if (error) return { error: error.message }
    if (!data?.length) { const again = await readWorkflow(db, order.id); return { status: again.row?.deposit_email_status || null, existing: true } }
    return { status }
  }
  const { error } = await db.from('mb_order_workflow').insert({ order_id: order.id, deposit_email_attempts: 0, deposit_email_key_gen: 0, ...fields })
  if (error) {
    // Lost an insert race (primary key): the other caller's marker stands.
    const again = await readWorkflow(db, order.id)
    if (again.row?.deposit_email_status) return { status: again.row.deposit_email_status, existing: true }
    return { error: isMissingSchema(error) ? SCHEMA_HINT : error.message }
  }
  return { status }
}

// Provider error -> 'rejected' (definitely not sent; next try uses a new key) or
// 'uncertain' (may have been sent; retries reuse the same key and payload).
export function classifySendError(err) {
  const code = Number(err?.statusCode || err?.status || 0)
  if (code >= 400 && code < 500 && code !== 408 && code !== 409 && code !== 429) return 'rejected'
  return 'uncertain'
}

/**
 * Send (or retry) the deposit-request email for an MB order, exactly once.
 *   opts.retry: allow re-claiming a stale 'sending' claim (within the idempotency window)
 *   opts.forceUncertain: Owner-confirmed resend of a claim older than the window
 * Inside the window (23h from the generation's first provider attempt) a retry reuses
 * the same idempotency key AND the saved payload. A definite rejection bumps the key
 * generation (new key, new payload, new window). After the window an uncertain
 * generation is never re-sent without forceUncertain.
 * Returns { status, sent?, error?, warning? }. Never throws.
 */
export async function sendDepositEmail(db, resend, { orderId, now = new Date(), retry = false, forceUncertain = false, from } = {}) {
  try {
    const cur = await readWorkflow(db, orderId)
    if (cur.error) return { status: null, error: cur.error }
    const row = cur.row
    if (!row?.deposit_email_status) return { status: null, error: 'No deposit request is queued for this order.' }
    if (['sent', 'not_needed'].includes(row.deposit_email_status)) return { status: row.deposit_email_status }

    const nowIso = new Date(now).toISOString()
    // Idempotency window (Resend keeps an idempotency key ~24h; we use 23h to stay inside it).
    // It is measured from the FIRST provider attempt of the current key generation
    // (deposit_email_first_attempt_at), never from the latest retry. Rows written before
    // that column existed fall back to the last claim time.
    const windowStart = row.deposit_email_first_attempt_at ||
      ((row.deposit_email_status === 'sending' || row.deposit_email_failure_kind === 'uncertain') ? row.deposit_email_claimed_at : null)
    const pastWindow = !!windowStart && (new Date(now) - new Date(windowStart)) > IDEMPOTENCY_WINDOW_MS
    const PAST_WINDOW_ERROR = 'An earlier send may have gone out more than 23 hours ago and could not be confirmed. Check the email provider log; the Owner can force a resend.'
    // A forced (Owner) resend after the window starts a new window from now.
    const forcing = pastWindow && forceUncertain
    let claimed = null
    if (['queued', 'failed'].includes(row.deposit_email_status)) {
      // A failed row whose generation already reached the provider (uncertain outcome)
      // must not call the provider again after the window unless the Owner forces it.
      if (row.deposit_email_status === 'failed' && pastWindow && !forceUncertain) return { status: 'failed', error: PAST_WINDOW_ERROR }
      const { data, error } = await db.from('mb_order_workflow')
        .update({ deposit_email_status: 'sending', deposit_email_claimed_at: nowIso, deposit_email_attempts: (row.deposit_email_attempts || 0) + 1, updated_at: nowIso, ...(forcing ? { deposit_email_first_attempt_at: nowIso } : {}) })
        .eq('order_id', orderId).eq('deposit_email_status', row.deposit_email_status).eq('deposit_email_attempts', row.deposit_email_attempts || 0)
        .select('*')
      if (error) return { status: row.deposit_email_status, error: error.message }
      claimed = data?.[0] || null
    } else if (row.deposit_email_status === 'sending') {
      const age = now - new Date(row.deposit_email_claimed_at || 0)
      if (!retry || age < STALE_SENDING_MS) return { status: 'sending', warning: 'The deposit request is being sent. Check back in a few minutes.' }
      if (pastWindow && !forceUncertain) return { status: 'sending', error: PAST_WINDOW_ERROR }
      const { data, error } = await db.from('mb_order_workflow')
        .update({ deposit_email_claimed_at: nowIso, deposit_email_attempts: (row.deposit_email_attempts || 0) + 1, updated_at: nowIso, ...(forcing ? { deposit_email_first_attempt_at: nowIso } : {}) })
        .eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', row.deposit_email_claimed_at)
        .select('*')
      if (error) return { status: 'sending', error: error.message }
      claimed = data?.[0] || null
    }
    if (!claimed) return { status: 'sending', warning: 'Another send is in progress.' }

    const fail = async (kind, message, { bumpGen = false } = {}) => {
      const patch = {
        deposit_email_status: 'failed', deposit_email_failure_kind: kind,
        deposit_email_last_error: String(message || 'Send failed').slice(0, 300), updated_at: new Date().toISOString(),
      }
      // A new key generation is a new provider request: new key, new payload, new window.
      if (bumpGen) { patch.deposit_email_key_gen = (claimed.deposit_email_key_gen || 0) + 1; patch.deposit_email_payload = null; patch.deposit_email_first_attempt_at = null }
      const { error } = await db.from('mb_order_workflow').update(patch).eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', nowIso)
      return { status: 'failed', error: message, ...(error ? { warning: `Could not record the failure: ${error.message}` } : {}) }
    }

    // Re-check the order right before sending: never demand a satisfied deposit.
    const { data: order, error: oErr } = await db.from('sales_orders').select('id, order_number, customer_name, deposit_received, payment_status').eq('id', orderId).maybeSingle()
    if (oErr || !order) return fail('config', oErr?.message || 'Order not found')
    if (depositSatisfied(order)) {
      await db.from('mb_order_workflow').update({ deposit_email_status: 'not_needed', updated_at: new Date().toISOString() })
        .eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', nowIso)
      return { status: 'not_needed' }
    }

    let payload = claimed.deposit_email_payload
    if (!payload) {
      const to = claimed.deposit_email_to
      const amountCents = toCents(claimed.deposit_email_amount)
      if (!isValidEmail(String(to || ''))) return fail('config', 'The customer email on the signed request is not valid.', { bumpGen: true })
      if (!validDepositAmount(claimed.deposit_email_amount)) return fail('config', 'The deposit amount on the signed request is not valid.', { bumpGen: true })
      const settings = await getPaymentInstructions(db)
      if (settings.error) return fail('config', settings.error, { bumpGen: true })
      if (!settings.configured) return fail('config', 'Payment instructions are not set up. The Owner must add them before the deposit request can be sent.', { bumpGen: true })
      const msg = depositRequestEmail({ order, amountCents, instructions: settings.text })
      payload = { from: from || process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>', to, subject: msg.subject, html: msg.html, text: msg.text }
      const { error: pErr } = await db.from('mb_order_workflow').update({ deposit_email_payload: payload })
        .eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', nowIso)
      if (pErr) return fail('config', `Could not save the message before sending: ${pErr.message}`, { bumpGen: true })
    }
    const idempotencyKey = `${claimed.deposit_email_key}:${claimed.deposit_email_key_gen || 0}`

    // Record the first provider attempt of this generation once (never overwritten by retries).
    if (!claimed.deposit_email_first_attempt_at) {
      const { error: fErr } = await db.from('mb_order_workflow').update({ deposit_email_first_attempt_at: nowIso })
        .eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', nowIso).is('deposit_email_first_attempt_at', null)
      if (fErr) return fail('config', `Could not record the send attempt before sending: ${fErr.message}`)
    }

    let result
    try {
      result = await resend.emails.send(payload, { idempotencyKey })
    } catch (e) {
      return fail('uncertain', `Email provider did not answer clearly: ${e?.message || 'unknown error'}`)
    }
    if (result?.error) {
      const kind = classifySendError(result.error)
      return fail(kind, result.error.message || 'Email provider refused the message', { bumpGen: kind === 'rejected' })
    }
    if (!result?.data?.id) return fail('uncertain', 'Email provider gave no message id')

    const { data: marked, error: mErr } = await db.from('mb_order_workflow')
      .update({ deposit_email_status: 'sent', deposit_email_sent_at: new Date().toISOString(), deposit_email_provider_id: result.data.id, deposit_email_last_error: null, deposit_email_failure_kind: null, updated_at: new Date().toISOString() })
      .eq('order_id', orderId).eq('deposit_email_status', 'sending').eq('deposit_email_claimed_at', nowIso)
      .select('order_id')
    if (mErr || !marked?.length) {
      // Sent, but not recorded. The claim stays 'sending'; a retry reuses the same
      // idempotency key and payload, so the provider will not deliver it twice.
      return { status: 'sending', sent: true, warning: `Deposit request sent but not recorded${mErr ? `: ${mErr.message}` : ''}. Use Retry later to record it; it will not be emailed twice.` }
    }
    return { status: 'sent', sent: true }
  } catch (e) {
    return { status: null, error: e?.message || 'Deposit request failed' }
  }
}

/**
 * Everything that happens after a client order form is signed (server-side, no browser):
 *   1. durable deposit-request marker (first, so nothing is lost if a later step fails)
 *   2. payment_status -> deposit_pending (only from none/blank, never from received/paid)
 *   3. signed copy stored as a 'contract' doc
 *   4. deposit-request email to the saved customer email
 * No signer receipt, no staff email, no supplier email.
 */
export async function completeMbSigning(db, resend, { order, request, actorLabel = 'E-signature' }) {
  const out = { queued: null, payment_status: null, signed_copy: null, email: null }
  const q = await ensureDepositQueued(db, { order, request })
  out.queued = q
  if (!depositSatisfied(order)) {
    const prev = order.payment_status ?? null
    if (prev === null || prev === 'none') {
      let upd = db.from('sales_orders').update({ payment_status: 'deposit_pending', updated_at: new Date().toISOString() }).eq('id', order.id)
      upd = order.deposit_received == null ? upd.is('deposit_received', null) : upd.eq('deposit_received', false)
      upd = prev === null ? upd.is('payment_status', null) : upd.eq('payment_status', 'none')
      const { error } = await upd
      out.payment_status = error ? { error: error.message } : 'deposit_pending'
    }
  }
  try {
    out.signed_copy = await saveMbSignedCopy(db, { order, request })
  } catch (e) {
    out.signed_copy = { error: e?.message || 'Could not store the signed copy' }
  }
  await db.from('sales_order_history').insert({
    order_id: order.id, actor_id: null, actor_name: actorLabel, action: 'client_form_signed',
    details: { request_id: request.id, doc_id: request.sales_doc_id, signed_doc_id: out.signed_copy?.doc_id || null },
  })
  if (q.status === 'queued' || q.status === 'failed') out.email = await sendDepositEmail(db, resend, { orderId: order.id })
  else out.email = { status: q.status || null, error: q.error }
  return out
}

// Non-sensitive workflow status for the order page.
export function workflowView(row) {
  if (!row) return null
  return {
    deposit_email_status: row.deposit_email_status || null,
    deposit_email_sent_at: row.deposit_email_sent_at || null,
    deposit_email_attempts: row.deposit_email_attempts || 0,
    deposit_email_last_error: row.deposit_email_status === 'failed' ? row.deposit_email_last_error : null,
    deposit_email_claimed_at: row.deposit_email_status === 'sending' ? row.deposit_email_claimed_at : null,
    deposit_receipt_source: row.deposit_receipt_source || null,
    deposit_receipt_marked_at: row.deposit_receipt_marked_at || null,
    deposit_receipt_marked_by_name: row.deposit_receipt_marked_by_name || null,
    supplier_turned_in_at: row.supplier_turned_in_at || null,
    supplier_turned_in_by_name: row.supplier_turned_in_by_name || null,
    supplier_order_row_id: row.supplier_order_row_id || null,
  }
}

// Supplier-form turn-in recorded? { turnedIn, row } or { status, error } (503 when 050 missing).
export async function supplierTurnIn(db, orderId) {
  const pf = await preflightWorkflow(db, orderId)
  if (pf.error) return pf
  return { turnedIn: !!pf.row?.supplier_turned_in_at, row: pf.row }
}

export { readWorkflow, depositSatisfied }
