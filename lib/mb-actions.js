// Metal-building workflow actions and read projections for /api/sales-orders.
// Every action: strict body, resolve the real order from its id, check the caller
// against that order, then write. Actor ids/names come from the session, never the body.

import { escapeHtml } from './email'
import { siteUrl } from './site-url'
import { todayCentral, centralDateRange } from './central-date'
import { fetchAll } from './budget-line-refs'
import { computeMbCommission, repCommissionView, toCents } from './mb-commission'
import {
  MB, isOffice, isOwner, isRepOnOrder, canWorkMbOrder, strictBody, parseMoneyInput, isUuidLike,
  sendPrerequisites, latestDoc, depositReceiptState, mbPaymentStatus, validDepositAmount,
} from './mb-orders'
import {
  SCHEMA_HINT, isMissingSchema, sha256Hex, actorName, loadMbOrder, requireMbWorker, mbRequestsForOrder,
  getPaymentInstructions, checkStoredFile, validateSignablePdf, saveMbSignedCopy, ensureDepositQueued,
  sendDepositEmail, readWorkflow, workflowView, depositSatisfied, preflightWorkflow, lockErrorMessage,
} from './mb-server'

const json = (body, status = 200) => Response.json(body, { status })
const fail = (r) => json({ error: r.error }, r.status || 500)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function history(db, orderId, auth, action, details) {
  await db.from('sales_order_history').insert({ order_id: orderId, actor_id: auth.userId, actor_name: await actorName(db, auth.userId), action, details })
}

async function supplierRow(db, supplierId) {
  if (!supplierId) return { supplier: null }
  const { data, error } = await db.from('mb_suppliers').select('id, name').eq('id', supplierId).maybeSingle()
  if (error) return { error: error.message }
  return { supplier: data || null }
}

async function orderDocs(db, orderId) {
  const { data, error } = await db.from('sales_order_docs').select('id, order_id, category, file_name, storage_path, created_at, version_number, visible_to_customer').eq('order_id', orderId)
  if (error) return { error: error.message }
  return { docs: data || [] }
}

const docSummary = d => (d ? { id: d.id, file_name: d.file_name, created_at: d.created_at, version_number: d.version_number || 1 } : null)

// ── Actions ───────────────────────────────────────────────────────────────────

async function setSupplier(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', supplier_id: 'any', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (body.supplier_id !== null && !isUuidLike(body.supplier_id)) return json({ error: 'Choose a supplier from the list.' }, 400)
  const ctx = await requireMbWorker(db, auth, body.id)
  if (ctx.error) return fail(ctx)
  const reqs = await mbRequestsForOrder(db, body.id)
  if (reqs.error) return json({ error: reqs.missingSchema ? SCHEMA_HINT : reqs.error.message }, reqs.missingSchema ? 503 : 500)
  if (reqs.pending || reqs.signed) return json({ error: 'The supplier is locked while the client order form is out for signature or signed. Cancel the pending request to change it.' }, 409)
  if (body.supplier_id) {
    const s = await supplierRow(db, body.supplier_id)
    if (s.error) return json({ error: s.error }, 500)
    if (!s.supplier) return json({ error: 'That supplier does not exist.' }, 400)
  }
  const { error } = await db.from('sales_orders').update({ supplier_id: body.supplier_id, updated_at: new Date().toISOString() }).eq('id', body.id)
  if (error) { const locked = lockErrorMessage(error); return json({ error: locked || error.message }, locked ? 409 : 500) }
  await history(db, body.id, auth, 'supplier_selected', { supplier_id: body.supplier_id })
  return json({ ok: true })
}

