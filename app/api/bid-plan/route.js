import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const body = await request.json()

    if (body.action === 'upload-url') {
      const { data, error } = await adminSupabase.storage
        .from('bid-plans')
        .createSignedUploadUrl(body.path)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (body.action === 'signed-url') {
      const { data, error } = await adminSupabase.storage
        .from('bid-plans')
        .createSignedUrl(body.path, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (body.action === 'insert') {
      const { error } = await adminSupabase.from('bid_plans').insert({
        bid_package_id: body.bid_package_id,
        file_name: body.file_name,
        storage_path: body.storage_path,
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    if (body.action === 'delete') {
      await adminSupabase.storage.from('bid-plans').remove([body.path])
      await adminSupabase.from('bid_plans').delete().eq('storage_path', body.path)
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
