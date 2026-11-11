import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { logChange } from '../../../lib/change-log'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { notify } from '../../../lib/notify'
import { PM_INSERT_FIELDS, SUB_INSERT_FIELDS, PM_PATCH_FIELDS, SUB_PATCH_FIELDS, pickFields, withoutNew032, billingDeleteBlock, billingDrawLockError, isFirstReviewOnOpenDraw } from '../../../lib/billing-fields'
import { drawTargetError, DRAWABLE } from '../../../lib/draw-guards'
import { sendLienWaiver, VOIDED_WAIVER_PATCH } from '../../../lib/lien-waiver'
import { planBillingPayment, netBelowPaidError } from '../../../lib/billing-payment'
import { escapeHtml, emailWrap } from '../../../lib/email'
import { siteUrl } from '../../../lib/site-url'
import { findDuplicateInvoice as findDuplicateInvoiceIn, normalizeInvoiceNumber } from '../../../lib/billing-duplicates'
import { without062, mentions062, isMissingColumnError, waiverTermChanges, voidReason } from '../../../lib/lien-waiver-terms'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'
import { subBillingGuard } from '../../../lib/upload-guards'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const resend = new Resend(process.env.RESEND_API_KEY)


// Valid status transitions
const ALLOWED_TRANSITIONS = {
  pm: {
    pending: ['approved', 'rejected'],
    approved: ['pending'], // correction reopen
    rejected: ['pending'],
  },
  sub: {
    pending: [], // subs cannot change status
  },
}

// Who to email about a billing decision: the address saved on the submission,
// else the sub's login email. Returns null when there is none.
async function billingRecipient(current) {
  if (current.sub_email?.trim()) return current.sub_email.trim()
  if (!current.sub_id) return null
  const { data } = await adminSupabase.auth.admin.getUserById(current.sub_id)
  return data?.user?.email || null
}

async function emailBillingDecision(current, status, reason) {
  const to = await billingRecipient(current)
  if (!to) return 'No email on file for this sub.'
  const { data: job } = await adminSupabase.from('jobs').select('job_number, project_name').eq('id', current.job_id).maybeSingle()
  const approved = status === 'approved'
  const color = approved ? '#16a34a' : '#dc2626'
  const amt = '$' + Number(current.amount_billed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const jobLabel = `#${escapeHtml(job?.job_number || '')} — ${escapeHtml(job?.project_name || '')}`
  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
      to,
      subject: `Billing ${status} — ${job?.project_name || 'your job'}`,
      html: emailWrap(`
        <h2 style="color:${color};margin:0 0 1rem">Billing ${status}</h2>
        <p style="color:#aaa">Your billing submission of <strong style="color:#f1f1f1">${amt}</strong> for <strong style="color:#f1f1f1">${jobLabel}</strong> has been <strong style="color:${color}">${status}</strong>.</p>
        ${!approved && reason ? `<div style="background:#1a0a0a;border:1px solid #3a1a1a;border-radius:8px;padding:14px 16px;margin-top:1rem"><p style="color:#888;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">Reason</p><p style="color:#ff6b6b;margin:0;font-size:14px;line-height:1.6">${escapeHtml(reason)}</p></div>` : ''}
        ${!approved && !reason ? `<p style="color:#888;font-size:13px">Contact NV Construction if you have questions.</p>` : ''}
      `),
    })
    return error ? (error.message || 'Email failed') : null
  } catch (e) {
    return e.message || 'Email failed'
  }
}

// First review (pending → approved / rejected) of a billing on a draw: one guarded write in
// the database (migration 059) that only lands while that draw is still OPEN and the billing
// is still the pending invoice on it, so a concurrent Close can't be raced. Null on success,
// else { status, error }. Never falls back to the plain update, which can't see the draw's
// status: when 059 isn't applied yet, firstReviewFallback below checks the draw around a
// compare-and-set write and undoes it if a Close is seen.
const DRAW_NOT_OPEN_ERROR = 'The draw request this billing is on was closed (or removed) by someone else, so it can\'t be reviewed on it now. Nothing was changed. Refresh and try again.'
const BILLING_CHANGED_ERROR = 'This billing was changed by someone else. Refresh and try again.'
const rpcMissing = e => e?.code === 'PGRST202' || e?.code === '42883' || /could not find the function|function .*billing_first_review.* does not exist/i.test(e?.message || '')
async function firstReviewWrite(id, drawId, status, update) {
  const { data, error } = await adminSupabase.rpc('billing_first_review', { p_billing_id: id, p_draw_id: drawId, p_status: status, p_patch: update })
  if (error) {
    if (rpcMissing(error)) return firstReviewFallback(id, drawId, status, update)
    return { status: 500, error: error.message }
  }
  if (data?.updated === true) return null
  if (data?.reason === 'draw_not_open') return { status: 409, error: DRAW_NOT_OPEN_ERROR }
  return { status: 409, error: BILLING_CHANGED_ERROR }
}