async function sendForSignature(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', doc_id: 'string', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  const ctx = await requireMbWorker(db, auth, body.id)
  if (ctx.error) return fail(ctx)
  const { order } = ctx
  const reqs = await mbRequestsForOrder(db, order.id)
  if (reqs.error) return json({ error: reqs.missingSchema ? SCHEMA_HINT : reqs.error.message }, reqs.missingSchema ? 503 : 500)
  if (reqs.signed) return json({ error: 'The client order form is already signed.' }, 409)
  // Completion needs the workflow table; fail before a request exists if it is missing.
  const pf = await preflightWorkflow(db, order.id)
  if (pf.error) return json({ error: pf.error }, pf.status)
  const settings = await getPaymentInstructions(db)
  if (settings.error) return json({ error: settings.error }, settings.missingSchema ? 503 : 500)
  const d = await orderDocs(db, order.id)
  if (d.error) return json({ error: d.error }, 500)
  const s = await supplierRow(db, order.supplier_id)
  if (s.error) return json({ error: s.error }, 500)

  let clientForm
  if (body.doc_id !== undefined) {
    clientForm = d.docs.find(x => x.id === body.doc_id)
    if (!clientForm || clientForm.category !== 'client_order_form') return json({ error: 'That document is not a client order form on this order.' }, 400)
  } else clientForm = latestDoc(d.docs, 'client_order_form')
  const supplierForm = latestDoc(d.docs, 'supplier_order_form')

  const pre = sendPrerequisites({ order, supplier: s.supplier, supplierForm, clientForm, paymentInstructionsConfigured: settings.configured, signedRequest: reqs.signed })
  if (!pre.ok) {
    const missing = pre.items.filter(i => !i.ok)
    return json({ error: `Not ready to send: ${missing.map(i => i.fix).join(' ')}`, missing }, 422)
  }
  const signerEmail = String(order.customer_email).trim().toLowerCase()
  const signerName = String(order.customer_name).trim()

  // Idempotent: the same pending request (same form, amount, customer, supplier) is returned again.
  if (reqs.pending) {
    const p = reqs.pending
    const same = p.sales_doc_id === clientForm.id && Number(p.deposit_amount_snapshot) === Number(order.deposit_amount) &&
      String(p.signer_email || '').toLowerCase() === signerEmail && (p.signer_name || '') === signerName && p.mb_supplier_id === order.supplier_id
    if (same && p.token) return json({ ok: true, reused: true, request_id: p.id, sign_url: siteUrl(`sign?token=${encodeURIComponent(p.token)}`) })
    return json({ error: 'A different signature request is already out for this order. Cancel it first, then send again.' }, 409)
  }

  const sf = await checkStoredFile(db, supplierForm.storage_path)
  if (sf.error) return json({ error: `The supplier's order form file is missing from storage (${sf.error}). Upload it again.` }, 422)
  const cf = await checkStoredFile(db, clientForm.storage_path)
  if (cf.error) return json({ error: `The client order form file is missing from storage (${cf.error}). Upload it again.` }, 422)
  const pdf = await validateSignablePdf(cf.bytes)
  if (pdf.error) return json({ error: pdf.error }, 422)
  const sha = sha256Hex(cf.bytes)
  const title = `Order form — ${order.order_number || 'Metal building'}`

  // Re-read the order immediately before the insert: the snapshot must match what is
  // stored now. (The DB insert trigger from migration 050 re-checks this under a row
  // lock, and the unique pending/signed indexes stop a second request.)
  const { data: fresh, error: frErr } = await db.from('sales_orders').select('id, division, stage, deposit_amount, customer_email, customer_name, supplier_id').eq('id', order.id).maybeSingle()
  if (frErr) return json({ error: frErr.message }, 500)
  if (!fresh || fresh.division !== MB) return json({ error: 'Order not found' }, 404)
  if (toCents(fresh.deposit_amount) !== toCents(order.deposit_amount) || String(fresh.customer_email || '').trim().toLowerCase() !== signerEmail ||
      String(fresh.customer_name || '').trim() !== signerName || (fresh.supplier_id || null) !== (order.supplier_id || null) || fresh.stage === 'cancelled') {
    return json({ error: 'The order changed while the signature request was being prepared. Reload the page and send again.' }, 409)
  }

  const { data: row, error } = await db.from('signing_requests').insert({
    job_id: null,
    subcontract_id: null,
    sales_order_id: order.id,
    sales_doc_id: clientForm.id,
    document_storage_path: clientForm.storage_path,
    document_file_name: clientForm.file_name,
    document_sha256: sha,
    deposit_amount_snapshot: Number(fresh.deposit_amount),
    mb_supplier_id: fresh.supplier_id,
    signer_email: signerEmail,
    signer_name: signerName,
    document_title: title,
    // Text only: the signer sees the pinned PDF itself (served by token, hash-checked).
    document_html: `<p>${escapeHtml(title)}: ${escapeHtml(clientForm.file_name)} (PDF, SHA-256 ${sha}).</p>`,
    created_by: auth.userId,
  }).select('id, token').single()
  if (error) {
    if (isMissingSchema(error)) return json({ error: SCHEMA_HINT }, 503)
    if (String(error.code) === '23505') return json({ error: 'Another signature request was just created for this order. Reload the page.' }, 409)
    const locked = lockErrorMessage(error)
    if (locked) return json({ error: locked }, 409)
    return json({ error: error.message }, 500)
  }
  if (!row?.token) return json({ error: 'The signing link could not be created.' }, 500)
  await history(db, order.id, auth, 'sent_for_signature', { request_id: row.id, doc_id: clientForm.id })
  return json({ ok: true, request_id: row.id, sign_url: siteUrl(`sign?token=${encodeURIComponent(row.token)}`) })
}

async function voidSignature(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  const ctx = await requireMbWorker(db, auth, body.id)
  if (ctx.error) return fail(ctx)
  const { data, error } = await db.from('signing_requests').update({ status: 'voided' }).eq('sales_order_id', body.id).eq('status', 'pending').select('id')
  if (error) return json({ error: isMissingSchema(error) ? SCHEMA_HINT : error.message }, 500)
  if (!data?.length) return json({ error: 'There is no pending signature request (it may already be signed).' }, 409)
  await history(db, body.id, auth, 'signature_request_cancelled', { request_ids: data.map(r => r.id) })
  return json({ ok: true })
}

async function retryCompletion(db, resend, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', force_uncertain: 'boolean', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (!isOffice(auth.role)) return json({ error: 'Only office staff can retry the deposit request.' }, 403)
  if (body.force_uncertain && !isOwner(auth.role)) return json({ error: 'Only the Owner can force a resend.' }, 403)
  const ctx = await loadMbOrder(db, body.id)
  if (ctx.error) return fail(ctx)
  const reqs = await mbRequestsForOrder(db, body.id)
  if (reqs.error) return json({ error: reqs.missingSchema ? SCHEMA_HINT : reqs.error.message }, reqs.missingSchema ? 503 : 500)
  if (!reqs.signed) return json({ error: 'The client order form has not been signed yet.' }, 409)
  const pf = await preflightWorkflow(db, body.id)
  if (pf.error) return json({ error: pf.error }, pf.status)
  const settings = await getPaymentInstructions(db)
  if (settings.missingSchema) return json({ error: SCHEMA_HINT }, 503)
  const q = await ensureDepositQueued(db, { order: ctx.order, request: reqs.signed })
  if (q.error) return json({ error: q.error }, q.error === SCHEMA_HINT ? 503 : 500)
  const copy = await saveMbSignedCopy(db, { order: ctx.order, request: reqs.signed })
  const email = await sendDepositEmail(db, resend, { orderId: body.id, retry: true, forceUncertain: !!body.force_uncertain })
  await history(db, body.id, auth, 'deposit_request_retry', { status: email.status || null })
  return json({ ok: !email.error, email, signed_copy: copy.error ? { error: copy.error } : { ok: true } }, email.error ? 502 : 200)
}

