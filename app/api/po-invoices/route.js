import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requirePM } from '../../../lib/server-auth'
import { notify } from '../../../lib/notify'
import { apRecipients, sendApEmail, poInvoiceReadyEmail, poInvoiceDueDate, fmtDateUS, READY_TO_PAY_LINK_PATH } from '../../../lib/ap-recipients'
import { seesAllJobs, isPrincipal, denyUnlessOnJob } from '../../../lib/roles'
import { logChange } from '../../../lib/change-log'
import { todayCentral } from '../../../lib/central-date'
import { isMissingRelation, fetchAll } from '../../../lib/budget-line-refs'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'
import {
  MIGRATION_082, MIGRATION_082_MESSAGE, MAX_NOTE, invoicePayer, jobPOPayer, invoiceStatus,
  invoiceRemaining, isSettled, validateInvoiceInput, validatePayment, overPOAmount, hasOwnerOverride,
  appendCheckNumber, buildInvoiceRows, summarizeInvoiceRows, defaultDueDate, r2, STATUS_LABELS,
} from '../../../lib/po-invoices'
import { denyUnlessApprover, denyUnlessPayer, denyUnlessSendBack, denyUnlessOnPOJob, invoiceCapabilities, canMarkPOPaid } from '../../../lib/po-invoice-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)

export const dynamic = 'force-dynamic'

// /api/po-invoices — vendor invoices on purchase orders and the admin "Ready to pay" list
// (prompt 99). Every rule is enforced here from the session user's stored role and job
// membership (lib/po-invoice-auth.js); the UI's buttons are only hints.
//
// GET  ?job_id=…        a job's PO invoices (+ what the caller may do)        on the job
// GET  (no params)      company-wide list for the admin Orders tab           Owner / admin
// GET  ?sign=<id>       signed URL for an invoice's file                      on the job
// POST                  add an invoice { po_id, invoice_number, invoice_date, amount,
//                       due_date?, attachment?, override_note? }
// PATCH { id, action }  edit | approve | send_back | mark_paid | mark_paid_by_owner
// DELETE { id }         remove an invoice that is not approved and has no payment
//
// Before migration 082 every answer is a friendly "migration 082 needed" (GET: 200 with an
// empty list + migration_required; writes: 503), never a crash.

const BUCKET = 'purchase-order-docs'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE })
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status)
const needs082 = () => bad(MIGRATION_082_MESSAGE, 503, { migration_required: MIGRATION_082 })
const CHUNK = 200

async function readBody(request) {
  const multipart = rejectMultipart(request)
  if (multipart) return { error: multipart }
  let body
  try { body = await request.json() } catch { return { error: bad('Invalid JSON body') } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: bad('Invalid JSON body') }
  const inline = inlineFileContentError(body)
  if (inline) return { error: bad(inline) }
  return { body }
}

async function loadPO(id) {
  const { data, error } = await adminSupabase.from('purchase_orders').select('*').eq('id', id).maybeSingle()
  if (error) return { error: bad(error.message, 500) }
  if (!data) return { error: bad('Purchase order not found.', 404) }
  return { po: data }
}

async function loadJob(id) {
  const { data, error } = await adminSupabase.from('jobs').select('*').eq('id', id).maybeSingle()
  if (error) return { error: bad(error.message, 500) }
  return { job: data || null }
}

async function loadInvoice(id) {
  const { data, error } = await adminSupabase.from('po_invoices').select('*').eq('id', id).maybeSingle()
  if (error) return { error: isMissingRelation(error) ? needs082() : bad(error.message, 500) }
  if (!data) return { error: bad('Invoice not found.', 404) }
  return { inv: data }
}

async function invoicesForPO(poId) {
  const { data, error } = await adminSupabase.from('po_invoices').select('*').eq('po_id', poId)
  if (error) return { error: isMissingRelation(error) ? needs082() : bad(error.message, 500) }
  return { invoices: data || [] }
}

async function inChunks(table, column, ids, cols = '*') {
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await adminSupabase.from(table).select(cols).in(column, chunk)
    if (error) return { error }
    out.push(...(data || []))
  }
  return { data: out }
}

