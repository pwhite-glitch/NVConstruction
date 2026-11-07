import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { isMissingPaymentTypeColumn, PAYMENT_TYPE_NOT_SAVED_WARNING } from '../../../lib/payment-route'
import { todayCentral } from '../../../lib/central-date'
import { denyUnlessOnJob, seesAllJobs } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Every job-scoped PO operation uses denyUnlessOnJob: Owner/admin pass,
// PM/APM/super only on their own jobs (an unassigned super is refused).

// Load a PO by id and guard its real job. Returns { po } or { denied }.
async function loadPOForCaller(auth, id) {
  const { data: po, error } = await adminSupabase.from('purchase_orders').select('id, job_id, attachment_url').eq('id', id).maybeSingle()
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

async function uploadPOAttachment(file, jobId) {
  const ext = file.name.split('.').pop()
  const path = `${jobId}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await adminSupabase.storage
    .from('purchase-order-docs')
    .upload(path, buffer, { contentType: file.type })
  if (error) throw new Error('File upload failed: ' + error.message)
  return path
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
    const contentType = request.headers.get('content-type') || ''
    let body = {}
    let attachment_url = null
    let file = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      body = JSON.parse(formData.get('data') || '{}')
    } else {
      body = await request.json()
    }

    const { job_id, vendor_name, description, budget_item_id, notes, payment_type, status = 'draft', items = [], created_by } = body

    if (!job_id || !vendor_name) return Response.json({ error: 'job_id and vendor_name required' }, { status: 400 })
    const denied = await denyUnlessOnJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const { data: jobRow, error: jobErr } = await adminSupabase.from('jobs').select('id, job_number').eq('id', job_id).maybeSingle()
    if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })
    if (!jobRow) return Response.json({ error: 'Job not found.' }, { status: 404 })
    const refDenied = await denyForeignRefs(job_id, { budget_item_id })
    if (refDenied) return refDenied
    if (file && file.size > 0) {
      attachment_url = await uploadPOAttachment(file, job_id)
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
    const contentType = request.headers.get('content-type') || ''
    let body = {}
    let newAttachmentUrl = undefined
    let file = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      body = JSON.parse(formData.get('data') || '{}')
    } else {
      body = await request.json()
    }

    const { id, items, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { po, denied } = await loadPOForCaller(auth, id)
    if (denied) return denied
    // The saved PO's job is authoritative. A PO can't be moved to another job here.
    if (fields.job_id !== undefined && fields.job_id !== po.job_id) {
      return Response.json({ error: 'A purchase order cannot be moved to another job.' }, { status: 400 })
    }
    const refDenied = await denyForeignRefs(po.job_id, {
      budget_item_id: fields.budget_item_id || null,
      draw_request_id: fields.draw_request_id || null,
    })
    if (refDenied) return refDenied
    if (file && file.size > 0) {
      newAttachmentUrl = await uploadPOAttachment(file, po.job_id)
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
      let { error: upErr } = await adminSupabase.from('purchase_orders').update(updates).eq('id', id).eq('job_id', po.job_id)
      if ('payment_type' in updates && isMissingPaymentTypeColumn(upErr)) {
        const { payment_type: _pt, ...updatesWithout } = updates
        upErr = null
        if (Object.keys(updatesWithout).length > 0) {
          ({ error: upErr } = await adminSupabase.from('purchase_orders').update(updatesWithout).eq('id', id).eq('job_id', po.job_id))
        }
        if (!upErr) warning = PAYMENT_TYPE_NOT_SAVED_WARNING
      }
      if (upErr) return Response.json({ error: upErr.message }, { status: 500 })
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
    const { error } = await adminSupabase.from('purchase_orders').delete().eq('id', id).eq('job_id', po.job_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