async function recordDeposit(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', received: 'boolean', received_date: 'string', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (typeof body.received !== 'boolean') return json({ error: 'received must be true or false.' }, 400)
  if (!isOffice(auth.role)) return json({ error: 'Only office staff can record a deposit.' }, 403)
  if (body.received_date !== undefined && !DATE_RE.test(body.received_date)) return json({ error: 'received_date must be YYYY-MM-DD.' }, 400)
  const ctx = await loadMbOrder(db, body.id)
  if (ctx.error) return fail(ctx)
  const { order } = ctx
  // Schema preflight: if migration 050 is missing, nothing on sales_orders changes.
  const pf = await preflightWorkflow(db, order.id)
  if (pf.error) return json({ error: pf.error }, pf.status)
  const { data: payments, error: pErr } = await db.from('sales_order_payments').select('payment_type, amount, payment_date').eq('order_id', order.id)
  if (pErr) return json({ error: pErr.message }, 500)
  const reqs = await mbRequestsForOrder(db, order.id)
  if (reqs.error) return json({ error: reqs.missingSchema ? SCHEMA_HINT : reqs.error.message }, reqs.missingSchema ? 503 : 500)
  const hasSigned = !!reqs.signed
  const nowIso = new Date().toISOString()
  const who = await actorName(db, auth.userId)

  if (body.received) {
    if (!validDepositAmount(order.deposit_amount)) return json({ error: 'Save a deposit amount (more than $0) before marking it received.' }, 400)
    if (order.deposit_received === true) {
      const h = await ensureReceiptSnapshot(db, order.id, nowIso)
      if (h.error) return json({ error: h.error }, h.status || 500)
      return json({ ok: true, already: true })
    }
    const status = mbPaymentStatus({ payments, contractValue: order.contract_value, depositReceived: true, hasSignedRequest: hasSigned })
    const won = await winReceipt(db, order, { deposit_received_date: body.received_date || todayCentral(), payment_status: status, updated_at: nowIso })
    if (won.error) return json({ error: won.error }, won.status || 500)
    if (!won.won) {
      if (won.current?.deposit_received !== true) return json({ error: 'The deposit amount changed to $0 or blank while the receipt was being recorded. Save a deposit amount (more than $0) and try again.' }, 409)
      const h = await ensureReceiptSnapshot(db, order.id, nowIso)
      if (h.error) return json({ error: h.error }, h.status || 500)
      return json({ ok: true, already: true })
    }
    const marker = { deposit_receipt_source: 'checkbox', deposit_receipt_marked_at: nowIso, deposit_receipt_marked_by: auth.userId, deposit_receipt_marked_by_name: who, updated_at: nowIso }
    const w = await writeReceiptMarker(db, order, pf.row, marker, won.amount, nowIso)
    if (w.error) return json({ error: `The deposit was not recorded: ${w.error}` }, 500)
    await history(db, order.id, auth, 'deposit_marked_received', { source: 'checkbox', date: body.received_date || todayCentral() })
    return json({ ok: true, payment_status: status })
  }

  if (order.deposit_received !== true) return json({ ok: true, already: true })
  if (depositReceiptState(order, payments).full) return json({ error: 'Recorded deposit payments cover the deposit. Record a refund first if the deposit was returned.' }, 409)
  const status = mbPaymentStatus({ payments, contractValue: order.contract_value, depositReceived: false, hasSignedRequest: hasSigned })
  const { error } = await db.from('sales_orders').update({ deposit_received: false, deposit_received_date: null, payment_status: status, updated_at: nowIso }).eq('id', order.id).eq('deposit_received', true)
  if (error) return json({ error: error.message }, 500)
  const cleared = await clearReceiptSnapshot(db, order.id, nowIso)
  await history(db, order.id, auth, 'deposit_unmarked', {})
  return json({ ok: true, payment_status: status, ...(cleared.error ? { warning: `Deposit un-marked; the received-amount snapshot was not cleared: ${cleared.error}` } : {}) })
}

// Flip deposit_received false/null -> true. Only one caller can win, and only while the
// stored deposit_amount is > 0 (a concurrent edit to 0/blank cannot win the flip). The
// winner gets the deposit_amount as stored at that moment (the authoritative received amount).
// Returns:
//   { won: true, amount }         this caller flipped it (amount is valid)
//   { won: false, current }       nothing flipped; current = the live row (someone else
//                                  marked it, or the amount is no longer valid)
//   { error, status }             (a won flip with an invalid amount is rolled back first)
async function winReceipt(db, order, patch) {
  let mark = db.from('sales_orders').update({ deposit_received: true, ...patch }).eq('id', order.id).gt('deposit_amount', 0)
  mark = order.deposit_received == null ? mark.is('deposit_received', null) : mark.eq('deposit_received', false)
  const { data, error } = await mark.select('id, deposit_amount')
  if (error) return { error: error.message, status: 500 }
  if (data?.length) {
    const amount = data[0].deposit_amount
    if (validDepositAmount(amount)) return { won: true, amount }
    // Defensive (the UPDATE filter should make this impossible): never keep a receipt we cannot snapshot.
    const rb = await rollbackReceipt(db, order)
    return { error: rb.error ? `the deposit amount is not valid and the receipt could not be rolled back (${rb.error}). The order shows "received" without its snapshot; the Owner must review it.` : 'The deposit amount changed to $0 or blank while the receipt was being recorded. Save a deposit amount (more than $0) and try again.', status: rb.error ? 500 : 409 }
  }
  const { data: current, error: rErr } = await db.from('sales_orders').select('id, deposit_received, deposit_amount').eq('id', order.id).maybeSingle()
  if (rErr) return { error: rErr.message, status: 500 }
  return { won: false, current: current || null }
}

// Undo a receipt flip this caller made; verify it actually landed.
async function rollbackReceipt(db, order) {
  const { data, error } = await db.from('sales_orders')
    .update({ deposit_received: order.deposit_received ?? false, deposit_received_date: order.deposit_received_date ?? null, payment_status: order.payment_status ?? null, updated_at: new Date().toISOString() })
    .eq('id', order.id).eq('deposit_received', true).select('id')
  if (error) return { error: error.message }
  if (data?.length) return {}
  const { data: cur, error: rErr } = await db.from('sales_orders').select('deposit_received').eq('id', order.id).maybeSingle()
  if (rErr) return { error: rErr.message }
  return cur?.deposit_received === true ? { error: 'the receipt is still marked received' } : {}
}

