import { requirePM } from '../../../lib/server-auth'

const MAX_FILE_SIZE_MB = 20
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

export async function POST(req) {
  // Require PM role — AI parsing incurs token costs, must not be publicly accessible
  const auth = await requirePM(req)
  if (auth.error) return auth.error

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    if (!ALLOWED_TYPES.includes(file.type)) {
      return Response.json({ error: 'Only PDF and image files are supported' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return Response.json({ error: `File too large — max ${MAX_FILE_SIZE_MB} MB` }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'AI parsing is not configured on this server' }, { status: 503 })

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mediaType = file.type

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
