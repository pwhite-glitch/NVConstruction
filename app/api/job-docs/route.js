import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

let bucketConfigured = false

export async function POST(request) {
  try {
    const body = await request.json()
    const { action, path: filePath } = body

    if (action === 'upload-url') {
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      // Remove file size limit once per server lifetime
      if (!bucketConfigured) {
        await adminSupabase.storage.updateBucket('job-documents', { fileSizeLimit: null }).catch(() => {})
        bucketConfigured = true
      }
      const { data, error } = await adminSupabase.storage
        .from('job-documents')
        .createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
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