const log = (auth, po, inv, d) => logChange({
  job_id: po.job_id, entity_type: 'po_invoice', entity_id: inv.id, changed_by: auth.userId, ...d,
})
const money = n => '$' + r2(n).toFixed(2)
const label = (po, inv) => `${po.po_number || 'PO'} · ${po.vendor_name || 'vendor'} · inv ${inv.invoice_number}`

// After an approval actually landed (the guarded update returned the row): email the admin
// team and drop a bell notice for each admin. Never throws and never undoes the approval;
// returns the email error text, or null when the email went out.
async function announceReadyToPay(auth, po, job, inv) {
  let emailError = null
  try {
    let approverName = null
    try {
      const { data } = await adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle()
      approverName = data?.full_name || null
    } catch { /* optional */ }
    const rec = await apRecipients(adminSupabase)
    emailError = rec.error || await sendApEmail(resend, { to: rec.emails, ...poInvoiceReadyEmail({ po, job, inv, approverName }) })
    const due = fmtDateUS(poInvoiceDueDate(inv)) || '—'
    await Promise.all(rec.userIds.map(recipient_id => notify({
      recipient_id,
      type: 'po_invoice_ready',
      title: `PO invoice ready to pay — ${po.vendor_name || 'Vendor'} · ${money(inv.amount)}`,
      body: `Job #${job?.job_number || ''} · PO ${po.po_number || '—'} · Inv ${inv.invoice_number || '—'} · due ${due}`,
      link: READY_TO_PAY_LINK_PATH,
      job_id: po.job_id,
      entity_type: 'po_invoice',
      entity_id: inv.id,
      dedup_key: 'po_invoice_ready:' + inv.id,
    })))
  } catch (e) {
    emailError = e?.message || 'Could not send the Ready to pay email.'
  }
  if (emailError) console.error('[po-invoices] ready-to-pay email', emailError)
  return emailError
}

