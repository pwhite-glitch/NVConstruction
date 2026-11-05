import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { todayCentral } from '../../../lib/central-date'
import { denyJob, denyJobOf } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GC attachments live in the 'receipts' bucket (same as direct-cost receipts).
const GC_DOC_BUCKET = 'receipts'

async function uploadGCDoc(file, jobId) {
  if (!jobId) throw new Error('Cannot upload attachment: entry has no job')
  const ext = file.name.split('.').pop()
  const path = `${jobId}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await adminSupabase.storage
    .from(GC_DOC_BUCKET)
    .upload(path, buffer, { contentType: file.type })
  if (error) throw new Error('File upload failed: ' + error.message)
  return path
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)

  // ?doc_id=<gc id>[&path=<doc_url>] → { url } signed URL for that entry's attachment.
  // Signs only the path stored on the entry, after checking the caller can access its job.
  const doc_id = searchParams.get('doc_id')
  if (doc_id) return signGCDoc(auth, doc_id, searchParams.get('path'))

  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ entries: [] })
  const denied = await denyJob(adminSupabase, auth, job_id)
  if (denied) return denied

  const { data, error } = await adminSupabase
    .from('general_conditions')
    .select('*')
    .eq('job_id', job_id)
    .order('entry_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data || [] })
}

async function signGCDoc(auth, id, requestedPath) {
  const { data: entry, error } = await adminSupabase
    .from('general_conditions')
    .select('id, job_id, doc_url')
    .eq('id', id)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!entry) return Response.json({ error: 'Not found.' }, { status: 404 })
  const denied = await denyJob(adminSupabase, auth, entry.job_id)
  if (denied) return denied
  if (!entry.doc_url) return Response.json({ error: 'No attachment on this entry.' }, { status: 404 })
  if (requestedPath && requestedPath !== entry.doc_url) {
    return Response.json({ error: 'Attachment does not belong to this entry.' }, { status: 403 })
  }
  const { data, error: signErr } = await adminSupabase.storage.from(GC_DOC_BUCKET).createSignedUrl(entry.doc_url, 3600)
  if (signErr || !data?.signedUrl) {
    return Response.json({ error: signErr?.message || 'Could not open attachment.' }, { status: 500 })
  }
  return Response.json({ url: data.signedUrl })
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const contentType = request.headers.get('content-type') || ''
    let body = {}
    let doc_url = null
    let file = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      body = JSON.parse(formData.get('data') || '{}')
    } else {
      body = await request.json()
    }

    const { job_id, description, amount, category, entry_date, budget_item_id, notes, created_by, draw_request_id } = body
    if (!job_id || !description || !amount) {
      return Response.json({ error: 'job_id, description, and amount are required' }, { status: 400 })
    }
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    if (file && file.size > 0) {
      doc_url = await uploadGCDoc(file, job_id)
    }

    const { data, error } = await adminSupabase
      .from('general_conditions')
      .insert({
        job_id,
        description,
        amount: parseFloat(amount),
        category: category || 'general',
        entry_date: entry_date || todayCentral(),
        budget_item_id: budget_item_id || null,
        notes: notes || null,
        created_by: created_by || null,
        draw_request_id: draw_request_id || null,
        drawn_at: draw_request_id ? new Date().toISOString() : null,
        doc_url,
      })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ entry: data })
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
    let doc_url = undefined
    let file = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file')
      body = JSON.parse(formData.get('data') || '{}')
    } else {
      body = await request.json()
    }

    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Load the entry's own job_id; never trust a job_id from the request for access or the storage path.
    const { data: existing, error: loadErr } = await adminSupabase
      .from('general_conditions')
      .select('id, job_id')
      .eq('id', id)
      .maybeSingle()
    if (loadErr) return Response.json({ error: loadErr.message }, { status: 500 })
    if (!existing) return Response.json({ error: 'Not found.' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, existing.job_id)
    if (denied) return denied
    if (file && file.size > 0) {
      doc_url = await uploadGCDoc(file, existing.job_id)
    }

    const updates = {}
    if (fields.description !== undefined) updates.description = fields.description
    if (fields.amount !== undefined) updates.amount = parseFloat(fields.amount)
    if (fields.category !== undefined) updates.category = fields.category
    if (fields.entry_date !== undefined) updates.entry_date = fields.entry_date
    if (fields.budget_item_id !== undefined) updates.budget_item_id = fields.budget_item_id || null
    if (fields.notes !== undefined) updates.notes = fields.notes || null
    if (fields.draw_request_id !== undefined) updates.draw_request_id = fields.draw_request_id || null
    if (fields.drawn_at !== undefined) updates.drawn_at = fields.drawn_at || null
    if (doc_url !== undefined) updates.doc_url = doc_url

    const { error } = await adminSupabase.from('general_conditions').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
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
    const denied = await denyJobOf(adminSupabase, auth, 'general_conditions', id)
    if (denied) return denied
    const { error } = await adminSupabase.from('general_conditions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
