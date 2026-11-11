import { createClient } from '@supabase/supabase-js'
import { withBot, refuse, refusedMethods, badRequest, notFound, dbError, logBotChange } from '../../../../../lib/bot-api'
import { validateAttachment, validateAttachmentTarget, safeFileName, LEGACY_INLINE_ATTACHMENT_BYTES, LEGACY_TOO_LARGE_MESSAGE } from '../../../../../lib/bot-rules'
import { validateIssueRequest, issueUpload, verifyAttachment, attachmentErrorResponse, privateJson, inlineFileContentError } from '../../../../../lib/file-upload-server'

// Upload a job document: same bucket (job-documents), path layout and table
// (job_documents) as the job page's Documents section.
//
// Two ways in:
//  1. JSON signed upload (any size the Storage project allows):
//     POST { action: 'upload-url', job_id, category, file_name, content_type, size }
//        → { bucket, path, signedUrl, uploadReceipt, expires_at }
//     PUT the raw file bytes to signedUrl (Content-Type = content_type; no bot key on that call)
//     POST { action: 'record-upload', job_id, category, attachment: { path, uploadReceipt } } → 201
//  2. LEGACY multipart/form-data: file, job_id, category — only up to
//     LEGACY_INLINE_ATTACHMENT_BYTES (4 MB), because the bytes pass through this function.
//     A request larger than the platform limit (4.5 MB) is refused by Vercel before this code
//     runs, so it cannot get our JSON error; use flow 1 for large files.
// Both run withBot on every call, look the job up with the bot's RLS client, sign with that
// same client (so its Storage policy applies), insert with it, and audit once after the insert.
export const POST = withBot(async ({ bot, supabase, request }) => {
  const contentType = request.headers.get('content-type') || ''
  if (/application\/json/i.test(contentType)) return jsonFlow({ bot, supabase, request })

  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > LEGACY_INLINE_ATTACHMENT_BYTES + 64 * 1024) {
    return Response.json({ error: LEGACY_TOO_LARGE_MESSAGE }, { status: 413 })
  }
  if (!contentType.includes('multipart/form-data')) {
    return badRequest('Send JSON ({"action":"upload-url"|"record-upload",…}) or multipart/form-data with fields file, job_id, category')
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

  const { data: job, error: jobErr } = await supabase.from('jobs').select('id').eq('id', row.job_id).maybeSingle()
  if (jobErr) return dbError(jobErr)
  if (!job) return notFound('Job not found')

  const path = `${row.job_id}/${row.category}/${Date.now()}-${row.file_name}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabase.storage.from('job-documents')
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return dbError(new Error('Upload failed: ' + upErr.message))

  return recordDocument({ bot, supabase, row, path })
})

async function recordDocument({ bot, supabase, row, path }) {
  const { data, error } = await supabase.from('job_documents').insert({
    job_id: row.job_id, file_name: row.file_name, storage_path: path, category: row.category, uploaded_by: bot.id,
  }).select('id').single()
  if (error) return dbError(error)

  await logBotChange(bot, supabase, {
    job_id: row.job_id, entity_type: 'job_document', entity_id: data.id, field_name: 'uploaded',
    new_value: row.file_name, note: `Document uploaded (${row.category}) — ${row.file_name}`,
  })
  return Response.json({ ok: true, id: data.id, storage_path: path }, { status: 201 })
}

// The job, read with the bot's own RLS client. Returns { job } or { response }.
async function botJob(supabase, jobId) {
  const { data, error } = await supabase.from('jobs').select('id').eq('id', jobId).maybeSingle()
  if (error) return { response: dbError(error) }
  if (!data) return { response: notFound('Job not found') }
  return { job: data }
}

const UPLOAD_URL_KEYS = new Set(['action', 'job_id', 'category', 'file_name', 'content_type', 'size'])
const RECORD_KEYS = new Set(['action', 'job_id', 'category', 'attachment'])

let serviceClient = null
const service = () => (serviceClient ||= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))

async function jsonFlow({ bot, supabase, request }) {
  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON body') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Invalid JSON body')
  const inline = inlineFileContentError(body)
  if (inline) return badRequest(inline)
  const allowed = body.action === 'upload-url' ? UPLOAD_URL_KEYS : body.action === 'record-upload' ? RECORD_KEYS : null
  if (!allowed) return badRequest('action must be "upload-url" or "record-upload"')
  const extra = Object.keys(body).find(k => !allowed.has(k))
  if (extra) return badRequest(`Unexpected field "${extra}"`)

  const t = validateAttachmentTarget({ job_id: body.job_id, category: body.category })
  if (t.error) return badRequest(t.error)
  const j = await botJob(supabase, t.job_id)
  if (j.response) return j.response
  const ctx = { job: j.job.id, cat: t.category }

  if (body.action === 'upload-url') {
    const v = validateIssueRequest({ target: 'bot-attachment', file_name: body.file_name, content_type: body.content_type, size: body.size })
    if (v.error) return badRequest(v.error)
    // Signed with the bot's RLS client: its job-documents insert policy decides, not the service role.
    const out = await issueUpload(supabase, { meta: v.meta, subject: bot.id, keyId: bot.keyId, ctx })
    return privateJson(out.body, out.status)
  }

  // record-upload: the receipt must be this bot + this key + this job/category + exact path.
  // Object metadata is read with the bot's client; only if that read is unavailable, with the
  // server client — and only after the receipt and the bot's job access were verified.
  const info = async (bucket, path) => {
    const own = await supabase.storage.from(bucket).info(path)
    if (!own.error && own.data) return own
    return service().storage.from(bucket).info(path)
  }
  const v = await verifyAttachment(info, body.attachment, { target: 'bot-attachment', subject: bot.id, keyId: bot.keyId, ctx })
  if (!v.ok) return attachmentErrorResponse(v)
  return recordDocument({ bot, supabase, row: { job_id: j.job.id, category: t.category, file_name: safeFileName(v.fileName) }, path: v.path })
}

export const GET = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