// The PO's invoice total over the PO amount needs an Owner override with a note.
function overAmountRefusal(auth, po, others, amount, excludeId, overrideNote) {
  const o = overPOAmount(po, others, amount, excludeId)
  if (!o.over) return { ok: true, override: null }
  const note = String(overrideNote ?? '').trim()
  if (isPrincipal(auth.role) && note) {
    return { ok: true, override: { over_po_override_by: auth.userId, over_po_override_note: note.slice(0, MAX_NOTE), over_po_override_at: new Date().toISOString() }, o }
  }
  return {
    ok: false,
    response: bad(`Invoices on ${po.po_number || 'this PO'} would total ${money(o.total)}, ${money(o.by)} over the PO amount of ${money(o.poAmount)}. An Owner must override this with a note.`, 409, { needs_owner_override: true, over: o }),
  }
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const today = todayCentral()

  const sign = searchParams.get('sign')
  if (sign) {
    const r = await loadInvoice(sign)
    if (r.error) return r.error
    if (!r.inv.file_url) return bad('This invoice has no file.', 404)
    const p = await loadPO(r.inv.po_id)
    if (p.error) return p.error
    const denied = await denyUnlessOnJob(adminSupabase, auth, p.po.job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUrl(r.inv.file_url, 3600)
    if (error || !data?.signedUrl) return bad(error?.message || 'Could not open the file.', 500)
    return json({ signedUrl: data.signedUrl })
  }

  const jobId = searchParams.get('job_id')
  if (jobId) {
    const denied = await denyUnlessOnPOJob(adminSupabase, auth, jobId)
    if (denied) return denied
    const j = await loadJob(jobId)
    if (j.error) return j.error
    const { data: pos, error: poErr } = await adminSupabase.from('purchase_orders').select('*').eq('job_id', jobId)
    if (poErr) return bad(poErr.message, 500)
    const can = await invoiceCapabilities(adminSupabase, auth, jobId)
    const base = { job_payer: jobPOPayer(j.job), can }
    const ids = (pos || []).map(p => p.id)
    if (!ids.length) {
      // Still probe the table so "migration 082 needed" shows on a job with no POs too.
      const { error } = await adminSupabase.from('po_invoices').select('id').limit(1)
      if (error) return isMissingRelation(error) ? json({ ...base, invoices: [], migration_required: MIGRATION_082 }) : bad(error.message, 500)
      return json({ ...base, invoices: [] })
    }
    const r = await inChunks('po_invoices', 'po_id', ids)
    if (r.error) return isMissingRelation(r.error) ? json({ ...base, invoices: [], migration_required: MIGRATION_082 }) : bad(r.error.message, 500)
    const posById = Object.fromEntries(pos.map(p => [p.id, p]))
    const rows = buildInvoiceRows(r.data, posById, { [jobId]: j.job }, today)
    return json({ ...base, invoices: rows })
  }

  // Company-wide list (admin Orders tab). Owner / admin only.
  if (!seesAllJobs(auth.role)) return bad('Only an Owner or Admin can list PO invoices across all jobs. Open a job to see its POs.', 403)
  const invRes = await fetchAll(() => adminSupabase.from('po_invoices').select('*').order('id'))
  if (invRes.error) {
    if (isMissingRelation(invRes.error)) return json({ invoices: [], summary: summarizeInvoiceRows([]), migration_required: MIGRATION_082, can: { approve: false, mark_paid: false } })
    return bad(invRes.error.message, 500)
  }
  const poIds = [...new Set(invRes.data.map(i => i.po_id))]
  const posRes = await inChunks('purchase_orders', 'id', poIds)
  if (posRes.error) return bad(posRes.error.message, 500)
  const jobIds = [...new Set(posRes.data.map(p => p.job_id))]
  const jobsRes = await inChunks('jobs', 'id', jobIds)
  if (jobsRes.error) return bad(jobsRes.error.message, 500)
  const posById = Object.fromEntries(posRes.data.map(p => [p.id, p]))
  const jobsById = Object.fromEntries(jobsRes.data.map(x => [x.id, x]))
  const rows = buildInvoiceRows(invRes.data, posById, jobsById, today)
  // Approval is per job (PM/APM on that job, or an Owner); on this list only an Owner approves.
  const can = { approve: isPrincipal(auth.role), mark_paid: await canMarkPOPaid(auth.role) }
  return json({ invoices: rows, summary: summarizeInvoiceRows(rows), can })
}

// ── POST: add an invoice ────────────────────────────────────────────────────
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error
  const body = parsed.body
  if (!body.po_id || typeof body.po_id !== 'string') return bad('po_id required')

  const p = await loadPO(body.po_id)
  if (p.error) return p.error
  const po = p.po
  const denied = await denyUnlessOnPOJob(adminSupabase, auth, po.job_id)
  if (denied) return denied
  if (po.status === 'draft') return bad('Issue the purchase order before adding a vendor invoice.', 409)

  const v = validateInvoiceInput(body)
  if (v.error) return bad(v.error)
  const ex = await invoicesForPO(po.id)
  if (ex.error) return ex.error
  const over = overAmountRefusal(auth, po, ex.invoices, v.fields.amount, null, body.override_note)
  if (!over.ok) return over.response

  let file_url = null
  if (body.attachment !== undefined && body.attachment !== null) {
    const a = await verifyAttachment(adminSupabase, body.attachment, { target: 'po-invoice', subject: auth.userId, ctx: { job: po.job_id, rec: po.id } })
    if (!a.ok) return attachmentErrorResponse(a)
    file_url = a.path
  }

  const row = { po_id: po.id, ...v.fields, file_url, created_by: auth.userId, ...(over.override || {}) }
  const { data, error } = await adminSupabase.from('po_invoices').insert(row).select('*').single()
  if (error) return isMissingRelation(error) ? needs082() : bad(error.message, 500)
  const j = await loadJob(po.job_id)
  // A new invoice is unlocked, so this is the PO/job payer — same path as PATCH (prompt 108).
  const payer = invoicePayer(data, po, j.job)
  await log(auth, po, data, {
    field_name: 'payment_status', old_value: null, new_value: invoiceStatus(data, payer),
    note: `Invoice added: ${label(po, data)} for ${money(data.amount)}, due ${data.due_date || defaultDueDate(data.invoice_date)}.${over.override ? ` Owner override (over PO amount by ${money(over.o.by)}): ${over.override.over_po_override_note}` : ''}`,
  })
  return json({ invoice: { ...data, status: invoiceStatus(data, payer) } })
}

