export async function POST(req) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mediaType = file.type || 'application/pdf'

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not set in environment' }, { status: 500 })

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
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
Example: [{"description":"Plans","amount":2000,"section":"Pre-Construction Costs"},{"description":"Foundation","amount":40365,"section":"Construction Costs"}]`,
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
    const items = JSON.parse(cleaned)

    return Response.json({ items })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
