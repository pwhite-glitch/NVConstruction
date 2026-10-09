import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SALES_ROLES = new Set(['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
const BUCKET = 'sales-docs'

export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  if (!SALES_ROLES.has(auth.role) && auth.role !== 'super') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)

    // Signed URL for download
    const storagePath = searchParams.get('signed_url')
    if (storagePath) {
      const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    const order_id = searchParams.get('order_id')
    if (!order_id) return Response.json({ error: 'order_id required' }, { status: 400 })

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
      const meta = JSON.parse(formData.get('data') || '{}')

      if (!file || !meta.order_id) return Response.json({ error: 'file and order_id required' }, { status: 400 })

      const ext   = file.name.split('.').pop().toLowerCase()
      const safe  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path  = `${meta.order_id}/${Date.now()}_${safe}`
      const buffer = Buffer.from(await file.arrayBuffer())

      const { error: uploadErr } = await adminSupabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: file.type || 'application/octet-stream' })

      if (uploadErr) return Response.json({ error: 'Upload failed: ' + uploadErr.message }, { status: 500 })

      const { data: doc, error: dbErr } = await adminSupabase
        .from('sales_order_docs')
        .insert({
          order_id:           meta.order_id,
          file_name:          file.name,
          storage_path:       path,
          category:           meta.category || 'general',
          visible_to_customer: meta.visible_to_customer || false,
          uploaded_by:        auth.userId,
          uploaded_by_name:   meta.uploaded_by_name || null,
          notes:              meta.notes || null,
          file_size_bytes:    file.size || null,
        })
        .select('id')
        .single()

      if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

      // Log to history
      await adminSupabase.from('sales_order_history').insert({
        order_id:   meta.order_id,
        actor_id:   auth.userId,
        actor_name: meta.uploaded_by_name || 'Staff',
        action:     'doc_upload',
        details:    { file_name: file.name, category: meta.category || 'general', doc_id: doc.id },
      })

      return Response.json({ ok: true, id: doc.id, storage_path: path })
    }

    const body = await request.json()
    const { action } = body

    // ── Toggle customer visibility ─────────────────────────────────────────────
    if (action === 'toggle_customer_visibility') {
      const { id, visible_to_customer } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      const { error } = await adminSupabase
        .from('sales_order_docs')
        .update({ visible_to_customer })
        .eq('id', id)

      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!['pm', 'apm', 'admin'].includes(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { id } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      const { data: doc } = await adminSupabase.from('sales_order_docs').select('storage_path,order_id,file_name').eq('id', id).maybeSingle()
      if (!doc) return Response.json({ error: 'Not found' }, { status: 404 })

      await adminSupabase.storage.from(BUCKET).remove([doc.storage_path])
      await adminSupabase.from('sales_order_docs').delete().eq('id', id)

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