// ── PATCH: edit / approve / send back / mark paid ───────────────────────────
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error
  const body = parsed.body
  const { id, action } = body
  if (!id || typeof id !== 'string') return bad('id required')

  const r = await loadInvoice(id)
  if (r.error) return r.error
  const inv = r.inv
  const p = await loadPO(inv.po_id)
  if (p.error) return p.error
  const po = p.po
  const j = await loadJob(po.job_id)
  if (j.error) return j.error
  // Prompt 108: an approved/paid invoice keeps its own payer (lib/po-invoices.js
  // lockedInvoicePayer); only an untouched invoice follows the current PO/job setting.
  const payer = invoicePayer(inv, po, j.job)
  const before = invoiceStatus(inv, payer)
  const nowIso = new Date().toISOString()
  const today = todayCentral()
  const changed = () => bad('This invoice was changed by someone else. Refresh and try again.', 409)

  if (action === 'edit') {
    const denied = await denyUnlessOnPOJob(adminSupabase, auth, po.job_id)
    if (denied) return denied
    if (inv.approved_at || inv.ready_to_pay || Number(inv.paid_amount) > 0 || inv.paid_at || inv.paid_by_owner) {
      return bad('Only an invoice that is not approved or paid can be edited. Send it back first.', 409)
    }
    const merged = {
      invoice_number: body.invoice_number !== undefined ? body.invoice_number : inv.invoice_number,
      invoice_date: body.invoice_date !== undefined ? body.invoice_date : inv.invoice_date,
      amount: body.amount !== undefined ? body.amount : inv.amount,
      // Due date: what was sent; else keep a custom one; else follow the (new) invoice date.
      due_date: body.due_date !== undefined ? body.due_date
        : (inv.due_date && inv.due_date !== defaultDueDate(inv.invoice_date) ? inv.due_date : null),
    }
    const v = validateInvoiceInput(merged)
    if (v.error) return bad(v.error)
    const ex = await invoicesForPO(po.id)
    if (ex.error) return ex.error
    const over = overAmountRefusal(auth, po, ex.invoices, v.fields.amount, inv.id, body.override_note)
    if (!over.ok) return over.response
    const update = { ...v.fields, ...(over.override || {}) }
    if (body.attachment !== undefined && body.attachment !== null) {
      const a = await verifyAttachment(adminSupabase, body.attachment, { target: 'po-invoice', subject: auth.userId, ctx: { job: po.job_id, rec: po.id } })
      if (!a.ok) return attachmentErrorResponse(a)
      update.file_url = a.path
    }
    const { data, error } = await adminSupabase.from('po_invoices').update(update)
      .eq('id', inv.id).is('approved_at', null).is('paid_at', null).eq('paid_amount', inv.paid_amount ?? 0).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return changed()
    const diffs = ['invoice_number', 'invoice_date', 'amount', 'due_date'].filter(k => String(inv[k] ?? '') !== String(update[k] ?? ''))
    await log(auth, po, inv, { field_name: 'invoice', old_value: diffs.map(k => `${k}=${inv[k] ?? ''}`).join('; ') || null, new_value: diffs.map(k => `${k}=${update[k] ?? ''}`).join('; ') || null, note: `Invoice edited: ${label(po, data[0])}${update.file_url ? ' (new file)' : ''}.` })
    return json({ invoice: { ...data[0], status: invoiceStatus(data[0], payer) } })
  }

  if (action === 'approve') {
    if (payer !== 'nv') return bad('The owner pays this vendor directly, so this invoice does not go on the Ready to pay list. Use "Mark paid by owner".', 409)
    const denied = await denyUnlessApprover(adminSupabase, auth, po.job_id)
    if (denied) return denied
    if (inv.ready_to_pay || inv.approved_at) return bad('This invoice is already approved.', 409)
    if (isSettled(inv)) return bad('This invoice is already paid.', 409)
    const ex = await invoicesForPO(po.id)
    if (ex.error) return ex.error
    const update = { approved_by: auth.userId, approved_at: nowIso, ready_to_pay: true, sent_back_reason: null, sent_back_at: null, sent_back_by: null }
    const o = overPOAmount(po, ex.invoices, 0)
    if (o.over && !hasOwnerOverride(ex.invoices)) {
      const over = overAmountRefusal(auth, po, ex.invoices, 0, null, body.override_note)
      if (!over.ok) return over.response
      Object.assign(update, over.override)
    }
    const { data, error } = await adminSupabase.from('po_invoices').update(update)
      .eq('id', inv.id).eq('ready_to_pay', false).is('paid_at', null).eq('paid_by_owner', false).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return changed()
    await log(auth, po, inv, { field_name: 'payment_status', old_value: before, new_value: 'ready_to_pay', note: `Approved → Ready to pay: ${label(po, inv)} (${money(inv.amount)}, due ${inv.due_date || '—'}).${update.over_po_override_note ? ` Owner override: ${update.over_po_override_note}` : ''}` })
    const email_error = await announceReadyToPay(auth, po, j.job, data[0])
    return json({ invoice: { ...data[0], status: invoiceStatus(data[0], payer) }, email_error })
  }

  // A sent-back invoice is unlocked again (approval cleared, no payment), so it follows the
  // current PO/job payer from here on (prompt 108 — intended).
  if (action === 'send_back') {
    const reason = String(body.reason ?? '').trim()
    if (!reason) return bad('A reason is required to send an invoice back.')
    const denied = await denyUnlessSendBack(adminSupabase, auth, po.job_id)
    if (denied) return denied
    if (isSettled(inv) || inv.paid_by_owner) return bad('This invoice is already paid and cannot be sent back.', 409)
    if (Number(inv.paid_amount) > 0) return bad('A payment is already recorded on this invoice, so it cannot be sent back.', 409)
    const update = { ready_to_pay: false, approved_at: null, approved_by: null, sent_back_reason: reason.slice(0, MAX_NOTE), sent_back_at: nowIso, sent_back_by: auth.userId }
    const { data, error } = await adminSupabase.from('po_invoices').update(update)
      .eq('id', inv.id).is('paid_at', null).eq('paid_amount', inv.paid_amount ?? 0).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return changed()
    const after = invoiceStatus(data[0], invoicePayer(data[0], po, j.job))
    await log(auth, po, inv, { field_name: 'payment_status', old_value: before, new_value: after, note: `Sent back: ${label(po, inv)}. Reason: ${update.sent_back_reason}` })
    return json({ invoice: { ...data[0], status: after } })
  }

  if (action === 'mark_paid') {
    if (payer !== 'nv') return bad('The owner pays this vendor directly; NV does not cut this check.', 409)
    const denied = await denyUnlessPayer(auth)
    if (denied) return denied
    if (!seesAllJobs(auth.role)) {
      const off = await denyUnlessOnJob(adminSupabase, auth, po.job_id)
      if (off) return off
    }
    const pay = validatePayment(inv, body, today)
    if (pay.error) return bad(pay.error, isSettled(inv) || !inv.ready_to_pay ? 409 : 400)
    const line = `${pay.date}: check ${pay.check_number} for ${money(pay.amount)}${pay.notes ? ` — ${pay.notes}` : ''}`
    const update = {
      paid_amount: pay.newPaid,
      last_payment_date: pay.date,
      paid_by: auth.userId,
      check_number: appendCheckNumber(inv.check_number, pay.check_number),
      payment_notes: (inv.payment_notes ? inv.payment_notes + '\n' : '') + line,
      paid_at: pay.settles ? nowIso : null,
    }
    // Guarded on the paid amount we read: two clicks / two admins can't both record a check.
    const { data, error } = await adminSupabase.from('po_invoices').update(update)
      .eq('id', inv.id).eq('ready_to_pay', true).is('paid_at', null).eq('paid_amount', inv.paid_amount ?? 0).eq('paid_by_owner', false).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return changed()
    const after = invoiceStatus(data[0], payer)
    await log(auth, po, inv, { field_name: 'payment', old_value: money(inv.paid_amount || 0), new_value: money(pay.newPaid), note: `${pay.settles ? 'Paid in full' : 'Partial payment'}: ${label(po, inv)} — check ${pay.check_number}, ${money(pay.amount)} on ${pay.date}.${pay.settles ? '' : ` ${money(invoiceRemaining(data[0]))} still ready to pay.`}` })
    if (after !== before) await log(auth, po, inv, { field_name: 'payment_status', old_value: before, new_value: after, note: `${STATUS_LABELS[before]} → ${STATUS_LABELS[after]}: ${label(po, inv)}` })
    return json({ invoice: { ...data[0], status: after } })
  }

  if (action === 'mark_paid_by_owner') {
    // Prompt 108: NV money or an NV approval on the row means NV pays it, whatever the PO says now.
    if (Number(inv.paid_amount) > 0) return bad(`NV has already recorded ${money(inv.paid_amount)} in checks on this invoice${inv.check_number ? ` (check ${inv.check_number})` : ''}, so it can't be marked paid by the owner.`, 409)
    if (inv.ready_to_pay || inv.approved_at) return bad('This invoice was approved for NV to pay and is on the office Ready to pay list. Send it back first if the owner is paying it.', 409)
    if (payer !== 'owner') return bad('NV pays this vendor. Approve the invoice so the office can pay it.', 409)
    const denied = await denyUnlessApprover(adminSupabase, auth, po.job_id)
    if (denied) return denied
    if (inv.paid_by_owner || inv.paid_at) return bad('This invoice is already marked paid by the owner.', 409)
    const date = body.paid_on || today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return bad('Date must be a date (YYYY-MM-DD).')
    const note = String(body.payment_notes ?? '').trim().slice(0, MAX_NOTE)
    const update = { paid_by_owner: true, paid_at: nowIso, last_payment_date: date, paid_by: auth.userId, payment_notes: (inv.payment_notes ? inv.payment_notes + '\n' : '') + `${date}: paid by owner${note ? ` — ${note}` : ''}` }
    const { data, error } = await adminSupabase.from('po_invoices').update(update)
      .eq('id', inv.id).eq('paid_by_owner', false).is('paid_at', null).eq('paid_amount', 0).eq('ready_to_pay', false).select('*')
    if (error) return bad(error.message, 500)
    if (!data?.length) return changed()
    await log(auth, po, inv, { field_name: 'payment_status', old_value: before, new_value: 'paid_by_owner', note: `Paid by owner: ${label(po, inv)} (${money(inv.amount)}) on ${date}.` })
    return json({ invoice: { ...data[0], status: 'paid_by_owner' } })
  }

  return bad('Unknown action. Use edit, approve, send_back, mark_paid or mark_paid_by_owner.')
}

