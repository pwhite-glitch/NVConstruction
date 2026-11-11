import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isMissingPaymentTypeColumn, PAYMENT_TYPE_NOT_SAVED_WARNING } from '../../../lib/payment-route'
import { todayCentral } from '../../../lib/central-date'
import { denyUnlessOnJob, seesAllJobs } from '../../../lib/roles'
import { logChange } from '../../../lib/change-log'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Every job-scoped PO operation uses denyUnlessOnJob: Owner/admin pass,
// PM/APM/super only on their own jobs (an unassigned super is refused).

// Columns of the STORED PO used for the status gates and change_log diffs.
const PO_GUARD_COLS = 'id, job_id, attachment_url, status, vendor_name, amount, payment_type, budget_item_id, draw_request_id, description, notes, po_number'

// A closed PO may only change status (reopen later); everything else is locked.
const CLOSED_EDITABLE = new Set(['status', 'issued_date'])

// Normalized the same way PUT stores lines, so a stored line and its re-sent copy match.
const lineKey = i => [i.description ?? '', parseFloat(i.qty) || 1, i.unit || '', parseFloat(i.unit_price) || 0].join('|')
const fmtAmount = n => String(Number(n) || 0)

// Load a PO by id and guard its real job. Returns { po } or { denied }.
async function loadPOForCaller(auth, id) {
  const { data: po, error } = await adminSupabase.from('purchase_orders').select(PO_GUARD_COLS).eq('id', id).maybeSingle()
  if (error) return { denied: Response.json({ error: error.message }, { status: 500 }) }
  if (!po) return { denied: Response.json({ error: 'Purchase order not found.' }, { status: 404 }) }
  const denied = await denyUnlessOnJob(adminSupabase, auth, po.job_id)
  if (denied) return { denied }
  return { po }
}

// budget_item_id / draw_request_id must belong to the PO's job. Returns a Response or null.
async function denyForeignRefs(jobId, { budget_item_id, draw_request_id }) {
  const checks = [['budget_items', budget_item_id, 'Budget line'], ['draw_requests', draw_request_id, 'Draw']]
  for (const [table, refId, label] of checks) {
    if (!refId) continue
    const { data, error } = await adminSupabase.from(table).select('id, job_id').eq('id', refId).maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data || data.job_id !== jobId) return Response.json({ error: `${label} is not on this purchase order's job.` }, { status: 400 })
  }
  return null
}

