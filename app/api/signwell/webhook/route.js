import { createClient } from '@supabase/supabase-js'
import { verifySignwellEvent } from '../../../../lib/signwell'
import { processSignwellWebhook } from '../../../../lib/signwell-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// POST /api/signwell/webhook — SignWell event callback (prompt 98). Public (no session).
// 1. Verify event.hash = HMAC-SHA256(SIGNWELL_WEBHOOK_ID, `${type}@${time}`) (hex, constant
//    time). No secret configured or a bad hash → 401.
// 2. The hash does not cover the body, so the body is only used for the event type and the
//    document id: lib/signwell-server re-fetches GET /documents/{id} and acts on that, only
//    for the subcontract named in its metadata whose stored signwell_document_id matches.
export async function POST(request) {
  const secret = process.env.SIGNWELL_WEBHOOK_ID
  let payload
  try { payload = JSON.parse(await request.text()) } catch { payload = null }
  if (!secret || !payload || !verifySignwellEvent(payload.event, secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { status, body } = await processSignwellWebhook(adminSupabase, payload)
    return Response.json(body, { status })
  } catch (e) {
    console.error('signwell webhook:', e?.message)
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