// Someone else holds the receipt (received=true). A healthy receipt has its snapshot.
// A receipt without one is healed only from the still-valid, locked deposit_amount
// (the 050 guard stops it changing once received); otherwise the inconsistency is surfaced.
// Returns {} (healthy or healed) or { error, status }.
async function ensureReceiptSnapshot(db, orderId, nowIso) {
  const { data: o, error: oErr } = await db.from('sales_orders').select('id, deposit_received, deposit_amount').eq('id', orderId).maybeSingle()
  if (oErr) return { error: oErr.message, status: 500 }
  if (o?.deposit_received !== true) return {}
  const wf = await readWorkflow(db, orderId)
  if (wf.error) return { error: wf.error, status: wf.missingSchema ? 503 : 500 }
  if (validDepositAmount(wf.row?.deposit_received_amount)) return {}
  if (!validDepositAmount(o.deposit_amount)) {
    return { error: 'This deposit is marked received but has no recorded received amount, and the deposit amount is not valid. The Owner must review it (un-mark and record it again).', status: 409 }
  }
  const snap = { deposit_received_amount: o.deposit_amount, deposit_received_amount_at: nowIso, updated_at: nowIso }
  const res = wf.row
    ? await db.from('mb_order_workflow').update(snap).eq('order_id', orderId).is('deposit_received_amount', null).select('order_id')
    : await db.from('mb_order_workflow').insert({ order_id: orderId, deposit_email_attempts: 0, deposit_email_key_gen: 0, ...snap }).select('order_id')
  if (res.error) {
    // Lost an insert race? Accept only if a snapshot now exists.
    const again = await readWorkflow(db, orderId)
    if (validDepositAmount(again.row?.deposit_received_amount)) return {}
    return { error: `This deposit is marked received but its received amount could not be recorded: ${res.error.message}`, status: 500 }
  }
  // The heal decided on a receipt that was live when it started; if a refund/un-mark
  // cleared it while this snapshot was being written, the snapshot is now an orphan.
  if (res.data?.length) {
    const g = await dropSnapshotIfNotReceived(db, orderId, snap)
    if (g.error) return { error: g.error, status: 500 }
  }
  return {}
}

// A received-amount snapshot exists if either column is set.
const hasSnapshot = row => !!row && (row.deposit_received_amount != null || row.deposit_received_amount_at != null)

// Compare-and-swap clear of exactly the snapshot `snap` (as read or as written), so a
// newer snapshot from a later receipt winner (different amount_at) is never wiped.
async function clearSnapshotExactly(db, orderId, snap, nowIso = new Date().toISOString()) {
  let q = db.from('mb_order_workflow').update({ deposit_received_amount: null, deposit_received_amount_at: null, updated_at: nowIso }).eq('order_id', orderId)
  q = snap.deposit_received_amount == null ? q.is('deposit_received_amount', null) : q.eq('deposit_received_amount', snap.deposit_received_amount)
  q = snap.deposit_received_amount_at == null ? q.is('deposit_received_amount_at', null) : q.eq('deposit_received_amount_at', snap.deposit_received_amount_at)
  const { data, error } = await q.select('order_id')
  return error ? { error: error.message } : { cleared: !!data?.length }
}

// After writing a received-amount snapshot, re-read the LIVE receipt. If the order is no
// longer received (a refund/un-mark cleared it while this snapshot was in flight, and its
// own snapshot clear ran before the snapshot existed), remove the snapshot just written.
async function dropSnapshotIfNotReceived(db, orderId, snap) {
  const { data: live, error } = await db.from('sales_orders').select('deposit_received').eq('id', orderId).maybeSingle()
  if (error) return { error: `the received amount was recorded but the receipt could not be re-checked: ${error.message}` }
  if (live?.deposit_received === true) return {}
  const c = await clearSnapshotExactly(db, orderId, snap)
  if (c.error) return { error: `the deposit is no longer received but its received-amount snapshot could not be cleared: ${c.error}` }
  return { dropped: true }
}

// Record the receipt marker + received-amount snapshot (written only by the caller that
// won the receipt transition). On failure the receipt is reverted (and the revert is
// verified) so sales_orders never says "received" without its snapshot.
async function writeReceiptMarker(db, order, wfRow, marker, amount, nowIso) {
  const snap = { deposit_received_amount: amount, deposit_received_amount_at: nowIso }
  const upd = () => db.from('mb_order_workflow').update({ ...marker, ...snap }).eq('order_id', order.id)
  let res = wfRow ? await upd() : await db.from('mb_order_workflow').insert({ order_id: order.id, deposit_email_attempts: 0, deposit_email_key_gen: 0, ...marker, ...snap })
  // The workflow row appeared since it was read (e.g. a concurrent signing): update it instead.
  if (res.error && !wfRow && String(res.error.code) === '23505') res = await upd()
  if (res.error) {
    const rb = await rollbackReceipt(db, order)
    if (rb.error) return { error: `${res.error.message}. Rolling the receipt back also failed (${rb.error}); the order shows "received" without its received amount. The Owner must review it.`, rollbackFailed: true }
    return { error: res.error.message }
  }
  // A concurrent refund/un-mark may have cleared the receipt between the flip and this
  // write (its snapshot clear then found nothing): never leave the snapshot behind.
  const g = await dropSnapshotIfNotReceived(db, order.id, snap)
  if (g.error) return { error: g.error }
  if (g.dropped) return { dropped: true }
  // A queued/failed deposit request is no longer needed.
  await db.from('mb_order_workflow').update({ deposit_email_status: 'not_needed', updated_at: nowIso }).eq('order_id', order.id).eq('deposit_email_status', 'queued')
  await db.from('mb_order_workflow').update({ deposit_email_status: 'not_needed', updated_at: nowIso }).eq('order_id', order.id).eq('deposit_email_status', 'failed')
  return {}
}

// convert_lead (MB, office): carry a lead's verified "deposit received" onto the new
// order. The order is inserted NOT received; this flips it and writes the snapshot in
// the same request. Returns {} or { error, status, rollbackFailed? } (on error the
// receipt has been rolled back, unless rollbackFailed).
export async function carryLeadReceipt(db, auth, order) {
  const nowIso = new Date().toISOString()
  const won = await winReceipt(db, order, { updated_at: nowIso })
  if (won.error) return { error: won.error, status: won.status || 500 }
  if (!won.won) return { error: 'The deposit amount is not valid, so the receipt could not be carried over.', status: 409 }
  const marker = { deposit_receipt_source: 'checkbox', deposit_receipt_marked_at: nowIso, deposit_receipt_marked_by: auth.userId, deposit_receipt_marked_by_name: await actorName(db, auth.userId), updated_at: nowIso }
  const w = await writeReceiptMarker(db, order, null, marker, won.amount, nowIso)
  if (w.error) return { error: w.error, status: 500, rollbackFailed: !!w.rollbackFailed }
  return {}
}

