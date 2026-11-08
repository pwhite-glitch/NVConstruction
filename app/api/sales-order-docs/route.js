import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import {
  isMb, canWorkMbOrder, isOffice, isUuidLike, ALL_DOC_CATEGORIES, MB_FORM_CATEGORIES,
  MB_MAX_UPLOAD_BYTES, CLIENT_FORM_EXTS, SUPPLIER_FORM_EXTS,
} from '../../../lib/mb-orders'
import { actorName, isMissingSchema, SCHEMA_HINT } from '../../../lib/mb-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SALES_ROLES = new Set(['principal', 'pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
const BUCKET = 'sales-docs'
const err = (error, status) => Response.json({ error }, { status })

// The real order behind a doc/order id. Fails closed.
async function loadOrder(orderId) {
  if (!orderId || typeof orderId !== 'string') return { status: 400, error: 'order_id required' }
  const { data, error } = await adminSupabase.from('sales_orders').select('id, division, salesperson_id, ops_owner_id').eq('id', orderId).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!data) return { status: 404, error: 'Order not found' }
  return { order: data }
}

// Metal-building orders: office, or a metal_rep on the order. Other divisions keep the role gate only.
async function mbDenied(auth, order) {
  if (!isMb(order)) return null
  const { data: attribution, error } = await adminSupabase.from('sales_attribution').select('salesperson_id').eq('order_id', order.id)
  if (error) return err(error.message, 500)
  if (!canWorkMbOrder(auth, order, attribution || [])) return err('You are not on this order.', 403)
  return null
}

async function loadDocBy(col, value) {
  const { data, error } = await adminSupabase.from('sales_order_docs').select('id, order_id, storage_path, file_name, category, visible_to_customer').eq(col, value).limit(1).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!data) return { status: 404, error: 'Document not found' }
  return { doc: data }
}