// A new attachment is attachment: { path, uploadReceipt }, uploaded directly to Storage
// (POST /api/file-upload, target po-attachment) for this job (and, on PUT, this PO).
// Multipart is refused. attachment_url stays the raw storage path.
async function readPOBody(request) {
  const multipart = rejectMultipart(request)
  if (multipart) return { error: multipart }
  let body
  try { body = await request.json() } catch { return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const inline = inlineFileContentError(body)
  if (inline) return { error: Response.json({ error: inline }, { status: 400 }) }
  return { body }
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)

  const sign = searchParams.get('sign')
  if (sign) {
    // Only sign a path that is a real PO's attachment, and only for callers on that PO's job.
    const { data: po, error: poErr } = await adminSupabase.from('purchase_orders').select('id, job_id').eq('attachment_url', sign).limit(1).maybeSingle()
    if (poErr) return Response.json({ error: poErr.message }, { status: 500 })
    if (!po) return Response.json({ error: 'Attachment not found.' }, { status: 404 })
    const denied = await denyUnlessOnJob(adminSupabase, auth, po.job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase.storage.from('purchase-order-docs').createSignedUrl(sign, 3600)
    if (error || !data?.signedUrl) return Response.json({ error: error?.message || 'Could not generate URL' }, { status: 500 })
    return Response.json({ signedUrl: data.signedUrl })
  }

  const job_id = searchParams.get('job_id')

  // No job_id: list POs across all jobs (admin Purchase Orders tab). Owner/admin only.
  if (!job_id) {
    if (!seesAllJobs(auth.role)) {
      return Response.json({ error: 'Only an Owner or Admin can list purchase orders across all jobs. Open a job to see its POs.' }, { status: 403 })
    }
    const { data: pos, error } = await adminSupabase
      .from('purchase_orders')
      .select('*, jobs(job_number, project_name)')
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ purchase_orders: pos || [] })
  }

  const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
  if (denied) return denied

  const { data: pos, error } = await adminSupabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('job_id', job_id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const sorted = (pos || []).map(po => ({
    ...po,
    purchase_order_items: (po.purchase_order_items || []).sort((a, b) => a.sort_order - b.sort_order),
  }))

  return Response.json({ purchase_orders: sorted })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const parsed = await readPOBody(request)
    if (parsed.error) return parsed.error
    const body = parsed.body
    let attachment_url = null

    const { job_id, vendor_name, description, budget_item_id, notes, payment_type, status = 'draft', items = [], created_by, attachment } = body

    if (!job_id || !vendor_name) return Response.json({ error: 'job_id and vendor_name required' }, { status: 400 })
    const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const { data: jobRow, error: jobErr } = await adminSupabase.from('jobs').select('id, job_number').eq('id', job_id).maybeSingle()
    if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
    if (!jobRow) return Response.json({ error: 'Job not found.' }, { status: 404 })
    const refDenied = await denyForeignRefs(job_id, { budget_item_id })
    if (refDenied) return refDenied
    if (attachment !== undefined && attachment !== null) {
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'po-attachment', subject: auth.userId, ctx: { job: job_id } })
      if (!v.ok) return attachmentErrorResponse(v)
      attachment_url = v.path
    }

    const { count, error: cntErr } = await adminSupabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('job_id', job_id)
    if (cntErr) return Response.json({ error: cntErr.message }, { status: 500 })
    const seq = String((count || 0) + 1).padStart(3, '0')
    const po_number = `PO-${jobRow?.job_number || 'XX'}-${seq}`

    const amount = items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0)

    const insertRow = { job_id, po_number, vendor_name, description: description || null, budget_item_id: budget_item_id || null, notes: notes || null, status, amount, issued_date: status === 'issued' ? todayCentral() : null, created_by: created_by || null, attachment_url }

    // Try with payment_type first; if the column doesn't exist yet (migration 004), save the rest and warn
    if (payment_type) insertRow.payment_type = payment_type
    let warning = null
    let { data: po, error: poErr } = await adminSupabase.from('purchase_orders').insert(insertRow).select().single()
    if (payment_type && isMissingPaymentTypeColumn(poErr)) {
      delete insertRow.payment_type
      const retry = await adminSupabase.from('purchase_orders').insert(insertRow).select().single()
      po = retry.data; poErr = retry.error
      if (!poErr) warning = PAYMENT_TYPE_NOT_SAVED_WARNING
    }

    if (poErr) return Response.json({ error: poErr.message }, { status: 500 })

    if (items.length > 0) {
      const lineItems = items.map((i, idx) => ({
        po_id: po.id,
        description: i.description,
        qty: parseFloat(i.qty) || 1,
        unit: i.unit || null,
        unit_price: parseFloat(i.unit_price) || 0,
        amount: (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0),
        sort_order: idx,
      }))
      const { error: itemsErr } = await adminSupabase.from('purchase_order_items').insert(lineItems)
      if (itemsErr) {
        // Don't leave a PO with an amount but no lines.
        const { error: undoErr } = await adminSupabase.from('purchase_orders').delete().eq('id', po.id)
        return Response.json({ error: 'PO line items not saved: ' + itemsErr.message + (undoErr ? ` (PO ${po.po_number} was created without lines: ${undoErr.message})` : ' — nothing was saved.') }, { status: 500 })
      }
    }

    return Response.json(warning ? { purchase_order: po, warning } : { purchase_order: po })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const parsed = await readPOBody(request)
    if (parsed.error) return parsed.error
    let newAttachmentUrl = undefined

    // attachment omitted / null keeps the saved attachment.
    const { id, items, attachment, ...fields } = parsed.body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { po, denied } = await loadPOForCaller(auth, id)
    if (denied) return denied
    // The saved PO's job is authoritative. A PO can't be moved to another job here.
    if (fields.job_id !== undefined && fields.job_id !== po.job_id) {
      return Response.json({ error: 'A purchase order cannot be moved to another job.' }, { status: 400 })
    }
    const updates = {}
    if (fields.status !== undefined) {
      updates.status = fields.status
      if (fields.status === 'issued' && !fields.issued_date) updates.issued_date = todayCentral()
    }
    if (fields.vendor_name !== undefined) updates.vendor_name = fields.vendor_name
    if (fields.description !== undefined) updates.description = fields.description || null
    if (fields.budget_item_id !== undefined) updates.budget_item_id = fields.budget_item_id || null
    if (fields.notes !== undefined) updates.notes = fields.notes || null
    if (fields.payment_type) updates.payment_type = fields.payment_type  // requires migration 004
    if (fields.draw_request_id !== undefined) updates.draw_request_id = fields.draw_request_id || null
    if (fields.drawn_at !== undefined) updates.drawn_at = fields.drawn_at || null

    // Gate on the STORED status, never the client's. A closed PO accepts a status-only
    // change; any other column, line items (even []) or a new attachment is refused.
    const wantsUpload = attachment !== undefined && attachment !== null
    if (po.status === 'closed' && (items !== undefined || wantsUpload || Object.keys(updates).some(k => !CLOSED_EDITABLE.has(k)))) {
      return Response.json({ error: 'This purchase order is closed and cannot be edited.' }, { status: 409 })
    }

    const refDenied = await denyForeignRefs(po.job_id, {
      budget_item_id: fields.budget_item_id || null,
      draw_request_id: fields.draw_request_id || null,
    })
    if (refDenied) return refDenied

    // Prior lines, for the change_log line-items summary (read before they are replaced).
    let oldItems = null
    if (items !== undefined) {
      const { data: prior, error: priorErr } = await adminSupabase.from('purchase_order_items').select('id, description, qty, unit, unit_price, amount, sort_order').eq('po_id', id)
      if (priorErr) return Response.json({ error: 'PO line items not saved: ' + priorErr.message }, { status: 500 })
      oldItems = (prior || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    }

    if (wantsUpload) {
      // Verified for THIS PO on its stored job. The closed gate above used the status read in
      // this request, so a PO closed while the file was uploading stays locked.
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'po-attachment', subject: auth.userId, ctx: { job: po.job_id, rec: po.id } })
      if (!v.ok) return attachmentErrorResponse(v)
      newAttachmentUrl = v.path
    }
    if (newAttachmentUrl !== undefined) updates.attachment_url = newAttachmentUrl

    if (items !== undefined) {
      updates.amount = items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0)
      const { error: delItemsErr } = await adminSupabase.from('purchase_order_items').delete().eq('po_id', id)
      if (delItemsErr) return Response.json({ error: 'PO line items not saved: ' + delItemsErr.message }, { status: 500 })
      if (items.length > 0) {
        const { error: insItemsErr } = await adminSupabase.from('purchase_order_items').insert(
          items.map((i, idx) => ({
            po_id: id,
            description: i.description,
            qty: parseFloat(i.qty) || 1,
            unit: i.unit || null,
            unit_price: parseFloat(i.unit_price) || 0,
            amount: (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0),
            sort_order: idx,
          }))
        )
        if (insItemsErr) return Response.json({ error: 'PO line items not saved: ' + insItemsErr.message }, { status: 500 })
      }
    }

    let warning = null
    if (Object.keys(updates).length > 0) {
      // With a new attachment the write also requires the PO to still not be closed (a close that
      // lands while this request runs refuses the attachment instead of slipping it in).
      const write = u => {
        const q = adminSupabase.from('purchase_orders').update(u).eq('id', id).eq('job_id', po.job_id)
        return wantsUpload ? q.neq('status', 'closed').select('id') : q
      }
      let { data: upRows, error: upErr } = await write(updates)
      if ('payment_type' in updates && isMissingPaymentTypeColumn(upErr)) {
        const { payment_type: _pt, ...updatesWithout } = updates
        upErr = null
        if (Object.keys(updatesWithout).length > 0) {
          ({ data: upRows, error: upErr } = await write(updatesWithout))
        }
        if (!upErr) warning = PAYMENT_TYPE_NOT_SAVED_WARNING
      }
      if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
      if (wantsUpload && !upRows?.length) return Response.json({ error: 'This purchase order is closed and cannot be edited.' }, { status: 409 })
    }

    // change_log (server-only). Only real changes; logChange never throws.
    const diffs = []
    const add = (field_name, oldV, newV) => {
      const o = oldV == null || oldV === '' ? null : String(oldV)
      const n = newV == null || newV === '' ? null : String(newV)
      if (o !== n) diffs.push({ field_name, old_value: o, new_value: n })
    }
    if ('vendor_name' in updates) add('vendor_name', po.vendor_name, updates.vendor_name)
    if ('payment_type' in updates && !warning) add('payment_type', po.payment_type, updates.payment_type)
    if ('budget_item_id' in updates) add('budget_item_id', po.budget_item_id, updates.budget_item_id)
    if ('status' in updates) add('status', po.status, updates.status)
    if (items !== undefined) {
      add('amount', fmtAmount(po.amount), fmtAmount(updates.amount))
      const sameLines = oldItems.length === items.length && oldItems.every((o, idx) => lineKey(o) === lineKey(items[idx]))
      const oldSummary = `${oldItems.length} lines / ${fmtAmount(po.amount)}`
      const newSummary = `${items.length} lines / ${fmtAmount(updates.amount)}`
      // Same count and total but different lines still gets a row, marked so it isn't a no-op.
      if (!sameLines || oldSummary !== newSummary) add('line_items', oldSummary, oldSummary === newSummary ? `${newSummary} (lines changed)` : newSummary)
    }
    for (const d of diffs) {
      await logChange({ job_id: po.job_id, entity_type: 'purchase_order', entity_id: po.id, changed_by: auth.userId, ...d })
    }

    return Response.json(warning ? { ok: true, warning } : { ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { po, denied } = await loadPOForCaller(auth, id)
    if (denied) return denied
    if (po.status !== 'draft') return Response.json({ error: 'Only draft purchase orders can be deleted.' }, { status: 409 })
    const { error } = await adminSupabase.from('purchase_orders').delete().eq('id', id).eq('job_id', po.job_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