async function clearReceiptSnapshot(db, orderId, nowIso) {
  const { error } = await db.from('mb_order_workflow').update({ deposit_received_amount: null, deposit_received_amount_at: null, updated_at: nowIso }).eq('order_id', orderId)
  return error ? { error: error.message } : {}
}

async function turnInSupplierForm(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (!isOffice(auth.role)) return json({ error: 'Only office staff or the Owner can turn in the supplier order form.' }, 403)
  const ctx = await loadMbOrder(db, body.id)
  if (ctx.error) return fail(ctx)
  const { order } = ctx
  const reqs = await mbRequestsForOrder(db, order.id)
  if (reqs.error) return json({ error: reqs.missingSchema ? SCHEMA_HINT : reqs.error.message }, reqs.missingSchema ? 503 : 500)
  if (!reqs.signed) return json({ error: 'The client order form must be signed first.' }, 409)
  const wf = await preflightWorkflow(db, order.id)
  if (wf.error) return json({ error: wf.error }, wf.status)
  const st = wf.row?.deposit_email_status
  if (!['queued', 'sending', 'sent', 'not_needed'].includes(st)) {
    return json({ error: st === 'failed' ? 'The deposit request email failed. Retry it before turning in the supplier form.' : 'The deposit request has not been queued yet. Use Retry deposit request first.' }, 409)
  }
  const s = await supplierRow(db, order.supplier_id)
  if (s.error) return json({ error: s.error }, 500)
  if (!s.supplier) return json({ error: 'Choose the supplier first.' }, 409)
  const d = await orderDocs(db, order.id)
  if (d.error) return json({ error: d.error }, 500)
  const form = latestDoc(d.docs, 'supplier_order_form')
  if (!form) return json({ error: "Upload the supplier's order form first." }, 409)
  const stored = await checkStoredFile(db, form.storage_path)
  if (stored.error) return json({ error: `The supplier's order form file is missing from storage (${stored.error}).` }, 409)

  const nowIso = new Date().toISOString()
  const who = await actorName(db, auth.userId)
  const { data: won, error } = await db.from('mb_order_workflow')
    .update({ supplier_turned_in_at: nowIso, supplier_turned_in_by: auth.userId, supplier_turned_in_by_name: who, supplier_turned_in_supplier_id: s.supplier.id, supplier_turned_in_doc_id: form.id, updated_at: nowIso })
    .eq('order_id', order.id).is('supplier_turned_in_at', null).select('*')
  if (error) return json({ error: error.message }, 500)
  const fresh = won?.[0] || (await readWorkflow(db, order.id)).row
  const already = !won?.length
  let warning = null
  if (fresh && !fresh.supplier_order_row_id && !already) {
    const { data: so, error: soErr } = await db.from('sales_supplier_orders').insert({
      order_id: order.id, supplier_id: s.supplier.id, supplier_name: s.supplier.name, status: 'submitted',
      ordered_at: fresh.supplier_turned_in_at, created_by: auth.userId, created_by_name: who,
    }).select('id').single()
    if (soErr) warning = `Turn-in recorded, but the purchasing row was not created: ${soErr.message}`
    else await db.from('mb_order_workflow').update({ supplier_order_row_id: so.id }).eq('order_id', order.id).is('supplier_order_row_id', null)
    await history(db, order.id, auth, 'supplier_form_turned_in', { supplier_id: s.supplier.id, doc_id: form.id })
  }
  return json({ ok: true, already, turned_in_at: fresh?.supplier_turned_in_at, turned_in_by_name: fresh?.supplier_turned_in_by_name, ...(warning ? { warning } : {}) })
}

async function saveConcrete(db, auth, body) {
  const bad = strictBody(body, { action: 'string', id: 'string', concrete_charge: 'nullable-money', concrete_cost: 'nullable-money', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (!isOwner(auth.role)) return json({ error: 'Only the Owner can enter concrete amounts.' }, 403)
  if (!('concrete_charge' in body) || !('concrete_cost' in body)) return json({ error: 'Send both concrete_charge and concrete_cost (null to clear).' }, 400)
  const ch = parseMoneyInput(body.concrete_charge, 'Concrete charge')
  if (ch.error) return json({ error: ch.error }, 400)
  const co = parseMoneyInput(body.concrete_cost, 'Concrete cost')
  if (co.error) return json({ error: co.error }, 400)
  const ctx = await loadMbOrder(db, body.id)
  if (ctx.error) return fail(ctx)
  const nowIso = new Date().toISOString()
  const { data: cur, error: rErr } = await db.from('mb_order_private').select('order_id').eq('order_id', body.id).maybeSingle()
  if (rErr) return json({ error: isMissingSchema(rErr) ? SCHEMA_HINT : rErr.message }, isMissingSchema(rErr) ? 503 : 500)
  const row = { concrete_charge: ch.value, concrete_cost: co.value, updated_at: nowIso, updated_by: auth.userId }
  const { error } = cur
    ? await db.from('mb_order_private').update(row).eq('order_id', body.id)
    : await db.from('mb_order_private').insert({ order_id: body.id, ...row })
  if (error) return json({ error: error.message }, 500)
  await history(db, body.id, auth, 'concrete_updated', {}) // amounts deliberately not in history
  return json({ ok: true })
}

async function saveSettings(db, auth, body) {
  const bad = strictBody(body, { action: 'string', payment_instructions: 'string', actor_name: 'any' })
  if (bad) return json({ error: bad }, 400)
  if (!isOwner(auth.role)) return json({ error: 'Only the Owner can edit payment instructions.' }, 403)
  const text = typeof body.payment_instructions === 'string' ? body.payment_instructions.replace(/\r\n/g, '\n').trim() : ''
  if (!text) return json({ error: 'Enter the payment instructions (check, ACH and/or mailing address).' }, 400)
  if (text.length > 4000) return json({ error: 'Payment instructions are limited to 4000 characters.' }, 400)
  const nowIso = new Date().toISOString()
  const { data: cur, error: rErr } = await db.from('company_payment_settings').select('id').eq('id', 1).maybeSingle()
  if (rErr) return json({ error: isMissingSchema(rErr) ? SCHEMA_HINT : rErr.message }, isMissingSchema(rErr) ? 503 : 500)
  const row = { payment_instructions: text, updated_at: nowIso, updated_by: auth.userId, updated_by_name: await actorName(db, auth.userId) }
  const { error } = cur
    ? await db.from('company_payment_settings').update(row).eq('id', 1)
    : await db.from('company_payment_settings').insert({ id: 1, ...row })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, configured: true })
}

