import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function uploadBillingDoc(file, jobId) {
  const ext = file.name.split('.').pop()
  const path = `${jobId}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await adminSupabase.storage
    .from('billing-docs')
    .upload(path, buffer, { contentType: file.type })
  if (error) throw new Error('File upload failed: ' + error.message)
  return path
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let doc_url = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')
      if (file && file.size > 0) {
        doc_url = await uploadBillingDoc(file, row.job_id)
      }
    } else {
      row = await request.json()
    }

    // Validate sub_id against auth.users — stale UUIDs (deleted/re-invited subs) would violate the FK
    if (row.sub_id) {
      const { data: authUser } = await adminSupabase.auth.admin.getUserById(row.sub_id)
      if (!authUser?.user) row.sub_id = null
    }

    const { error } = await adminSupabase
      .from('billing_submissions')
      .insert({ ...row, doc_url })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let id = null
    let fields = {}
    let doc_url = undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      const parsed = JSON.parse(formData.get('data') || '{}')
      id = parsed.id
      const { id: _id, ...rest } = parsed
      fields = rest
      if (file && file.size > 0) {
        doc_url = await uploadBillingDoc(file, fields.job_id)
      }
    } else {
      const body = await request.json()
      id = body.id
      const { id: _id, ...rest } = body
      fields = rest
    }

    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    // amount_billed is immutable once submitted — never allow it to be overwritten
    delete fields.amount_billed
    const update = doc_url !== undefined ? { ...fields, doc_url } : fields
    const { error } = await adminSupabase
      .from('billing_submissions')
      .update(update)
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { error } = await adminSupabase
      .from('billing_submissions')
      .delete()
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
