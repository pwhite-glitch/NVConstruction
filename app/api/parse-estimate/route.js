import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { rejectMultipart, inlineFileContentError, verifyAttachment, attachmentErrorResponse } from '../../../lib/file-upload-server'
import { AI_PARSE_MAX_BYTES, AI_PARSE_TYPES, AI_PARSE_LIMIT_MESSAGE, AI_PARSE_TYPE_MESSAGE } from '../../../lib/ai-parse-limits'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const BUCKET = 'estimate-docs' // private; temporary objects under parse/<user id>/

// POST { attachment: { path, uploadReceipt } } — the estimate was uploaded directly to Storage
// (POST /api/file-upload, target parse-estimate → estimate-docs/parse/<user>/<uuid>_<name>).
// The 20 MB check is the AI step's PROCESSING limit, not an upload limit. The verified
// temporary object is removed once parsing finishes (success or error).
export async function POST(req) {
  // Require PM role — AI parsing incurs token costs, must not be publicly accessible
  const auth = await requirePM(req)
  if (auth.error) return auth.error
  const multipart = rejectMultipart(req)
  if (multipart) return multipart

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.attachment) return Response.json({ error: 'No file provided' }, { status: 400 })
  const inline = inlineFileContentError(body)
  if (inline) return Response.json({ error: inline }, { status: 400 })

  const v = await verifyAttachment(adminSupabase, body.attachment, { target: 'parse-estimate', subject: auth.userId, ctx: { user: auth.userId } })
  if (!v.ok) return attachmentErrorResponse(v)
  try {
    return await parseVerified(v)
  } finally {
    // Only this request's verified temporary object; never a client-chosen path.
    try { await adminSupabase.storage.from(BUCKET).remove([v.path]) } catch { /* abandoned temp object */ }
  }
}

async function parseVerified(v) {
  try {
    if (!AI_PARSE_TYPES.includes(v.contentType)) {
      return Response.json({ error: AI_PARSE_TYPE_MESSAGE }, { status: 400 })
    }
    if (v.size > AI_PARSE_MAX_BYTES) {
      return Response.json({ error: AI_PARSE_LIMIT_MESSAGE, code: 'ai_parse_limit' }, { status: 413 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'AI parsing is not configured on this server' }, { status: 503 })

    // Server → Storage read (not a Vercel request body). Base64 below is the outbound AI request.
    const { data: blob, error: dlErr } = await adminSupabase.storage.from(BUCKET).download(v.path)
    if (dlErr || !blob) return Response.json({ error: 'Could not read the uploaded estimate. Try again.' }, { status: 502 })
    const arrayBuffer = await blob.arrayBuffer()
    if (arrayBuffer.byteLength > AI_PARSE_MAX_BYTES) {
      return Response.json({ error: AI_PARSE_LIMIT_MESSAGE, code: 'ai_parse_limit' }, { status: 413 })
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mediaType = v.contentType

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',  // use cheapest capable model for this task
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `This is a construction estimate sheet. Extract every budget line item that has a dollar amount greater than zero.

For each item return a JSON object with:
- "description": the item name (e.g. "Foundation", "Plumbing Rough-In", "Plans")
- "amount": the dollar amount as a plain number, no $ or commas (use Estimated Cost column; if blank/zero use Allowance column)
- "section": the section heading it belongs to (e.g. "Pre-Construction Costs", "Utility Costs", "Construction Costs", "Finish Products")

Return ONLY a valid JSON array. No markdown fences, no explanation.
Example: [{"description":"Plans","amount":2000,"section":"Pre-Construction Costs"}]`,
            },
          ],
        }],
      }),
    })

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}))
      return Response.json({ error: err.error?.message || 'AI request failed' }, { status: 500 })
    }

    const aiJson = await aiRes.json()
    const raw = aiJson.content?.[0]?.text?.trim() || '[]'
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let items
    try {
      items = JSON.parse(cleaned)
    } catch {
      return Response.json({ error: 'AI returned unparseable output — try again or enter items manually' }, { status: 500 })
    }

    if (!Array.isArray(items)) {
      return Response.json({ error: 'AI returned unexpected format' }, { status: 500 })
    }

    // Validate and sanitize each item
    const validated = items.filter(i => i && typeof i.description === 'string' && typeof i.amount === 'number' && i.amount > 0)
      .map(i => ({
        description: String(i.description).slice(0, 200),
        amount: Math.round(Number(i.amount) * 100) / 100,
        section: String(i.section || '').slice(0, 100),
      }))

    return Response.json({ items: validated })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