export async function handleMbAction(db, resend, auth, body) {
  switch (body?.action) {
    case 'mb_set_supplier': return setSupplier(db, auth, body)
    case 'mb_send_for_signature': return sendForSignature(db, auth, body)
    case 'mb_void_signature': return voidSignature(db, auth, body)
    case 'mb_retry_completion': return retryCompletion(db, resend, auth, body)
    case 'mb_record_deposit': return recordDeposit(db, auth, body)
    case 'mb_turn_in_supplier_form': return turnInSupplierForm(db, auth, body)
    case 'mb_save_concrete': return saveConcrete(db, auth, body)
    case 'mb_save_settings': return saveSettings(db, auth, body)
    default: return json({ error: 'Unknown action' }, 400)
  }
}

// After a payment is recorded on an MB order. Receipt follows amount due vs net deposit
// receipts/refunds (depositReceiptState):
//   - net covers the amount due            -> deposit received (snapshot taken once)
//   - receipt came from payments and net no longer covers it -> receipt cleared
//   - checkbox (or legacy) receipt: kept, unless refunds now leave net short -> cleared
// Clearing drops deposit_received (so the commission deposit leg goes to $0) and the
// snapshot. No synthetic payment is ever created. Returns { payment_status, ... } or { error, status }.
//
// Receipt state is NEVER taken from the caller's (possibly stale) order: the live
// sales_orders row and workflow row are re-read AFTER the current payments are loaded,
// so a deposit that landed concurrently is seen and a refund still clears it. The
// returned deposit_received is the stored flag after this call.
//
// Reconcile loop: load payments + live order + workflow, compute the desired receipt
// state, apply AT MOST ONE transition, then re-load and repeat until the stored state
// matches what the current payments call for. A decision is never acted on twice and
// never reported from memory: a refund that lands between "decide received" and the
// receipt flip is seen on the next pass and the receipt + snapshot are cleared again.
// When the stored state is received, its snapshot is verified (healed from the locked,
// still-valid deposit amount, or the inconsistency is surfaced as 409/500).
const SYNC_MAX_PASSES = 5

async function loadSyncState(db, orderId) {
  const { data: payments, error } = await db.from('sales_order_payments').select('payment_type, amount, payment_date').eq('order_id', orderId)
  if (error) return { error: error.message }
  // Workflow is read BEFORE the order: a receipt winner flips the order first and writes
  // the snapshot second, so a snapshot seen here next to a not-received order is an
  // orphan (a newer one written later has a different amount_at and survives the CAS clear).
  const wf = await readWorkflow(db, orderId)
  if (wf.error) return { error: wf.error, status: wf.missingSchema ? 503 : 500 }
  const { data: order, error: oErr } = await db.from('sales_orders')
    .select('id, division, deposit_received, deposit_amount, deposit_received_date, payment_status, contract_value').eq('id', orderId).maybeSingle()
  if (oErr) return { error: oErr.message }
  if (!order) return { error: 'Order not found', status: 404 }
  const st = depositReceiptState(order, payments)
  const positive = t => (payments || []).some(p => p.payment_type === t && Number(p.amount) > 0)
  const hasDepositRows = positive('deposit') || positive('refund')
  const wasReceived = order.deposit_received === true
  const source = wf.row?.deposit_receipt_source || null
  let nextReceived = wasReceived || st.full
  if (wasReceived && !st.full && hasDepositRows && (source === 'payments' || positive('refund'))) nextReceived = false
  return { payments, order, wfRow: wf.row, st, wasReceived, nextReceived }
}

export async function syncMbPayment(db, orderOrId) {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId?.id
  const pf = await preflightWorkflow(db, orderId)
  if (pf.error) return { error: pf.error, status: pf.status }
  const reqs = await mbRequestsForOrder(db, orderId)
  if (reqs.error && !reqs.missingSchema) return { error: reqs.error.message }
  const hasSignedRequest = !!reqs.signed

  let initialReceived = null
  for (let pass = 0; pass < SYNC_MAX_PASSES; pass++) {
    const s = await loadSyncState(db, orderId)
    if (s.error) return { error: s.error, status: s.status }
    const { payments, order, wfRow, st, wasReceived, nextReceived } = s
    if (initialReceived === null) initialReceived = wasReceived
    const nowIso = new Date().toISOString()
    const status = mbPaymentStatus({ payments, contractValue: order.contract_value, depositReceived: nextReceived, hasSignedRequest })

    if (!wasReceived && nextReceived) {
      const won = await winReceipt(db, order, { deposit_received_date: order.deposit_received_date || st.latest_deposit_date || todayCentral(), payment_status: status, updated_at: nowIso })
      if (won.error) return { error: won.error, status: won.status }
      if (won.won) {
        const w = await writeReceiptMarker(db, order, wfRow, { deposit_receipt_source: 'payments', deposit_receipt_marked_at: nowIso, updated_at: nowIso }, won.amount, nowIso)
        if (w.error) return { error: `the deposit receipt was not recorded: ${w.error}` }
      }
      continue // re-check against the payments as they are NOW
    }
    if (wasReceived && !nextReceived) {
      const { data, error: cErr } = await db.from('sales_orders')
        .update({ deposit_received: false, deposit_received_date: null, payment_status: status, updated_at: nowIso })
        .eq('id', orderId).eq('deposit_received', true).select('id')
      if (cErr) return { error: cErr.message }
      if (data?.length) {
        const c = await clearReceiptSnapshot(db, orderId, nowIso)
        if (c.error) return { error: `the deposit receipt was cleared but its snapshot was not: ${c.error}` }
      }
      continue
    }

    // Stable: the stored receipt matches the current payments.
    if (wasReceived) {
      // A receipt without its snapshot is not healthy: heal it or surface it.
      const h = await ensureReceiptSnapshot(db, orderId, nowIso)
      if (h.error) return { error: h.error, status: h.status || 500 }
    } else if (hasSnapshot(wfRow)) {
      // Not received, yet a received-amount snapshot remains (written after a concurrent
      // clear): remove exactly that snapshot, then re-check.
      const c = await clearSnapshotExactly(db, orderId, wfRow, nowIso)
      if (c.error) return { error: `the deposit is not received but its received-amount snapshot could not be cleared: ${c.error}` }
      continue
    }
    const { error: uErr } = await db.from('sales_orders').update({ payment_status: status, updated_at: nowIso }).eq('id', orderId)
    if (uErr) return { error: uErr.message }
    const after = await loadSyncState(db, orderId)
    if (after.error) return { error: after.error, status: after.status }
    // Something changed underneath the status write: reconcile again.
    if (after.wasReceived !== wasReceived || after.nextReceived !== after.wasReceived) continue
    if (!after.wasReceived && hasSnapshot(after.wfRow)) continue
    // The stored payment_status must match what the payments + receipt call for NOW (a
    // concurrent payment may have landed after `status` was computed, or overwritten it).
    const fresh = mbPaymentStatus({ payments: after.payments, contractValue: after.order.contract_value, depositReceived: after.wasReceived, hasSignedRequest })
    if ((after.order.payment_status ?? null) !== (fresh ?? null)) continue
    return { payment_status: fresh, deposit_received: after.wasReceived, receipt_cleared: initialReceived === true && !after.wasReceived, deposit: after.st }
  }
  return { error: 'The deposit receipt kept changing while this payment was being recorded. Reload the order and check the deposit.', status: 409 }
}

