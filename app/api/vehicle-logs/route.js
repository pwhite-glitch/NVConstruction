import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const vehicle_id = searchParams.get('vehicle_id')
    if (!vehicle_id) return Response.json({ error: 'vehicle_id required' }, { status: 400 })
    const { data, error } = await adminSupabase
      .from('vehicle_logs')
      .select('*, logged_by_profile:logged_by(full_name)')
      .eq('vehicle_id', vehicle_id)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let photo_url = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')
      if (file && file.size > 0) {
        const ext = file.name.split('.').pop()
        const path = `${row.vehicle_id}/${Date.now()}.${ext}`
        const buffer = Buffer.from(await file.arrayBuffer())
        const { error: uploadError } = await adminSupabase.storage
          .from('vehicle-photos')
          .upload(path, buffer, { contentType: file.type })
        if (uploadError) return Response.json({ error: 'Photo upload failed: ' + uploadError.message }, { status: 500 })
        photo_url = path
      }
    } else {
      row = await request.json()
    }

    const { data, error } = await adminSupabase
      .from('vehicle_logs')
      .insert({ ...row, photo_url })
      .select('*, logged_by_profile:logged_by(full_name)')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('vehicle_logs').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
