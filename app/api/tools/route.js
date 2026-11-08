import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { canManageTools, pickToolFields, toolStatusFor } from '../../../lib/tool-actions'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TOOL_SELECT = '*, assigned_profile:assigned_to(id, full_name)'
const today = () => new Date().toISOString().slice(0, 10)

export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { data, error } = await adminSupabase
      .from('tools')
      .select(TOOL_SELECT)
      .order('name')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function logAssignment(toolId, type, assignedTo, userId, notes) {
  if (!assignedTo) return
  await adminSupabase.from('tool_logs').insert({ tool_id: toolId, log_type: type, log_date: today(), assigned_to: assignedTo, logged_by: userId, notes })
}

// Add a tool. Owner/PM/APM: any fields. A super (field "Log Tool Purchase") may only
// add a tool assigned to themselves. Status follows the assignee (checked_out when assigned).
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const fields = pickToolFields(body)
    if (!fields.name || !String(fields.name).trim()) return Response.json({ error: 'Tool name is required.' }, { status: 400 })
    if (!canManageTools(auth.role)) {
      if (auth.role !== 'super') return Response.json({ error: 'Forbidden' }, { status: 403 })
      fields.assigned_to = auth.userId
      delete fields.status
    }
    fields.status = toolStatusFor(fields.assigned_to, fields.status === 'retired' ? null : fields.status, null)
    const { data, error } = await adminSupabase.from('tools').insert(fields).select(TOOL_SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await logAssignment(data.id, 'checkout', data.assigned_to, auth.userId, auth.role === 'super' ? 'Purchased in the field' : 'Initial assignment')
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Edit a tool: Owner/PM/APM only. Changing the assignee writes the check-in /
// check-out history here, and status follows the assignee.
export async function PUT(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canManageTools(auth.role)) return Response.json({ error: 'Only an Owner, PM or APM can edit tools.' }, { status: 403 })
  try {
    const body = await request.json()
    const id = body?.id
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: cur, error: curErr } = await adminSupabase.from('tools').select('*').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!cur) return Response.json({ error: 'Tool not found.' }, { status: 404 })
    const fields = pickToolFields(body)
    const assignee = 'assigned_to' in fields ? fields.assigned_to : cur.assigned_to
    fields.status = toolStatusFor(assignee, fields.status, cur.status)
    const { data, error } = await adminSupabase.from('tools').update(fields).eq('id', id).select(TOOL_SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if ((cur.assigned_to || null) !== (assignee || null)) {
      await logAssignment(id, 'checkin', cur.assigned_to, auth.userId, 'Returned / reassigned')
      await logAssignment(id, 'checkout', assignee, auth.userId, 'Assigned by PM')
    }
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Retire (never hard-delete) so the tool's history stays. Owner/PM/APM only.
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  if (!canManageTools(auth.role)) return Response.json({ error: 'Only an Owner, PM or APM can retire tools.' }, { status: 403 })
  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: cur, error: curErr } = await adminSupabase.from('tools').select('id, assigned_to').eq('id', id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (!cur) return Response.json({ error: 'Tool not found.' }, { status: 404 })
    const { data, error } = await adminSupabase.from('tools').update({ status: 'retired', assigned_to: null }).eq('id', id).select(TOOL_SELECT).single()
    if (error) return Response.json({ error: error.code === '23514' ? 'The tools table does not allow status "retired" yet. Nothing was changed.' : error.message }, { status: error.code === '23514' ? 409 : 500 })
    await logAssignment(id, 'checkin', cur.assigned_to, auth.userId, 'Retired')
    return Response.json({ ok: true, data, retired: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