// Until migration 059 is applied (JS only, no new SQL):
//  1. re-read the draw and the billing right before writing — draw must be open, billing still
//     the pending invoice on it, else 409 and nothing written;
//  2. the same status + link compare-and-set update as other guarded billing writes;
//  3. re-read the draw — if it is no longer open, put the billing back exactly as it was
//     (pending, still on the draw, prior rejection_reason etc.) and 409, so no email / waiver /
//     notification goes out. Only a still-open draw after the write counts as success.
// Residual race (Close landing after step 3 saw open) is accepted for this fallback only; the
// 059 RPC (draw held FOR SHARE) is the real atomic fix.
async function drawIsOpen(drawId) {
  const { data, error } = await adminSupabase.from('draw_requests').select('id, status').eq('id', drawId).maybeSingle()
  if (error) return { error: 'Could not check the draw request: ' + error.message }
  return { open: data?.status === 'open' }
}
async function firstReviewFallback(id, drawId, status, update) {
  const before = await drawIsOpen(drawId)
  if (before.error) return { status: 500, error: before.error }
  if (!before.open) return { status: 409, error: DRAW_NOT_OPEN_ERROR }
  const { data: prior, error: priorErr } = await adminSupabase.from('billing_submissions').select('*').eq('id', id).maybeSingle()
  if (priorErr) return { status: 500, error: priorErr.message }
  if (!prior || prior.status !== 'pending' || prior.draw_request_id !== drawId) return { status: 409, error: BILLING_CHANGED_ERROR }

  const guarded = patch => adminSupabase.from('billing_submissions').update(patch).eq('id', id).eq('status', 'pending').eq('draw_request_id', drawId).select('id')
  let written = update
  let { data: rows, error } = await guarded(written)
  if (error?.message?.includes('schema cache')) {
    written = withoutNew032(update)
    ;({ data: rows, error } = await guarded(written))
  }
  if (error) return { status: 500, error: error.message }
  if (!rows?.length) return { status: 409, error: BILLING_CHANGED_ERROR }

  const after = await drawIsOpen(drawId)
  if (!after.error && after.open) return null

  // Close (or a failed check) after the write: undo it — only while the row is still what we wrote.
  const revert = { status: 'pending', draw_request_id: drawId }
  for (const k of Object.keys(written)) if (!(k in revert)) revert[k] = prior[k] === undefined ? null : prior[k]
  const wroteLink = 'draw_request_id' in written ? written.draw_request_id : drawId
  let undo = adminSupabase.from('billing_submissions').update(revert).eq('id', id).eq('status', status)
  undo = wroteLink === null ? undo.is('draw_request_id', null) : undo.eq('draw_request_id', wroteLink)
  const { data: undone, error: undoErr } = await undo.select('id')
  if (undoErr || !undone?.length) {
    return { status: 409, error: `The draw request this billing is on was closed while it was being reviewed, and the review could not be undone automatically${undoErr ? ' (' + undoErr.message + ')' : ''}. No email or lien waiver was sent. Refresh and check this billing.` }
  }
  if (after.error) return { status: 500, error: after.error + ' The review was undone; nothing was sent.' }
  return { status: 409, error: DRAW_NOT_OPEN_ERROR }
}

// What the decision email / notification describe: the row as saved, not the pre-edit read.
const SAVED_COLS = 'id, status, sub_id, sub_email, job_id, amount_billed, company_name, draw_request_id'

