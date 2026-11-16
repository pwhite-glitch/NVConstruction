import { createClient } from '@supabase/supabase-js'
import { verifyCompanyCamSignature, processCcPhoto, MAX_WEBHOOK_BYTES } from '../../../../lib/companycam'

// CompanyCam photo.created receiver (prompt 82). No user JWT: CompanyCam signs the raw body
// with the token we set when registering (X-CompanyCam-Signature = base64 HMAC-SHA1, see
// lib/companycam.js for sources). Fails closed: no token configured → 503, never a 200 for an
// unverified body. CompanyCam retries anything but 200, and disables a webhook after 25
// errors, so only answer non-200 where a retry can help.
// Next 14.1 has no after(): the import runs synchronously and is idempotent.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const token = process.env.COMPANYCAM_WEBHOOK_TOKEN
  if (!token || !token.trim()) return Response.json({ error: 'CompanyCam webhook not configured' }, { status: 503 })

  try {
    const raw = Buffer.from(await request.arrayBuffer())
    if (raw.length > MAX_WEBHOOK_BYTES) return Response.json({ error: 'Payload too large' }, { status: 413 })
    const signature = request.headers.get('x-companycam-signature')
    if (!verifyCompanyCamSignature(raw, signature, token)) return Response.json({ error: 'Invalid signature' }, { status: 401 })

    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
    const eventType = body?.event_type
    if (eventType !== 'photo.created') return Response.json({ ignored: typeof eventType === 'string' ? eventType.slice(0, 60) : null }, { status: 200 })

    // Only the id is used: processCcPhoto re-reads the photo from the API.
    const photo = body.payload?.photo ?? body.payload
    const id = String(photo?.id ?? '')
    if (!/^\d{1,20}$/.test(id)) return Response.json({ error: 'Invalid photo id' }, { status: 400 })

    const r = await processCcPhoto(adminSupabase, id)
    return Response.json({ ok: r.http === 200, status: r.status }, { status: r.http })
  } catch (e) {
    console.error('[companycam webhook]', e?.message)
    return Response.json({ ok: false, status: 'error' }, { status: 503 })
  }
}

export async function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