// ── DELETE: remove an unapproved, unpaid invoice ────────────────────────────
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error
  const { id } = parsed.body
  if (!id || typeof id !== 'string') return bad('id required')
  const r = await loadInvoice(id)
  if (r.error) return r.error
  const inv = r.inv
  const p = await loadPO(inv.po_id)
  if (p.error) return p.error
  const denied = await denyUnlessOnPOJob(adminSupabase, auth, p.po.job_id)
  if (denied) return denied
  if (inv.approved_at || inv.ready_to_pay || Number(inv.paid_amount) > 0 || inv.paid_at || inv.paid_by_owner) {
    return bad('Only an invoice that is not approved or paid can be removed.', 409)
  }
  const { data, error } = await adminSupabase.from('po_invoices').delete()
    .eq('id', inv.id).is('approved_at', null).is('paid_at', null).eq('paid_amount', inv.paid_amount ?? 0).select('id')
  if (error) return bad(error.message, 500)
  if (!data?.length) return bad('This invoice was changed by someone else. Refresh and try again.', 409)
  await log(auth, p.po, inv, { field_name: 'payment_status', old_value: 'needs_approval', new_value: null, note: `Invoice removed: ${label(p.po, inv)} (${money(inv.amount)}).` })
  return json({ ok: true })
}
