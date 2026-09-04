import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET: fetch all direct costs for a job, or generate a signed receipt URL
// ?job_id=uuid  → list of costs
// ?receipt_path=...  → { url } signed URL for the receipt (uses service role so super role works)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const receipt_path = searchParams.get('receipt_path')
    if (receipt_path) {
      const { data, error } = await adminSupabase.storage.from('receipts').createSignedUrl(receipt_path, 300)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }
    const job_id = searchParams.get('job_id')
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
    const { data, error } = await adminSupabase.from('direct_costs').select('*').eq('job_id', job_id).order('cost_date', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

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
        const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')
        const safeExt = isPdf ? 'pdf' : 'jpg'
        const safeMime = isPdf ? 'application/pdf' : 'image/jpeg'
        const path = `${row.job_id}/${Date.now()}.${safeExt}`
        const buffer = Buffer.from(await file.arrayBuffer())
        const { error: uploadError } = await adminSupabase.storage
          .from('receipts')
          .upload(path, buffer, { contentType: safeMime })
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