// A new invoice/backup file is attachment: { path, uploadReceipt }, uploaded directly to Storage
// (POST /api/file-upload, target billing-doc) for this job (and, on PATCH, this billing). It is
// taken out of the body before pickFields; a raw doc_url from the client is refused (PATCH
// may resend the saved one unchanged). Multipart is refused.
async function readBillingBody(request) {
  const multipart = rejectMultipart(request)
  if (multipart) return { error: multipart }
  let body
  try { body = await request.json() } catch { return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const inline = inlineFileContentError(body)
  if (inline) return { error: Response.json({ error: inline }, { status: 400 }) }
  return { body }
}
const RAW_DOC_URL_ERROR = 'doc_url cannot be set directly. Attach the file with a direct upload.'
const hasValue = v => v !== undefined && v !== null && v !== ''

// Possible duplicate (prompt 67B #2): another non-rejected billing on the job, from the same
// sub company (the sub_id's company people, or a matching company name), with the same
// normalized invoice #. Returns { dup } (null when none) or { error } (read failed).
// Shared with the Bot API billing POST (lib/billing-duplicates findDuplicateInvoice).
const findDuplicateInvoice = args => findDuplicateInvoiceIn(adminSupabase, args)

function duplicateResponse(dup) {
  const date = dup.submitted_at ? new Date(dup.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : 'an earlier date'
  return Response.json({
    error: `Invoice #${dup.invoice_number} was already entered for this company on this project (${date}, ${dup.status || 'pending'}). Save anyway only if this is a different invoice.`,
    needs_confirm: true,
    duplicate: { id: dup.id, invoice_number: dup.invoice_number, submitted_at: dup.submitted_at, status: dup.status, amount_billed: dup.amount_billed },
  }, { status: 409 })
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const parsed = await readBillingBody(request)
    if (parsed.error) return parsed.error
    const { attachment, doc_url: rawDocUrl, ...raw } = parsed.body
    if (hasValue(rawDocUrl)) return Response.json({ error: RAW_DOC_URL_ERROR }, { status: 400 })
    let doc_url = null

    // Derive sub_id from session — never trust it from the request body
    let row
    if (isPM(auth.role)) {
      const denied = await denyJob(adminSupabase, auth, raw.job_id)
      if (denied) return denied
      row = pickFields(raw, PM_INSERT_FIELDS)
      // Same rule as sub-portal billing: a draw picked at create must be open and on this job.
      if (row.draw_request_id) {
        const { data: draw, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, status').eq('id', row.draw_request_id).maybeSingle()
        if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
        const bad = drawTargetError(draw, raw.job_id)
        if (bad) return Response.json({ error: bad.error }, { status: bad.status })
      } else {
        row.draw_request_id = null
      }
    } else if (isSub(auth.role)) {
      row = pickFields(raw, SUB_INSERT_FIELDS)
      row.sub_id = auth.userId  // always derive from session
      row.status = 'pending'    // subs always submit as pending
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Office entry of an invoice # this company already has on the job: confirm first.
    // confirm_duplicate is not a column (pickFields drops it).
    let savedDespite = null
    if (isPM(auth.role) && normalizeInvoiceNumber(row.invoice_number)) {
      const found = await findDuplicateInvoice({ jobId: raw.job_id, invoiceNumber: row.invoice_number, subId: row.sub_id, companyName: row.company_name })
      if (found.error) return Response.json({ error: found.error }, { status: 500 })
      if (found.dup) {
        if (raw.confirm_duplicate !== true) return duplicateResponse(found.dup)
        savedDespite = found.dup
      }
    }

    // Checked after the duplicate 409, so a confirm resend reuses the same uploaded file.
    if (hasValue(attachment)) {
      if (isSub(auth.role)) {
        // A sub may only attach on a job they can bill (as /api/sub-portal/billing).
        const g = await subBillingGuard(adminSupabase, auth, { jobId: row.job_id })
        if (g.error) return g.error
      }
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'billing-doc', subject: auth.userId, ctx: { job: isPM(auth.role) ? raw.job_id : row.job_id } })
      if (!v.ok) return attachmentErrorResponse(v)
      doc_url = v.path
    }

    // Validate sub_id auth account still exists
    if (row.sub_id) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(row.sub_id)
      if (!authUser?.user) row.sub_id = null
    }

    const insertRow = { ...row, doc_url }
    let { data: inserted, error } = await adminSupabase.from('billing_submissions').insert(insertRow).select('id')
    if (error?.message?.includes('schema cache')) {
      ({ data: inserted, error } = await adminSupabase.from('billing_submissions').insert(withoutNew032(insertRow)).select('id'))
    }

    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (savedDespite) {
      await logChange({ job_id: raw.job_id, entity_type: 'billing', entity_id: inserted?.[0]?.id || null, field_name: 'invoice_number', old_value: null, new_value: row.invoice_number, changed_by: auth.userId, note: `Saved despite possible duplicate of Invoice #${savedDespite.invoice_number} (${savedDespite.id})` })
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const parsed = await readBillingBody(request)
    if (parsed.error) return parsed.error
    // Only set when a new file is attached, so saving without one keeps the existing attachment
    let doc_url = undefined
    const { id, attachment, doc_url: rawDocUrl, ...rawFields } = parsed.body

    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    // Waiver columns from migration 062 are read only when present (has062).
    const CURRENT_COLS = 'status, sub_id, sub_email, job_id, doc_url, amount_billed, company_name, ready_to_pay, draw_request_id, retainage_pct, retainage_held, nv_reimbursement, billing_period, paid_at, payment_amount, invoice_number, lien_waiver_signed_at, lien_waiver_signer_name, lien_waiver_signature, lien_waiver_sent_at'
    const readCurrent = cols => adminSupabase.from('billing_submissions').select(cols).eq('id', id).maybeSingle()
    let has062 = true
    let { data: current, error: curErr } = await readCurrent(CURRENT_COLS + ', lien_waiver_amount, lien_waiver_through, lien_waiver_history')
    if (curErr && isMissingColumnError(curErr)) {
      has062 = false
      ;({ data: current, error: curErr } = await readCurrent(CURRENT_COLS))
    }

    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!current) return Response.json({ error: 'Not found' }, { status: 404 })
    // The saved path may be resent unchanged; any other raw doc_url is refused.
    if (hasValue(rawDocUrl) && rawDocUrl !== current.doc_url) return Response.json({ error: RAW_DOC_URL_ERROR }, { status: 400 })
    const emailSub = rawFields.email_sub === true
    const paymentRequested = ['record_payment_amount', 'payment_amount', 'paid_at'].some(k => k in rawFields)
    let paymentPlan = null
    let savedDespiteDup = null
    let termChanges = []
    let waiverVoided = false

    let fields
    if (isPM(auth.role)) {
      const denied = await denyJob(adminSupabase, auth, current.job_id)
      if (denied) return denied
      fields = pickFields(rawFields, PM_PATCH_FIELDS)

      // Validate status transition
      if (fields.status && fields.status !== current.status) {
        const allowed = ALLOWED_TRANSITIONS.pm[current.status] || []
        if (!allowed.includes(fields.status)) {
          return Response.json({ error: `Cannot transition status from '${current.status}' to '${fields.status}'` }, { status: 422 })
        }
      }

      // If status is approved, amount_billed cannot be changed except by first reopening
      if (current.status === 'approved' && 'amount_billed' in fields && !fields.status) {
        delete fields.amount_billed
      }

      const nextStatus = fields.status || current.status
      // Rejecting keeps the billing (status rejected) and needs a reason the sub can act on.
      if (fields.status === 'rejected' && current.status !== 'rejected') {
        const reason = String(rawFields.rejection_reason || '').trim()
        if (!reason) return Response.json({ error: 'A rejection reason is required.' }, { status: 422 })
        fields.rejection_reason = reason
      } else if ('rejection_reason' in fields && nextStatus !== 'rejected') {
        delete fields.rejection_reason
      }
      // Ready to pay only on an approved billing; reopening clears it.
      if (fields.ready_to_pay === true && nextStatus !== 'approved') {
        return Response.json({ error: 'Only an approved billing can be marked ready to pay.' }, { status: 422 })
      }
      if (current.status === 'approved' && nextStatus !== 'approved') fields.ready_to_pay = false

      // Payments: payment_amount is CUMULATIVE paid-to-date; paid_at is the settlement
      // marker, stamped only when paid-to-date reaches net (billed − retainage), computed
      // from the stored row, never from a body "net". A short check stays unpaid.
      if (paymentRequested) {
        if (fields.status && fields.status !== current.status) return Response.json({ error: 'Record a payment separately from a status change.' }, { status: 422 })
        if ('amount_billed' in fields || 'retainage_held' in fields || 'retainage_pct' in fields) {
          return Response.json({ error: 'Record a payment separately from editing the billed amount or retainage.' }, { status: 422 })
        }
        const payInput = {}
        for (const k of ['record_payment_amount', 'payment_amount', 'paid_at']) if (k in rawFields) payInput[k] = rawFields[k]
        const plan = planBillingPayment(current, payInput)
        if (plan.error) return Response.json({ error: plan.error }, { status: plan.status })
        delete fields.paid_at
        delete fields.payment_amount
        Object.assign(fields, plan.patch)
        paymentPlan = plan
      } else {
        const below = netBelowPaidError(current, fields)
        if (below) return Response.json({ error: below }, { status: 422 })
      }

      // On a draw (open or closed): status, amount, retainage and period are locked on EVERY
      // PATCH — even when draw_request_id is unchanged or not sent, and even when the same
      // request also tries to unlink it. Payment recording is not a financial change.
      // Exception: the first review (pending → approved / rejected) while the draw is OPEN.
      if (current.draw_request_id) {
        const { data: curDraw, error: curDrawErr } = await adminSupabase.from('draw_requests').select('id, job_id, status, draw_number').eq('id', current.draw_request_id).maybeSingle()
        if (curDrawErr) return Response.json({ error: 'Could not check the draw request: ' + curDrawErr.message }, { status: 500 })
        const locked = billingDrawLockError(current, curDraw, fields)
        if (locked) return Response.json({ error: locked.error }, { status: locked.status })
        // A rejected invoice leaves the package in the same guarded update (the link guard
        // below still matches the draw we just read).
        if (fields.status === 'rejected' && isFirstReviewOnOpenDraw(current.status, fields.status, curDraw)) fields.draw_request_id = null
      }

      // Draw link: must be a draw on this job, and a closed draw can't gain or lose items.
      if ('draw_request_id' in fields && (fields.draw_request_id || null) !== (current.draw_request_id || null)) {
        // Same rule as /api/draw-requests: only approved billings go onto a draw. (A pending
        // invoice a sub filed into an open draw becomes approved there by its first review.)
        if (fields.draw_request_id && !DRAWABLE.billing({ status: nextStatus })) {
          return Response.json({ error: `Only an approved billing can be put on a draw request (this one is ${nextStatus || 'not approved'}). Approve it first.` }, { status: 422 })
        }
        const ids = [fields.draw_request_id, current.draw_request_id].filter(Boolean)
        const { data: draws, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, status, draw_number').in('id', ids)
        if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
        for (const did of ids) {
          const d = (draws || []).find(x => x.id === did)
          if (!d) return Response.json({ error: 'Draw request not found.' }, { status: 404 })
          if (d.job_id !== current.job_id) return Response.json({ error: 'That draw request is on a different job.' }, { status: 422 })
          if (d.status === 'closed') return Response.json({ error: `Draw #${d.draw_number} is closed. Reopen it first.` }, { status: 409 })
        }
      }
      // A first review on a draw may take the invoice off it (reject does) but not move it
      // to another draw in the same request: review it first, then move it.
      if (current.draw_request_id && fields.status && fields.status !== current.status && fields.draw_request_id && fields.draw_request_id !== current.draw_request_id) {
        return Response.json({ error: 'Review this billing on its current draw first, then move it to another draw.' }, { status: 422 })
      }

      // Changing the invoice # to one this company already has on the job: confirm first.
      if ('invoice_number' in fields && normalizeInvoiceNumber(fields.invoice_number) && normalizeInvoiceNumber(fields.invoice_number) !== normalizeInvoiceNumber(current.invoice_number)) {
        const found = await findDuplicateInvoice({ jobId: current.job_id, invoiceNumber: fields.invoice_number, subId: current.sub_id, companyName: fields.company_name || current.company_name, excludeId: id })
        if (found.error) return Response.json({ error: found.error }, { status: 500 })
        if (found.dup) {
          if (rawFields.confirm_duplicate !== true) return duplicateResponse(found.dup)
          savedDespiteDup = found.dup
        }
      }

      // A signed lien waiver covers the amount / retainage / period it was signed for. When
      // those change, the signature is voided in the same guarded write (and kept in
      // lien_waiver_history once 062 is applied); clearing lien_waiver_sent_at lets the next
      // approval send a fresh waiver. Paper-waiver flags (lien_waiver_received*) are untouched.
      termChanges = waiverTermChanges(current, fields)
      if (current.lien_waiver_signed_at && termChanges.length) {
        const voidedAt = new Date().toISOString()
        Object.assign(fields, VOIDED_WAIVER_PATCH)
        if (has062) {
          const history = Array.isArray(current.lien_waiver_history) ? current.lien_waiver_history : []
          Object.assign(fields, {
            lien_waiver_amount: null,
            lien_waiver_through: null,
            lien_waiver_history: [...history, {
              voided_at: voidedAt,
              voided_by: auth.userId,
              reason: voidReason(termChanges),
              signed_at: current.lien_waiver_signed_at,
              signer_name: current.lien_waiver_signer_name || null,
              amount: current.lien_waiver_amount ?? current.amount_billed ?? null,
              through: current.lien_waiver_through ?? current.billing_period ?? null,
              signature: current.lien_waiver_signature || null,
            }],
          })
        }
        waiverVoided = true
      }
    } else if (isSub(auth.role)) {
      // Subs can only edit their own pending submissions
      if (current.sub_id !== auth.userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (current.status !== 'pending') return Response.json({ error: 'Cannot edit a submission that is not pending' }, { status: 422 })
      fields = pickFields(rawFields, SUB_PATCH_FIELDS)
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (hasValue(attachment)) {
      if (isSub(auth.role)) {
        // Their own pending billing (checked above) on a job they still see.
        const g = await subBillingGuard(adminSupabase, auth, { billing: current })
        if (g.error) return g.error
      }
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'billing-doc', subject: auth.userId, ctx: { job: current.job_id, rec: id } })
      if (!v.ok) return attachmentErrorResponse(v)
      doc_url = v.path
    }
    const update = doc_url !== undefined ? { ...fields, doc_url } : fields
    if (!Object.keys(update).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    // Status changes only apply to the status we read (no double approve / reject).
    // ...and only while the draw link is still the one we checked (a billing put on a draw
    // meanwhile can't have its money changed around the lock).
    const linkGuard = q => (current.draw_request_id ? q.eq('draw_request_id', current.draw_request_id) : q.is('draw_request_id', null))
    // A payment only lands on the paid-to-date we read and only while still unsettled, so a
    // double submit / second tab can't add the same check twice or overwrite another payment.
    const same = (q, col, v) => (v === null || v === undefined ? q.is(col, null) : q.eq(col, v))
    // ...and only against the billed / retainage / status values the plan computed net
    // from, so a concurrent retainage or billed-amount edit can't make it settle on stale
    // inputs (the row must still be exactly what planBillingPayment saw).
    const payGuard = q => {
      if (!paymentPlan?.patch || !('payment_amount' in paymentPlan.patch)) return q
      let g = same(q.is('paid_at', null), 'payment_amount', current.payment_amount)
      for (const col of ['amount_billed', 'retainage_held', 'retainage_pct', 'status']) g = same(g, col, current[col])
      return g
    }
    // A non-payment edit that can change net only lands on the paid-to-date / settlement we
    // read (and checked net against), so it can't overwrite a concurrent payment or lower
    // net underneath it.
    const changesNet = !paymentPlan && ['amount_billed', 'retainage_held', 'retainage_pct'].some(k => k in update)
    const paidGuard = q => (changesNet ? same(same(q, 'paid_at', current.paid_at), 'payment_amount', current.payment_amount) : q)
    // Putting a billing onto a draw (new non-null draw_request_id) lands only while it is
    // still approved — the 422 above checked the status we READ, and a concurrent reopen or
    // reject must not let an unapproved invoice onto the draw. A single PATCH that approves
    // (pending → approved) and tags is covered by the status CAS on 'pending' instead.
    const tagging = isPM(auth.role) && !!update.draw_request_id && update.draw_request_id !== (current.draw_request_id || null)
    const approvingNow = fields.status === 'approved' && current.status !== 'approved'
    const tagGuard = q => (tagging && !approvingNow ? q.eq('status', 'approved') : q)
    // A waiver-term edit lands only on the signature state we read, so a signature that
    // arrives mid-edit is neither silently voided nor silently kept.
    const waiverGuard = q => (isPM(auth.role) && termChanges.length ? same(q, 'lien_waiver_signed_at', current.lien_waiver_signed_at) : q)
    const statusGuard = q => waiverGuard(tagGuard(paidGuard(payGuard(linkGuard(fields.status && fields.status !== current.status ? q.eq('status', current.status) : q)))))

    // First review of a billing on a draw (the lock above only lets that through on an OPEN
    // draw, with no other financial change): the write must also see the draw still open.
    const firstReview = isPM(auth.role) && !!current.draw_request_id && !!fields.status && fields.status !== current.status
    let saved = null
    if (firstReview) {
      const bad = await firstReviewWrite(id, current.draw_request_id, fields.status, update)
      if (bad) return Response.json({ error: bad.error }, { status: bad.status })
      const { data: reloaded } = await adminSupabase.from('billing_submissions').select(SAVED_COLS).eq('id', id).maybeSingle()
      saved = reloaded
    } else {
      const write = patch => statusGuard(adminSupabase.from('billing_submissions').update(patch).eq('id', id)).select(SAVED_COLS)
      let written = update
      let { data: updatedRows, error } = await write(written)
      // 062 not applied yet: void without the history / signed-terms columns.
      if (error && mentions062(error)) {
        written = without062(written)
        ;({ data: updatedRows, error } = await write(written))
      }
      if (error?.message?.includes('schema cache')) {
        ({ data: updatedRows, error } = await write(withoutNew032(written)))
      }
      if (error) return Response.json({ error: error.message }, { status: 500 })
      if (!updatedRows?.length) return Response.json({ error: 'This billing was changed by someone else. Refresh and try again.' }, { status: 409 })
      saved = updatedRows[0]
    }
    // The row as it was saved (falls back to read + patch if the reload came back empty).
    const savedRow = { ...current, ...update, ...(saved || {}) }

    // Log auditable changes
    const fmtAmt = v => v != null ? '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
    if (isPM(auth.role)) {
      if (fields.status && fields.status !== current.status) {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'status', old_value: current.status, new_value: fields.status, changed_by: auth.userId, note: `Billing status changed to "${fields.status}" — ${current.company_name || ''}` })
        if (current.sub_id && (fields.status === 'approved' || fields.status === 'rejected')) {
          const fmtBill = v => '$' + parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          notify({
            recipient_id: current.sub_id,
            type:         `billing_${fields.status}`,
            title:        fields.status === 'approved' ? `Billing approved — ${fmtBill(savedRow.amount_billed)}` : `Billing returned — please review and resubmit`,
            body:         fields.status === 'rejected' ? (rawFields.rejection_reason || 'Check your billing history for the reason.') : null,
            link:         fields.status === 'rejected' ? 'history' : 'history',
            job_id:       current.job_id,
            entity_type:  'billing',
            entity_id:    id,
            dedup_key:    `billing:${fields.status}:${id}`,
          })
        }
      }
      if ('amount_billed' in fields && String(fields.amount_billed) !== String(current.amount_billed)) {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'amount_billed', old_value: fmtAmt(current.amount_billed), new_value: fmtAmt(fields.amount_billed), changed_by: auth.userId, note: `Billing amount updated — ${current.company_name || ''}` })
      }
      if (waiverVoided) {
        const signedOn = String(current.lien_waiver_signed_at).slice(0, 10)
        const signedAmt = fmtAmt(current.lien_waiver_amount ?? current.amount_billed) || '$0.00'
        await logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'lien_waiver', old_value: `signed ${signedOn} by ${current.lien_waiver_signer_name || 'unknown'} for ${signedAmt}`, new_value: 'voided', changed_by: auth.userId, note: 'Lien waiver voided — billing amount/retainage/period changed; a new waiver is sent to the sub now if the billing stays approved, or when it is approved again.' })
      }
      if (savedDespiteDup) {
        await logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'invoice_number', old_value: current.invoice_number ?? null, new_value: fields.invoice_number, changed_by: auth.userId, note: `Saved despite possible duplicate of Invoice #${savedDespiteDup.invoice_number} (${savedDespiteDup.id})` })
      }
      if (fields.ready_to_pay === true && (fields.status || current.status) === 'approved') {
        logChange({ job_id: current.job_id, entity_type: 'billing', entity_id: id, field_name: 'ready_to_pay', old_value: 'false', new_value: 'true', changed_by: auth.userId, note: `Marked ready to pay — ${current.company_name || ''}` })
      }
    }

    // Send ready-to-pay email notification (PM only)
    if (isPM(auth.role) && fields.ready_to_pay === true) {
      try {
        const { data: sub } = await adminSupabase
          .from('billing_submissions')
          .select('company_name, amount_billed, retainage_held, jobs(job_number, project_name)')
          .eq('id', id)
          .single()
        if (sub) {
          const gross = parseFloat(sub.amount_billed || 0)
          const ret = parseFloat(sub.retainage_held || 0)
          const net = gross - ret
          const fmt = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const adminEmail = process.env.PM_EMAIL || 'management@nvim.co'
          const adminUrl = siteUrl('/dashboard')
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'NV Construction <onboarding@resend.dev>',
            to: adminEmail,
            subject: `Check ready to pay — ${sub.company_name} · #${sub.jobs?.job_number}`,
            html: `<div style="font-family:sans-serif;background:#0a0a0a;color:#f1f1f1;padding:32px;max-width:520px;margin:0 auto;border-radius:12px;">
              <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 12px">✓ Check ready to pay</p>
              <p style="color:#aaa;margin:0 0 4px"><strong style="color:#f1f1f1">${sub.company_name}</strong> — Job <strong style="color:#f1f1f1">#${sub.jobs?.job_number} ${sub.jobs?.project_name || ''}</strong></p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
                <tr><td style="color:#888;padding:4px 0">Gross billed</td><td style="text-align:right;color:#f1f1f1;font-family:monospace">${fmt(gross)}</td></tr>
                ${ret > 0 ? `<tr><td style="color:#888;padding:4px 0">Retainage held</td><td style="text-align:right;color:#e8590c;font-family:monospace">− ${fmt(ret)}</td></tr>` : ''}
                <tr style="border-top:1px solid #2a2a2a"><td style="color:#f1f1f1;font-weight:700;padding:6px 0">Net check amount</td><td style="text-align:right;color:#4ade80;font-weight:800;font-size:18px;font-family:monospace">${fmt(net)}</td></tr>
              </table>
              <a href="${adminUrl}" style="display:inline-block;background:#e8590c;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open Portal →</a>
            </div>`,
          }).catch(() => {})
        }
      } catch {}
    }

    // Approval (pending → approved), from ANY screen: email the sub and send the conditional
    // lien waiver here, so the dashboard, residential and commercial job pages all behave the
    // same. The waiver helper skips a billing whose waiver was already sent / signed, so an
    // older client's follow-up POST /api/lien-waiver can't email twice.
    // Rejection: email only when the screen asks (email_sub), as before.
    let emailError = null
    let waiverError = null
    let waiverSent = false
    const decided = isPM(auth.role) && fields.status && fields.status !== current.status
    if (decided && fields.status === 'approved' && current.status === 'pending') {
      emailError = await emailBillingDecision(savedRow, 'approved', null)
      const w = await sendLienWaiver({ db: adminSupabase, resend, submissionId: id })
      if (!w.ok) waiverError = w.error
      else waiverSent = !w.skipped
    } else if (decided && emailSub && (fields.status === 'approved' || fields.status === 'rejected')) {
      emailError = await emailBillingDecision(savedRow, fields.status, fields.rejection_reason)
    }

    // A signed waiver voided on a billing that stays approved: nothing will approve it
    // again, so send the fresh waiver now (signed_at / sent_at were just cleared). The
    // edit is already saved; a send failure is only reported. A billing moved out of
    // approved gets its waiver from the pending → approved path above later.
    const resendVoided = waiverVoided && !decided && current.status === 'approved' && savedRow.status === 'approved'
    if (resendVoided) {
      try {
        const w = await sendLienWaiver({ db: adminSupabase, resend, submissionId: id })
        if (!w.ok) waiverError = w.error
        else waiverSent = !w.skipped
      } catch (e) {
        waiverError = e?.message || 'Could not send the new lien waiver.'
      }
    }

    return Response.json({
      ok: true, emailError,
      ...((decided && fields.status === 'approved') || resendVoided ? { waiverSent, waiverError } : {}),
      ...('draw_request_id' in update && update.draw_request_id === null && current.draw_request_id ? { untagged: true } : {}),
      ...(paymentPlan?.summary ? { payment: paymentPlan.summary } : {}),
      ...(waiverVoided ? { waiverVoided: true } : {}),
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const denied = await denyJobOf(adminSupabase, auth, 'billing_submissions', id)
    if (denied) return denied

    const { data: row, error: rowErr } = await adminSupabase.from('billing_submissions')
      .select('id, status, draw_request_id, paid_at, payment_amount').eq('id', id).maybeSingle()
    if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 })
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    const block = billingDeleteBlock(row)
    if (block) return Response.json({ error: block }, { status: 409 })

    const { error } = await adminSupabase.from('billing_submissions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
