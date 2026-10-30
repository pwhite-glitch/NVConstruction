import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/maintenance-reports — list reports for the requesting user (or all for pm/admin)
export async function GET(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const pmRoles = new Set(['pm', 'apm', 'admin'])
  let query = adminSupabase
    .from('maintenance_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (!pmRoles.has(auth.role)) {
    query = query.eq('performed_by', auth.userId)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

// POST /api/maintenance-reports — create a report
export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { report_date, equipment_name, current_hours, description, photos } = body
  if (!report_date || !equipment_name || !description?.trim()) {
    return Response.json({ error: 'report_date, equipment_name, and description are required' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('maintenance_reports')
    .insert({
      report_date,
      equipment_name: equipment_name.trim(),
      current_hours: current_hours ? parseFloat(current_hours) : null,
      description: description.trim(),
      photos: photos || [],
      performed_by: auth.userId,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}

// DELETE /api/maintenance-reports?id=... — delete own report
export async function DELETE(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const { data: existing } = await adminSupabase
    .from('maintenance_reports')
    .select('performed_by')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.performed_by !== auth.userId && !['pm', 'apm', 'admin'].includes(auth.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminSupabase.from('maintenance_reports').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
