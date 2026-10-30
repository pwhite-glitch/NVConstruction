import { withBot, refuse, refusedMethods, badRequest, notFound, dbError, logBotChange } from '../../../../../lib/bot-api'
import { validateAttachment, MAX_ATTACHMENT_BYTES } from '../../../../../lib/bot-rules'

// Upload a job document: same bucket (job-documents), path layout and table
// (job_documents) as the job page's Documents section.
// multipart/form-data: file, job_id, category (plans | geotech | permits | specs | other)
export const POST = withBot(async ({ bot, supabase, request }) => {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024) {
    return Response.json({ error: `File too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }
  if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) {
    return badRequest('Send multipart/form-data with fields file, job_id, category')
  }
  const form = await request.formData()
  const file = form.get('file')
  const isFile = file && typeof file === 'object' && typeof file.arrayBuffer === 'function'
  const { row, error: invalid, status } = validateAttachment({
    job_id: form.get('job_id'),
    category: form.get('category'),
    fileName: isFile ? file.name : null,
    size: isFile ? file.size : 0,
  })
  if (invalid) return Response.json({ error: invalid }, { status: status || 400 })

  const { data: job } = await supabase.from('jobs').select('id').eq('id', row.job_id).maybeSingle()
  if (!job) return notFound('Job not found')

  const path = `${row.job_id}/${row.category}/${Date.now()}-${row.file_name}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabase.storage.from('job-documents')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return dbError(new Error('Upload failed: ' + upErr.message))

  const { data, error } = await supabase.from('job_documents').insert({
    job_id: row.job_id, file_name: row.file_name, storage_path: path, category: row.category, uploaded_by: bot.id,
  }).select('id').single()
  if (error) return dbError(error)

  await logBotChange(bot, supabase, {
    job_id: row.job_id, entity_type: 'job_document', entity_id: data.id, field_name: 'uploaded',
    new_value: row.file_name, note: `Document uploaded (${row.category}) — ${row.file_name}`,
  })
  return Response.json({ ok: true, id: data.id, storage_path: path }, { status: 201 })
})

export const GET = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
