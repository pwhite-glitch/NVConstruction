import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyUnlessOnJob } from '../../../lib/roles'
import { jobIdFromPath } from '../../../lib/storage-path'
import { JOB_DOC_CATEGORIES } from '../../../lib/job-docs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Every job-documents path is "<job_id>/...": run the job check on that job.
// Uploads must use that layout. For reads of older files whose path does not
// start with the job id, the job comes from the job_docs / job_documents row.
async function denyPath(auth, path, { upload = false } = {}) {
  let jobId = jobIdFromPath(path)
  if (!jobId && upload) return Response.json({ error: 'Path must start with the job id.' }, { status: 400 })
  if (!jobId) {
    const [a, b] = await Promise.all([
      adminSupabase.from('job_docs').select('job_id').eq('url', path).limit(1),
      adminSupabase.from('job_documents').select('job_id').eq('storage_path', path).limit(1),
    ])
    if (a.error || b.error) return Response.json({ error: (a.error || b.error).message }, { status: 500 })
    jobId = a.data?.[0]?.job_id || b.data?.[0]?.job_id || null
  }
  return denyOnJob(auth, jobId)
}

// Every role (supers included) must be on the job; principal/admin see all jobs.
// No job resolved → 404 for everyone (fail closed).
async function denyOnJob(auth, jobId) {
  if (!jobId) return Response.json({ error: 'Job not found.' }, { status: 404 })
  return denyUnlessOnJob(adminSupabase, auth, jobId)
}

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const job_id = searchParams.get('job_id')
    const path = searchParams.get('path')

    if (path) {
      const denied = await denyPath(auth, path)
      if (denied) return denied
      const { data, error } = await adminSupabase.storage.from('job-documents').createSignedUrl(path, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
    const denied = await denyOnJob(auth, job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase
      .from('job_docs')
      .select('*')
      .eq('job_id', job_id)
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    // ?include=documents: also the canonical job_documents rows (what the field
    // app and commercial page use). `data` stays the legacy job_docs list.
    if (searchParams.get('include') === 'documents') {
      const { data: documents, error: dErr } = await adminSupabase
        .from('job_documents')
        .select('*')
        .eq('job_id', job_id)
        .order('uploaded_at', { ascending: false })
      if (dErr) return Response.json({ error: dErr.message }, { status: 500 })
      return Response.json({ data, documents: documents || [] })
    }
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action, path: filePath } = body

    if (action === 'upload-url' || action === 'upload-url-residential' || action === 'signed-url') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const denied = await denyPath(auth, filePath, { upload: action !== 'signed-url' })
      if (denied) return denied
    }

    if (action === 'upload-url') {
      const { data, error } = await adminSupabase.storage.from('job-documents').createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (action === 'upload-url-residential') {
      const { data, error } = await adminSupabase.storage.from('job-documents').createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl, path: filePath })
    }

    if (action === 'insert-doc') {
      const { job_id, url, name, doc_type } = body
      if (!job_id || !url || !name) return Response.json({ error: 'job_id, url, name required' }, { status: 400 })
      if (jobIdFromPath(url) !== String(job_id).toLowerCase()) return Response.json({ error: 'File path does not match the job.' }, { status: 400 })
      const denied = await denyOnJob(auth, job_id)
      if (denied) return denied
      const { error } = await adminSupabase.from('job_docs').insert({ job_id, url, name, doc_type: doc_type || 'general' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    // Canonical record for a file uploaded with 'upload-url' (path "<job_id>/<category>/<name>").
    if (action === 'insert-document') {
      const { job_id, storage_path, file_name, category } = body
      if (!job_id || !storage_path || !file_name) return Response.json({ error: 'job_id, storage_path, file_name required' }, { status: 400 })
      if (jobIdFromPath(storage_path) !== String(job_id).toLowerCase()) return Response.json({ error: 'File path does not match the job.' }, { status: 400 })
      const cat = category || 'other'
      if (!JOB_DOC_CATEGORIES.some(c => c.value === cat)) return Response.json({ error: 'Unknown document category.' }, { status: 400 })
      const denied = await denyOnJob(auth, job_id)
      if (denied) return denied
      const { data, error } = await adminSupabase.from('job_documents')
        .insert({ job_id, storage_path, file_name: String(file_name).slice(0, 255), category: cat, uploaded_by: auth.userId })
        .select('*').single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true, document: data })
    }

    if (action === 'signed-url') {
      const opts = body.download ? { download: true } : undefined
      const { data, error } = await adminSupabase.storage.from('job-documents').createSignedUrl(filePath, 3600, opts)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    return Response.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE ?id — a job_documents row and its file. Legacy job_docs rows are
// read-only here (never deleted or moved).
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (auth.role === 'super') return Response.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: doc, error } = await adminSupabase.from('job_documents').select('id, job_id, storage_path').eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!doc) return Response.json({ error: 'Document not found.' }, { status: 404 })
  // Supers are refused above; everyone else must be on the document's real job.
  const denied = await denyOnJob(auth, doc.job_id)
  if (denied) return denied
  const { error: delErr } = await adminSupabase.from('job_documents').delete().eq('id', id)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })
  // Only a file inside this job's folder is removed; the row is already gone.
  let warning = null
  if (doc.storage_path && jobIdFromPath(doc.storage_path) === String(doc.job_id).toLowerCase()) {
    const { error: rmErr } = await adminSupabase.storage.from('job-documents').remove([doc.storage_path])
    if (rmErr) warning = 'Document removed, but the stored file could not be deleted: ' + rmErr.message
  }
  return Response.json({ ok: true, warning })
}