// ── Read projections ─────────────────────────────────────────────────────────

async function concreteFor(db, orderIds) {
  const out = new Map()
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200)
    const { data, error } = await fetchAll(() => db.from('mb_order_private').select('order_id, concrete_charge, concrete_cost').in('order_id', chunk).order('order_id'))
    if (error) return { error }
    for (const r of data || []) out.set(r.order_id, r)
  }
  return { map: out }
}

// Received-amount snapshots (mb_order_workflow.deposit_received_amount) by order id.
async function receivedSnapshotsFor(db, orderIds) {
  const out = new Map()
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200)
    const { data, error } = await fetchAll(() => db.from('mb_order_workflow').select('order_id, deposit_received_amount').in('order_id', chunk).order('order_id'))
    if (error) return { error }
    for (const r of data || []) out.set(r.order_id, r.deposit_received_amount)
  }
  return { map: out }
}

async function attributionFor(db, orderIds) {
  const out = new Map()
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200)
    const { data, error } = await fetchAll(() => db.from('sales_attribution').select('id, order_id, salesperson_id, salesperson_name, share_pct').in('order_id', chunk).order('id'))
    if (error) return { error }
    for (const r of data || []) { if (!out.has(r.order_id)) out.set(r.order_id, []); out.get(r.order_id).push(r) }
  }
  return { map: out }
}

// The MB block added to the single-order GET.
export async function mbDetailProjection(db, auth, order, docs, attribution) {
  const can = canWorkMbOrder(auth, order, attribution)
  const out = {
    can_work: can, is_office: isOffice(auth.role), is_owner: isOwner(auth.role),
    schema_missing: false, errors: [],
  }
  const s = await supplierRow(db, order.supplier_id)
  out.supplier = s.supplier || null
  const supplierForm = latestDoc(docs, 'supplier_order_form')
  const clientForm = latestDoc(docs, 'client_order_form')
  out.forms = { supplier: docSummary(supplierForm), client: docSummary(clientForm) }

  const settings = await getPaymentInstructions(db)
  if (settings.missingSchema) out.schema_missing = true
  out.payment_instructions_configured = !!settings.configured

  const reqs = await mbRequestsForOrder(db, order.id)
  if (reqs.error) { if (reqs.missingSchema) out.schema_missing = true; else out.errors.push('signing') }
  const latest = reqs.rows?.[0] || null
  out.signing = latest ? {
    request_id: latest.id, status: latest.status, created_at: latest.created_at, signed_at: latest.signed_at,
    doc_id: latest.sales_doc_id, file_name: latest.document_file_name, signed_doc_id: latest.signed_doc_id || null,
    sign_url: can && latest.status === 'pending' && latest.token ? siteUrl(`sign?token=${encodeURIComponent(latest.token)}`) : null,
  } : null
  out.prerequisites = sendPrerequisites({ order, supplier: out.supplier, supplierForm, clientForm, paymentInstructionsConfigured: settings.configured, signedRequest: reqs.signed })

  const wf = await readWorkflow(db, order.id)
  if (wf.error) out.schema_missing = true
  out.workflow = can || isOffice(auth.role) ? workflowView(wf.row) : null
  out.recovery_needed = !!(reqs.signed && (!wf.row?.deposit_email_status || wf.row.deposit_email_status === 'failed' || !reqs.signed.signed_doc_id))

  // Commission: Owner full; a rep on the order sees only their own dollars; others nothing.
  out.commission = null
  out.concrete = null
  const ownerView = isOwner(auth.role)
  const repView = auth.role === 'metal_rep' && isRepOnOrder(auth.userId, order, attribution)
  if (ownerView || repView) {
    const c = await concreteFor(db, [order.id])
    if (c.error) { if (isMissingSchema(c.error)) out.schema_missing = true; else out.errors.push('concrete') }
    else {
      const conc = c.map.get(order.id) || null
      const full = computeMbCommission(order, conc, attribution, { receivedAmount: wf.row?.deposit_received_amount })
      if (ownerView) {
        out.commission = { scope: 'owner', ...full }
        out.concrete = { concrete_charge: conc?.concrete_charge ?? null, concrete_cost: conc?.concrete_cost ?? null }
      } else out.commission = { scope: 'rep', ...repCommissionView(full, auth.userId) }
    }
  }
  return out
}

const REPORT_PARAMS = new Set(['mb', 'salesperson_id', 'from', 'to', 'date_basis', 'stage', 'deposit', 'page', 'page_size'])
const STAGES = new Set(['lead', 'quoted', 'contract_signed', 'order_placed', 'scheduled', 'installed', 'completed', 'cancelled', 'on_hold'])

/**
 * MB-only commission report. Owner: every MB order, full split, filters + totals.
 * metal_rep: only orders they are on, only their own dollars (forced to themselves).
 * Everyone else: 403. Complete beyond 1000 rows (paged reads).
 */
