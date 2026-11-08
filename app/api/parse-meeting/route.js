import { requirePM } from '../../../lib/server-auth'
import { todayCentral } from '../../../lib/central-date'
import {
  MEETING_TRANSCRIPT_MAX, MEETING_PARSE_MAX_TOKENS, TRUNCATED_REPLY_MESSAGE,
  meetingAnchorDate, normalizeDueDate, buildMeetingPrompt,
} from '../../../lib/meeting-parse'

// POST { transcript, meeting_date? } — meeting_date (YYYY-MM-DD, else today in
// America/Chicago) anchors relative deadlines. Due dates far from the meeting
// come back null with due_date_flag so the reviewer checks them.

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

  const { transcript, meeting_date } = body
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
    return Response.json({ error: 'Transcript text is required (minimum 20 characters)' }, { status: 400 })
  }
  if (transcript.length > MEETING_TRANSCRIPT_MAX) {
    return Response.json({ error: `Transcript too long — max ${MEETING_TRANSCRIPT_MAX.toLocaleString('en-US')} characters. Split it and parse each part.` }, { status: 400 })
  }
  if (meeting_date != null && meeting_date !== '' && typeof meeting_date !== 'string') {
    return Response.json({ error: 'meeting_date must be YYYY-MM-DD' }, { status: 400 })
  }
  const today = todayCentral()
  const anchor = meetingAnchorDate(meeting_date)

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: MEETING_PARSE_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: buildMeetingPrompt(transcript, anchor, today),
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
  // A cut-off reply is not "unreadable" — say what happened.
  if (aiData.stop_reason === 'max_tokens') {
    console.error('parse-meeting: reply truncated at max_tokens')
    return Response.json({ error: TRUNCATED_REPLY_MESSAGE, code: 'truncated' }, { status: 422 })
  }

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
      ...normalizeDueDate(a.due_date, anchor),
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

  result.meeting_date = anchor
  result.analyzed_chars = transcript.length
  return Response.json(result)
}
