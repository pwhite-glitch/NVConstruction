import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_FIELDS = ['w9_url', 'coi_url', 'coi_expiration', 'company_name', 'contact_name', 'email', 'phone', 'address', 'trade', 'license_number', 'scope_description']

export async function POST(request) {
  try {
    const body = await request.json()
    const { action, directory_id, file_path } = body

    if (action === 'signed-url') {
      if (!file_path) return Response.json({ error: 'file_path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage
        .from('documents')
        .createSignedUrl(file_path, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })

    const updates = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) updates[key] = body[key] || null
    }

    const { error } = await adminSupabase
      .from('sub_directory')
      .update(updates)
      .eq('id', directory_id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