export async function commissionReport(db, auth, searchParams) {
  const owner = isOwner(auth.role)
  const rep = auth.role === 'metal_rep'
  if (!owner && !rep) return json({ error: 'Only the Owner and metal-building reps can see commissions.' }, 403)
  for (const k of searchParams.keys()) if (!REPORT_PARAMS.has(k)) return json({ error: `Unsupported filter: ${k}` }, 400)
  const p = k => (searchParams.get(k) || '').trim()
  let salespersonId = p('salesperson_id')
  if (rep) {
    if (salespersonId && salespersonId !== auth.userId) return json({ error: 'You can only see your own commissions.' }, 403)
    salespersonId = auth.userId
  }
  if (salespersonId && !isUuidLike(salespersonId)) return json({ error: 'Invalid salesperson.' }, 400)
  const from = p('from'), to = p('to')
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return json({ error: 'Dates must be YYYY-MM-DD.' }, 400)
  const basis = p('date_basis') || 'deposit_received'
  if (!['deposit_received', 'created'].includes(basis)) return json({ error: 'date_basis must be deposit_received or created.' }, 400)
  const stage = p('stage')
  if (stage && !STAGES.has(stage)) return json({ error: 'Invalid stage.' }, 400)
  const deposit = p('deposit')
  if (deposit && !['received', 'not_received'].includes(deposit)) return json({ error: 'deposit must be received or not_received.' }, 400)
  const pageSize = Math.min(500, Math.max(1, Number(p('page_size') || 200) || 200))
  const page = Math.max(1, Math.floor(Number(p('page') || 1)) || 1)

  const { data: orders, error } = await fetchAll(() => db.from('sales_orders')
    .select('id, order_number, customer_name, stage, division, salesperson_id, salesperson_name, deposit_amount, deposit_received, deposit_received_date, payment_status, created_at, is_preview_data')
    .eq('division', MB).eq('is_preview_data', false).order('created_at', { ascending: false }).order('id'))
  if (error) return json({ error: error.message }, 500)
  const ids = (orders || []).map(o => o.id)
  const attr = await attributionFor(db, ids)
  if (attr.error) return json({ error: attr.error.message }, 500)
  const conc = await concreteFor(db, ids)
  if (conc.error) return json({ error: isMissingSchema(conc.error) ? SCHEMA_HINT : conc.error.message }, isMissingSchema(conc.error) ? 503 : 500)
  const snaps = await receivedSnapshotsFor(db, ids)
  if (snaps.error) return json({ error: isMissingSchema(snaps.error) ? SCHEMA_HINT : snaps.error.message }, isMissingSchema(snaps.error) ? 503 : 500)

  const range = basis === 'created' ? centralDateRange(from, to) : null
  const inDate = o => {
    if (!from && !to) return true
    if (basis === 'deposit_received') {
      const d = o.deposit_received_date
      if (!d) return false
      return (!from || d >= from) && (!to || d <= to)
    }
    const t = o.created_at ? new Date(o.created_at).toISOString() : null
    if (!t) return false
    return (!range.gte || t >= range.gte) && (!range.lt || t < range.lt) && (!range.lte || t <= range.lte)
  }

  const rows = []
  for (const o of orders || []) {
    if (o.division !== MB) continue
    if (stage && o.stage !== stage) continue
    if (deposit === 'received' && o.deposit_received !== true) continue
    if (deposit === 'not_received' && o.deposit_received === true) continue
    if (!inDate(o)) continue
    const a = attr.map.get(o.id) || []
    const full = computeMbCommission(o, conc.map.get(o.id) || null, a, { receivedAmount: snaps.map.get(o.id) })
    const onOrder = salespersonId ? (isRepOnOrder(salespersonId, o, a) || full.reps.some(r => r.salesperson_id === salespersonId)) : true
    if (!onOrder) continue
    const base = { order_id: o.id, order_number: o.order_number, customer_name: o.customer_name, stage: o.stage, deposit_received: o.deposit_received === true, deposit_received_date: o.deposit_received_date || null, created_at: o.created_at }
    if (rep) {
      rows.push({ ...base, ...repCommissionView(full, auth.userId) })
    } else {
      const mine = salespersonId ? (full.reps.find(r => r.salesperson_id === salespersonId)?.cents || 0) : null
      rows.push({ ...base, salesperson_name: o.salesperson_name, ...full, ...(salespersonId ? { rep_cents: mine } : {}) })
    }
  }
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0)
  const totals = rep
    ? { orders: rows.length, my_commission_cents: sum('my_commission_cents') }
    : {
        orders: rows.length, base_cents: sum('base_cents'), salesman_pool_cents: sum('salesman_pool_cents'),
        nv_cents: sum('nv_cents'), marketing_cents: sum('marketing_cents'), unassigned_pool_cents: sum('unassigned_pool_cents'),
        flagged_orders: rows.filter(r => (r.flags || []).some(f => f.startsWith('attribution_') || f === 'no_assignee' || f === 'negative_base')).length,
        ...(salespersonId ? { rep_cents: sum('rep_cents') } : {}),
      }
  const start = (page - 1) * pageSize
  return json({
    scope: rep ? 'rep' : 'owner',
    date_basis: basis,
    date_basis_label: basis === 'created' ? 'Order created date (Central)' : 'Deposit received date',
    filters: { salesperson_id: salespersonId || null, from: from || null, to: to || null, stage: stage || null, deposit: deposit || null },
    totals,
    page, page_size: pageSize, total_rows: rows.length,
    rows: rows.slice(start, start + pageSize),
  })
}

export async function settingsView(db, auth) {
  const s = await getPaymentInstructions(db)
  if (s.error) return json({ error: s.error, schema_missing: !!s.missingSchema }, s.missingSchema ? 503 : 500)
  if (isOwner(auth.role)) return json({ configured: s.configured, payment_instructions: s.text, updated_at: s.updated_at, updated_by_name: s.updated_by_name })
  return json({ configured: s.configured })
}

export async function mbSupplierList(db) {
  const { data, error } = await db.from('mb_suppliers').select('id, name').order('name')
  if (error) return json({ error: error.message }, 500)
  return json({ data: data || [] })
}

export { depositSatisfied }
