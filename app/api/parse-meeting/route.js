import { requirePM } from '../../../lib/server-auth'

export async function POST(req) {
  const auth = await requirePM(req)
  if (auth.error) return auth.error

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI parsing is not configured on this server' }, { status: 503 })

  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transcript } = body
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
    return Response.json({ error: 'Transcript text is required (minimum 20 characters)' }, { status: 400 })
  }
  if (transcript.length > 100000) {
    return Response.json({ error: 'Transcript too long — max ~100,000 characters' }, { status: 400 })
  }

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are a construction project management assistant. Analyze this meeting transcript or meeting minutes from a construction/design-build project and extract structured information.

Return a single valid JSON object with exactly these four keys:

"action_items": array of objects with:
  - "description": what needs to be done (string, required)
  - "assigned_to": who is responsible — a person's name or company name (string or null)
  - "due_date": deadline in YYYY-MM-DD format if mentioned, otherwise null

"decisions": array of objects with:
  - "description": what was decided or confirmed (string, required)

"contacts": array of objects with:
  - "name": full name (string, required)
  - "company": company or firm name (string or null)
  - "role": their role on the project e.g. "Architect", "Owner", "Engineer" (string or null)
  - "phone": phone number if mentioned (string or null)
  - "email": email if mentioned (string or null)

"topics": array of strings — the main subjects discussed (e.g. "Structural system", "MEP coordination", "Permit timeline")

Rules:
- Only include contacts if they are actual people mentioned with a name; not just roles
- Only include action items for things explicitly assigned or committed to
- Only include decisions for things explicitly agreed upon or resolved
- Return ONLY valid JSON, no markdown fences, no explanation

Transcript:
${transcript.slice(0, 80000)}`,
      }],
    }),
  })

  if (!aiRes.ok) {
    const errText = await aiRes.text()
    console.error('Anthropic API error:', errText)
    return Response.json({ error: 'AI parsing failed — please try again' }, { status: 502 })
  }

  const aiData = await aiRes.json()
  const rawText = aiData.content?.[0]?.text ?? ''

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON from the response if it has surrounding text
    const match = rawText.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* fall through */ }
    }
    if (!parsed) {
      console.error('Failed to parse AI output:', rawText.slice(0, 500))
      return Response.json({ error: 'AI returned unreadable output — try a shorter or cleaner transcript' }, { status: 422 })
    }
  }

  // Normalize and sanitize
  const result = {
    action_items: (parsed.action_items ?? []).filter(a => a?.description).map(a => ({
      description: String(a.description).slice(0, 500),
      assigned_to: a.assigned_to ? String(a.assigned_to).slice(0, 100) : null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null,
    })),
    decisions: (parsed.decisions ?? []).filter(d => d?.description).map(d => ({
      description: String(d.description).slice(0, 1000),
    })),
    contacts: (parsed.contacts ?? []).filter(c => c?.name).map(c => ({
      name: String(c.name).slice(0, 100),
      company: c.company ? String(c.company).slice(0, 100) : null,
      role: c.role ? String(c.role).slice(0, 100) : null,
      phone: c.phone ? String(c.phone).slice(0, 30) : null,
      email: c.email ? String(c.email).slice(0, 200) : null,
    })),
    topics: (parsed.topics ?? []).filter(t => t).map(t => String(t).slice(0, 100)).slice(0, 10),
  }

  return Response.json(result)
}
