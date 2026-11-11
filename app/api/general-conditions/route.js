import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { todayCentral } from '../../../lib/central-date'
import { denyJob, denyJobOf } from '../../../lib/roles'
import { drawTargetError, gcEditLockError, gcDeleteLockError } from '../../../lib/draw-guards'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// The budget line must exist and be on this job. Null when OK, else a Response.
async function badBudgetLine(budgetItemId, jobId) {
  if (!budgetItemId) return null
  const { data, error } = await adminSupabase.from('budget_items').select('id, job_id').eq('id', budgetItemId).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'That budget line no longer exists. Refresh and pick another.' }, { status: 422 })
  if (data.job_id !== jobId) return Response.json({ error: 'That budget line belongs to a different job.' }, { status: 422 })
  return null
}

// GC attachments live in the 'receipts' bucket (same as direct-cost receipts).
const GC_DOC_BUCKET = 'receipts'

// A new attachment is attachment: { path, uploadReceipt } uploaded directly to Storage
// (POST /api/file-upload, target gc-doc) for this job (and, on PUT, this entry). doc_url stays
// the raw path in GC_DOC_BUCKET. Multipart is refused.
async function readGCBody(request) {
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
    const parsed = await readGCBody(request)
    if (parsed.error) return parsed.error
    const body = parsed.body
    let doc_url = null

    const { job_id, description, amount, category, entry_date, budget_item_id, notes, draw_request_id, attachment } = body
    if (!job_id || !description || !amount) {
      return Response.json({ error: 'job_id, description, and amount are required' }, { status: 400 })
    }
    if (!Number.isFinite(parseFloat(amount))) return Response.json({ error: 'Amount must be a number.' }, { status: 400 })
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    // Draw: must exist, be on this job and be open. Budget line: on this job.
    if (draw_request_id) {
      const { data: draw, error: drawErr } = await adminSupabase.from('draw_requests').select('id, job_id, draw_number, status').eq('id', draw_request_id).maybeSingle()
      if (drawErr) return Response.json({ error: drawErr.message }, { status: 500 })
      const bad = drawTargetError(draw, job_id)
      if (bad) return Response.json({ error: bad.error }, { status: bad.status })
    }
    const badLine = await badBudgetLine(budget_item_id, job_id)
    if (badLine) return badLine
    if (attachment !== undefined && attachment !== null) {
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'gc-doc', subject: auth.userId, ctx: { job: job_id } })
      if (!v.ok) return attachmentErrorResponse(v)
      doc_url = v.path
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
        created_by: auth.userId || null, // session, never the request body
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
    const parsed = await readGCBody(request)
    if (parsed.error) return parsed.error
    // Omitted / null attachment keeps the saved doc_url.
    let doc_url = undefined

    const { id, attachment, ...fields } = parsed.body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Load the entry's own job_id; never trust a job_id from the request for access or the storage path.
    const { data: existing, error: loadErr } = await adminSupabase
      .from('general_conditions')
      .select('id, job_id, draw_request_id, amount, description, budget_item_id, entry_date')
      .eq('id', id)
      .maybeSingle()
    if (loadErr) return Response.json({ error: loadErr.message }, { status: 500 })
    if (!existing) return Response.json({ error: 'Not found.' }, { status: 404 })
    const denied = await denyJob(adminSupabase, auth, existing.job_id)
    if (denied) return denied

    // Tagging / untagging only through /api/draw-requests (add_gc_ids / remove_gc_ids), which
    // checks the draw is open. A forged draw_request_id: null / drawn_at: null is refused here.
    const drawChange = (fields.draw_request_id !== undefined && (fields.draw_request_id || null) !== (existing.draw_request_id || null))
      || (fields.drawn_at !== undefined && (fields.drawn_at || null) === null && existing.draw_request_id)
    if (drawChange) {
      return Response.json({ error: 'Add to or take off a draw from the Draws tab, not by editing the entry.' }, { status: 409 })
    }
    const locked = gcEditLockError(existing, fields)
    if (locked) return Response.json({ error: locked.error }, { status: locked.status })
    if (fields.amount !== undefined && !Number.isFinite(parseFloat(fields.amount))) {
      return Response.json({ error: 'Amount must be a number.' }, { status: 400 })
    }
    if (fields.budget_item_id) {
      const badLine = await badBudgetLine(fields.budget_item_id, existing.job_id)
      if (badLine) return badLine
    }
    if (attachment !== undefined && attachment !== null) {
      const v = await verifyAttachment(adminSupabase, attachment, { target: 'gc-doc', subject: auth.userId, ctx: { job: existing.job_id, rec: existing.id } })
      if (!v.ok) return attachmentErrorResponse(v)
      doc_url = v.path
    }

    const updates = {}
    if (fields.description !== undefined) updates.description = fields.description
    if (fields.amount !== undefined) updates.amount = parseFloat(fields.amount)
    if (fields.category !== undefined) updates.category = fields.category
    if (fields.entry_date !== undefined) updates.entry_date = fields.entry_date
    if (fields.budget_item_id !== undefined) updates.budget_item_id = fields.budget_item_id || null
    if (fields.notes !== undefined) updates.notes = fields.notes || null
    if (doc_url !== undefined) updates.doc_url = doc_url
    if (!Object.keys(updates).length) return Response.json({ ok: true })

    // Only lands if the draw tag is still what we checked (a tag added meanwhile can't be
    // edited around).
    let q = adminSupabase.from('general_conditions').update(updates).eq('id', id)
    q = existing.draw_request_id ? q.eq('draw_request_id', existing.draw_request_id) : q.is('draw_request_id', null)
    const { data: rows, error } = await q.select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return Response.json({ error: 'This entry was put on or taken off a draw since you opened it. Nothing was saved. Refresh and try again.' }, { status: 409 })
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
    const { data: entry, error: loadErr } = await adminSupabase.from('general_conditions').select('id, job_id, draw_request_id').eq('id', id).maybeSingle()
    if (loadErr) return Response.json({ error: loadErr.message }, { status: 500 })
    if (!entry) return Response.json({ error: 'Not found.' }, { status: 404 })
    const locked = gcDeleteLockError(entry)
    if (locked) return Response.json({ error: locked.error }, { status: locked.status })
    const { data: rows, error } = await adminSupabase.from('general_conditions').delete().eq('id', id).is('draw_request_id', null).select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return Response.json({ error: 'This entry was put on a draw since you loaded it. Nothing was deleted.' }, { status: 409 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
