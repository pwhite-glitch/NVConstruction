import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST: insert a direct cost, optionally uploading a receipt file
// Accepts multipart FormData: file (optional) + "data" JSON string
// OR plain JSON body (no file)
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let receipt_url = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')

      if (file && file.size > 0) {
        const ext = file.name.split('.').pop()
        const path = `${row.job_id}/${Date.now()}.${ext}`
        const buffer = Buffer.from(await file.arrayBuffer())
        const { error: uploadError } = await adminSupabase.storage
          .from('receipts')
          .upload(path, buffer, { contentType: file.type })
        if (uploadError) return Response.json({ error: 'Receipt upload failed: ' + uploadError.message }, { status: 500 })
        receipt_url = path
      }
    } else {
      row = await request.json()
    }

    const { error } = await adminSupabase.from('direct_costs').insert({ ...row, receipt_url })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT: update a direct cost by id
export async function PUT(request) {
  try {
    const { id, ...fields } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('direct_costs').update(fields).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: delete a direct cost by id
export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('direct_costs').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
