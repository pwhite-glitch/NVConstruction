import { createClient } from '@supabase/supabase-js'
import { processSignwellWebhook, verifySignwellWebhook } from '../../../../lib/signwell-server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const dynamic = 'force-dynamic'

// POST /api/signwell/webhook — SignWell event callback (prompt 98). Public (no session).
// 1. Verify event.hash = HMAC-SHA256(webhook id, `${type}@${time}`) (hex, constant time). The
//    id is SIGNWELL_WEBHOOK_ID, or if unset the ids of the account's hooks pointing at this
//    path (GET /hooks, cached; prompt 98b). No key / no matching hook / bad hash → 401.
// 2. The hash does not cover the body, so the body is only used for the event type and the
//    document id: lib/signwell-server re-fetches GET /documents/{id} and acts on that, only
//    for the subcontract named in its metadata whose stored signwell_document_id matches.
export async function POST(request) {
  let payload
  try { payload = JSON.parse(await request.text()) } catch { payload = null }
  if (!payload || !(await verifySignwellWebhook(payload.event))) {
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
