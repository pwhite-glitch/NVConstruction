import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob } from '../../../lib/roles'
import { jobIdFromPath } from '../../../lib/storage-path'

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
  // No job found: denyJob answers 404 for PM/APM and lets other office roles through.
  return denyJob(adminSupabase, auth, jobId)
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
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied
    const { data, error } = await adminSupabase
      .from('job_docs')
      .select('*')
      .eq('job_id', job_id)
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
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
      const denied = await denyJob(adminSupabase, auth, job_id)
      if (denied) return denied
      const { error } = await adminSupabase.from('job_docs').insert({ job_id, url, name, doc_type: doc_type || 'general' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
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
