import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action, path: filePath } = body

    if (action === 'upload-url') {
      // Only PMs can upload drawings
      if (!['pm', 'apm', 'super'].includes(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage.from('drawings').createSignedUploadUrl(filePath)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (action === 'signed-url') {
      // Any authenticated user can view drawings
      if (!filePath) return Response.json({ error: 'path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage.from('drawings').createSignedUrl(filePath, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (action === 'delete') {
      // Only PMs can delete drawings
      if (!['pm', 'apm', 'super'].includes(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { storage_path, drawing_id } = body
      if (storage_path) await adminSupabase.storage.from('drawings').remove([storage_path])
      if (drawing_id) await adminSupabase.from('drawings').delete().eq('id', drawing_id)
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