// Is this doc pinned by a pending/signed client-order-form request, or the signed copy?
async function pinnedBySigning(docId) {
  const a = await adminSupabase.from('signing_requests').select('id, status').eq('sales_doc_id', docId)
  if (a.error) return isMissingSchema(a.error) ? { pinned: false } : { error: a.error.message }
  if ((a.data || []).some(r => r.status === 'pending' || r.status === 'signed')) return { pinned: true }
  const b = await adminSupabase.from('signing_requests').select('id').eq('signed_doc_id', docId)
  if (b.error) return isMissingSchema(b.error) ? { pinned: false } : { error: b.error.message }
  return { pinned: (b.data || []).length > 0 }
}

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)

    // Signed URL for download: only for a real doc row (by id, or by its stored path).
    const docId = searchParams.get('doc_id')
    const storagePath = searchParams.get('signed_url')
    if (docId || storagePath) {
      if (docId && !isUuidLike(docId)) return err('Invalid document id', 400)
      const found = docId ? await loadDocBy('id', docId) : await loadDocBy('storage_path', storagePath)
      if (found.error) return err(found.error, found.status)
      const o = await loadOrder(found.doc.order_id)
      if (o.error) return err(o.error, o.status)
      const denied = await mbDenied(auth, o.order)
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUrl(found.doc.storage_path, 3600)
      if (error || !data?.signedUrl) return err(error?.message || 'Could not open the file', 500)
      return Response.json({ url: data.signedUrl })
    }

    const order_id = searchParams.get('order_id')
    if (!order_id) return Response.json({ error: 'order_id required' }, { status: 400 })
    const o = await loadOrder(order_id)
    if (o.error) return err(o.error, o.status)
    const denied = await mbDenied(auth, o.order)
    if (denied) return denied

    const { data, error } = await adminSupabase
      .from('sales_order_docs')
      .select('*')
      .eq('order_id', order_id)
      .order('created_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ docs: data || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const contentType = request.headers.get('content-type') || ''

    // ── File upload ───────────────────────────────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      let meta
      try { meta = JSON.parse(formData.get('data') || '{}') } catch { return err('Upload details could not be read.', 400) }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return err('Upload details could not be read.', 400)

      if (!file || typeof file === 'string' || !meta.order_id) return Response.json({ error: 'file and order_id required' }, { status: 400 })
      const category = meta.category || 'general'
      if (!ALL_DOC_CATEGORIES.includes(category)) return err('Unknown document category.', 400)

      const o = await loadOrder(meta.order_id)
      if (o.error) return err(o.error, o.status)
      const order = o.order
      const mb = isMb(order)
      if (MB_FORM_CATEGORIES.includes(category) && !mb) return err('Order forms are only for metal-building orders.', 400)
      const denied = await mbDenied(auth, order)
      if (denied) return denied

      const ext = String(file.name || '').split('.').pop().toLowerCase()
      if (mb) {
        if (!file.size) return err('The file is empty.', 400)
        if (file.size > MB_MAX_UPLOAD_BYTES) return err('Files must be 25 MB or smaller.', 400)
        if (category === 'client_order_form' && !CLIENT_FORM_EXTS.has(ext)) return err('Upload the client order form as a PDF (it is what the customer signs).', 400)
        if (category === 'supplier_order_form' && !SUPPLIER_FORM_EXTS.has(ext)) return err("The supplier's order form must be a PDF, image, Word or Excel file.", 400)
      }

      const safe  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path  = `${order.id}/${Date.now()}_${safe}`
      const buffer = Buffer.from(await file.arrayBuffer())
      if (mb && category === 'client_order_form' && !buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
        return err('That file is not a real PDF. Export the client order form as a PDF and upload it again.', 400)
      }

      // Versioning for the two order forms: a new upload replaces (but never changes) the previous one.
      let version = {}
      if (MB_FORM_CATEGORIES.includes(category)) {
        const { data: prev, error: prevErr } = await adminSupabase.from('sales_order_docs').select('id, version_number, created_at').eq('order_id', order.id).eq('category', category)
        if (prevErr) return err(prevErr.message, 500)
        const latest = [...(prev || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
        if (latest) version = { version_number: Math.max(...prev.map(p => Number(p.version_number || 1))) + 1, replaces_doc_id: latest.id }
      }

      const { error: uploadErr } = await adminSupabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: file.type || 'application/octet-stream' })

      if (uploadErr) return Response.json({ error: 'Upload failed: ' + uploadErr.message + '. Nothing was saved; try again.' }, { status: 500 })

      const uploaderName = mb ? await actorName(adminSupabase, auth.userId) : (meta.uploaded_by_name || null)
      const { data: doc, error: dbErr } = await adminSupabase
        .from('sales_order_docs')
        .insert({
          order_id:           order.id,
          file_name:          file.name,
          storage_path:       path,
          category,
          // The supplier's order form is internal: never shared with the customer.
          visible_to_customer: category === 'supplier_order_form' ? false : (meta.visible_to_customer === true),
          uploaded_by:        auth.userId,
          uploaded_by_name:   uploaderName,
          notes:              typeof meta.notes === 'string' ? meta.notes : null,
          file_size_bytes:    file.size || null,
          ...version,
        })
        .select('id')
        .single()

      if (dbErr) {
        // Don't leave an orphan file behind.
        await adminSupabase.storage.from(BUCKET).remove([path])
        const hint = isMissingSchema(dbErr) || /category/i.test(dbErr.message || '') && MB_FORM_CATEGORIES.includes(category) ? ` ${SCHEMA_HINT}` : ''
        return Response.json({ error: `The file uploaded but could not be recorded (${dbErr.message}). Nothing was saved; try again.${hint}` }, { status: 500 })
      }

      // Log to history
      await adminSupabase.from('sales_order_history').insert({
        order_id:   order.id,
        actor_id:   auth.userId,
        actor_name: uploaderName || 'Staff',
        action:     'doc_upload',
        details:    { file_name: file.name, category, doc_id: doc.id },
      })

      return Response.json({ ok: true, id: doc.id, storage_path: path })
    }

    const body = await request.json()
    const { action } = body

    // ── Toggle customer visibility ─────────────────────────────────────────────
    if (action === 'toggle_customer_visibility') {
      const { id, visible_to_customer } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })
      if (typeof visible_to_customer !== 'boolean') return err('visible_to_customer must be true or false', 400)
      const found = await loadDocBy('id', id)
      if (found.error) return err(found.error, found.status)
      const o = await loadOrder(found.doc.order_id)
      if (o.error) return err(o.error, o.status)
      const denied = await mbDenied(auth, o.order)
      if (denied) return denied
      if (visible_to_customer && found.doc.category === 'supplier_order_form') return err("The supplier's order form stays internal.", 400)

      const { error } = await adminSupabase
        .from('sales_order_docs')
        .update({ visible_to_customer })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!isOffice(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { id } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      const found = await loadDocBy('id', id)
      if (found.error) return err(found.error, found.status)
      const doc = found.doc
      const o = await loadOrder(doc.order_id)
      if (o.error) return err(o.error, o.status)
      if (isMb(o.order)) {
        const pin = await pinnedBySigning(id)
        if (pin.error) return err(pin.error, 500)
        if (pin.pinned) return err('This document is part of a signature request or is the signed copy, so it cannot be deleted.', 409)
        const { data: wf, error: wfErr } = await adminSupabase.from('mb_order_workflow').select('supplier_turned_in_doc_id').eq('order_id', o.order.id).maybeSingle()
        if (wfErr && !isMissingSchema(wfErr)) return err(wfErr.message, 500)
        if (wf?.supplier_turned_in_doc_id === id) return err('This supplier order form was turned in, so it cannot be deleted.', 409)
      }

      // Row first, then the file: a refused delete never leaves a row pointing at nothing.
      const { error: delErr } = await adminSupabase.from('sales_order_docs').delete().eq('id', id)
      if (delErr) return err(delErr.message, 500)
      await adminSupabase.storage.from(BUCKET).remove([doc.storage_path])

      await adminSupabase.from('sales_order_history').insert({
        order_id:   doc.order_id,
        actor_id:   auth.userId,
        actor_name: 'Staff',
        action:     'doc_deleted',
        details:    { file_name: doc.file_name },
      })

      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
