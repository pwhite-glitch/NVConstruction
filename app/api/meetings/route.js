import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/meetings?job_id=xxx  — list meetings with action items + decisions
export async function GET(req) {
  const auth = await requireAuth(req)
  if (auth.error) return auth.error
  if (!isPM(auth.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const job_id = searchParams.get('job_id')
  if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })

  const { data: meetings, error } = await adminSupabase
    .from('meetings')
    .select(`
      *,
      meeting_action_items(*),
      meeting_decisions(*)
    `)
    .eq('job_id', job_id)
    .order('meeting_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(meetings ?? [])
}

// POST /api/meetings — create meeting with action items + decisions
export async function POST(req) {
  const auth = await requirePM(req)
  if (auth.error) return auth.error

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id, meeting_date, title, attendees, raw_transcript, action_items = [], decisions = [] } = body
  if (!job_id || !meeting_date) return Response.json({ error: 'job_id and meeting_date required' }, { status: 400 })

  const { data: meeting, error: meetErr } = await adminSupabase
    .from('meetings')
    .insert({
      job_id,
      meeting_date,
      title: title || null,
      attendees: attendees || null,
      raw_transcript: raw_transcript || null,
      created_by: auth.userId,
    })
    .select()
    .single()

  if (meetErr) return Response.json({ error: meetErr.message }, { status: 500 })

  // Insert action items
  if (action_items.length > 0) {
    const rows = action_items
      .filter(a => a.description?.trim())
      .map(a => ({
        meeting_id: meeting.id,
        job_id,
        description: a.description.trim().slice(0, 500),
        assigned_to: a.assigned_to || null,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null,
        status: 'open',
      }))
    if (rows.length > 0) await adminSupabase.from('meeting_action_items').insert(rows)
  }

  // Insert decisions
  if (decisions.length > 0) {
    const rows = decisions
      .filter(d => d.description?.trim())
      .map(d => ({
        meeting_id: meeting.id,
        job_id,
        description: d.description.trim().slice(0, 1000),
      }))
    if (rows.length > 0) await adminSupabase.from('meeting_decisions').insert(rows)
  }

  return Response.json({ id: meeting.id })
}

// PATCH /api/meetings — toggle action item status or update action item
export async function PATCH(req) {
  const auth = await requirePM(req)
  if (auth.error) return auth.error

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action_item_id, status } = body
  if (!action_item_id || !['open', 'done'].includes(status)) {
    return Response.json({ error: 'action_item_id and status (open|done) required' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('meeting_action_items')
    .update({ status })
    .eq('id', action_item_id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE /api/meetings?meeting_id=xxx — delete a meeting and all its items
export async function DELETE(req) {
  const auth = await requirePM(req)
  if (auth.error) return auth.error

  const { searchParams } = new URL(req.url)
  const meeting_id = searchParams.get('meeting_id')
  if (!meeting_id) return Response.json({ error: 'meeting_id required' }, { status: 400 })

  const { error } = await adminSupabase.from('meetings').delete().eq('id', meeting_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
