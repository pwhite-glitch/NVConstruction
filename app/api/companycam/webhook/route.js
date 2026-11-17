import { createClient } from '@supabase/supabase-js'
import { verifyCompanyCamSignature, processCcPhoto, syncCcPhotoTags, MAX_WEBHOOK_BYTES } from '../../../../lib/companycam'

// CompanyCam photo.created receiver (prompt 82) + photo tag-change sync (prompt 83). No user JWT: CompanyCam signs the raw body
// with the token we set when registering (X-CompanyCam-Signature = base64 HMAC-SHA1, see
// lib/companycam.js for sources). Fails closed: no token configured → 503, never a 200 for an
// unverified body. CompanyCam retries anything but 200, and disables a webhook after 25
// errors, so only answer non-200 where a retry can help.
// Next 14.1 has no after(): the import runs synchronously and is idempotent.
// photo.created rows land owner-visible (CC_IMPORT_INTERNAL_ONLY, prompt 90); photo.updated / tag
// events never touch internal_only, so an office "Hide from owner" sticks.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const isTagEvent = t => typeof t === 'string' && (t === 'photo.updated' || (t.startsWith('photo.') && t.includes('tag')))

// Explicit photo references win: payload.photo.id, then payload.photo_id, then
// payload.taggable_id (only when taggable_type is absent or a Photo). Only then is payload.id
// used, and never when the payload is a tag object (has value / display_value and no photo
// uris). photo.updated (payload IS the photo) therefore still resolves to its own id.
function tagEventPhotoId(payload) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const photoObj = p.photo && typeof p.photo === 'object' ? p.photo : null
  const isTagObject = ('value' in p || 'display_value' in p) && !Array.isArray(p.uris)
  const taggableOk = p.taggable_type == null || /photo/i.test(String(p.taggable_type))
  const id = photoObj?.id ?? p.photo_id ?? (taggableOk ? p.taggable_id : null) ?? (isTagObject ? null : p.id)
  return String(id ?? '')
}

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
    if (eventType === 'photo.created') {
      // Only the id is used: processCcPhoto re-reads the photo from the API.
      const photo = body.payload?.photo ?? body.payload
      const id = String(photo?.id ?? '')
      if (!/^\d{1,20}$/.test(id)) return Response.json({ error: 'Invalid photo id' }, { status: 400 })

      const r = await processCcPhoto(adminSupabase, id)
      return Response.json({ ok: r.http === 200, status: r.status }, { status: r.http })
    }

    // Prompt 83: tag changes after import. The tag event names and payload shape are not
    // documented, so any photo.*tag* event (photo.tag_added, photo.tag_removed, …) and
    // photo.updated re-read the photo's tags from the API. The payload's tags are never used.
    if (isTagEvent(eventType)) {
      const id = tagEventPhotoId(body.payload)
      if (!/^\d{1,20}$/.test(id)) return Response.json({ ignored: 'no photo id' }, { status: 200 })
      const r = await syncCcPhotoTags(adminSupabase, id)
      return Response.json({ ok: r.http === 200, status: r.status }, { status: r.http })
    }

    return Response.json({ ignored: typeof eventType === 'string' ? eventType.slice(0, 60) : null }, { status: 200 })
  } catch (e) {
    console.error('[companycam webhook]', e?.message)
    return Response.json({ ok: false, status: 'error' }, { status: 503 })
  }
}

export async function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}
