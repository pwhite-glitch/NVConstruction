import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Lightly check auth if a Bearer token is present; returns role or null.
// Does not reject requests without auth — used for per-role enforcement only.
async function tryGetRole(request) {
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  try {
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    if (!user) return null
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    return profile?.role ?? null
  } catch {
    return null
  }
}

// GET: fetch direct costs for a job, or generate a signed receipt URL
// ?job_id=uuid  → list of costs
// ?receipt_path=... → { url } signed URL (valid 5 min)
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
    const { data, error } = await adminSupabase
      .from('direct_costs')
      .select('*')
      .eq('job_id', job_id)
      .order('cost_date', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: insert a direct cost, optionally uploading a receipt file
// Accepts multipart FormData: file (optional) + "data" JSON string
// OR plain JSON body (no file)
// If caller is authenticated as 'super', a receipt file is required.
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let row = {}
    let receipt_url = null
    let fileAttached = false

    // Soft auth — enforce receipt for field workers (super role)
    const authRole = await tryGetRole(request)

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      row = JSON.parse(formData.get('data') || '{}')

      if (file && file.size > 0) {
        fileAttached = true
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

    // Enforce receipt for field submissions (super role, status=pending)
    if (authRole === 'super' && !fileAttached && row.status === 'pending') {
      return Response.json({ error: 'A receipt photo or PDF is required before submitting.' }, { status: 400 })
    }

    // Strip fields that field workers (super) should not set
    if (authRole === 'super') {
      delete row.bill_to_owner
      delete row.owner_auth_ref
      delete row.billing_route
    }

    // Columns from migration 022 may not exist yet — retry without them on schema cache error
    const NEW_022_COLS = new Set(['vendor', 'rejection_reason', 'rejected_at', 'rejected_by', 'review_cycle', 'reviewed_by', 'reviewed_at', 'notif_sent_at'])
    let insertRow = { ...row, receipt_url }
    let { error } = await adminSupabase.from('direct_costs').insert(insertRow)
    if (error && error.message && error.message.includes('schema cache')) {
      insertRow = Object.fromEntries(Object.entries(insertRow).filter(([k]) => !NEW_022_COLS.has(k)))
      const retry = await adminSupabase.from('direct_costs').insert(insertRow)
      error = retry.error
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PUT: update a direct cost by id
// Used for budget line assignment, job moves, and draw application linkage.
// Status transitions (approve/reject/resubmit) should go through /api/dc-review.
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

// DELETE: permanently delete a direct cost by id
// For actual deletions only — rejection now goes through /api/dc-review.
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
