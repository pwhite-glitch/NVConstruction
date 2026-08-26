import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const job_id = searchParams.get('job_id')
    const path   = searchParams.get('path')

    if (path) {
      const { data, error } = await adminSupabase.storage
        .from('job-documents')
        .createSignedUrl(path, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
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
  try {
    const body = await request.json()
    const { action, path: filePath } = body

    if (action === 'upload-url') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage
        .from('job-documents')
        .createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (action === 'upload-url-residential') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage
        .from('job-documents')
        .createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl, path: filePath })
    }

    if (action === 'insert-doc') {
      const { job_id, url, name, doc_type } = body
      if (!job_id || !url || !name) return Response.json({ error: 'job_id, url, name required' }, { status: 400 })
      const { error } = await adminSupabase.from('job_docs').insert({ job_id, url, name, doc_type: doc_type || 'general' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    if (action === 'signed-url') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const opts = body.download ? { download: true } : undefined
      const { data, error } = await adminSupabase.storage
        .from('job-documents')
        .createSignedUrl(filePath, 3600, opts)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    return Response.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
