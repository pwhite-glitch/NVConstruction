import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
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

// POST: JSON log row. A photo is attachment: { path, uploadReceipt }, uploaded directly to
// Storage (POST /api/file-upload, target vehicle-photo) for this vehicle; photo_url stays the raw
// path. Only the log columns below are written (no proof / file keys). Multipart is refused.
const LOG_FIELDS = ['vehicle_id', 'logged_by', 'log_type', 'log_date', 'mileage', 'notes', 'fuel_gallons', 'fuel_cost']

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(request)
  if (multipart) return multipart
  try {
    let body
    try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    const inline = inlineFileContentError(body)
    if (inline) return Response.json({ error: inline }, { status: 400 })
    if (body.photo_url !== undefined && body.photo_url !== null && body.photo_url !== '') {
      return Response.json({ error: 'photo_url cannot be set directly. Attach the photo with a direct upload.' }, { status: 400 })
    }
    const row = {}
    for (const k of LOG_FIELDS) if (body[k] !== undefined) row[k] = body[k]
    let photo_url = null

    if (body.attachment !== undefined && body.attachment !== null) {
      // The vehicle must be real; the receipt binds the photo to it.
      const { data: vehicle, error: vErr } = await adminSupabase.from('vehicles').select('id').eq('id', row.vehicle_id || '').maybeSingle()
      if (vErr) return Response.json({ error: vErr.message }, { status: 500 })
      if (!vehicle) return Response.json({ error: 'Vehicle not found.' }, { status: 404 })
      const v = await verifyAttachment(adminSupabase, body.attachment, { target: 'vehicle-photo', subject: auth.userId, ctx: { vehicle: vehicle.id } })
      if (!v.ok) return attachmentErrorResponse(v)
      photo_url = v.path
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
  const auth = await requirePM(request)
  if (auth.error) return auth.error
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
