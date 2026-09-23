import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { title, description, scope_of_work, due_date, job_id, project_address, owner_name, insurance_req, bid_instructions } = body
    if (!title?.trim()) return Response.json({ error: 'title is required' }, { status: 400 })

    const { data, error } = await adminSupabase.from('bid_packages').insert({
      title: title.trim(),
      description: description || null,
      scope_of_work: scope_of_work || null,
      due_date: due_date || null,
      job_id: job_id || null,
      project_address: project_address || null,
      owner_name: owner_name || null,
      insurance_req: insurance_req || null,
      bid_instructions: bid_instructions || null,
      created_by: auth.userId,
      status: 'open',
    }).select('id').single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const allowed = ['status', 'due_date', 'job_id', 'allowed_users']
    const updates = {}
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key]
    }

    if (Object.keys(updates).length === 0) return Response.json({ ok: true })

    const { error } = await adminSupabase.from('bid_packages').update(updates).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error

  try {
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { error } = await adminSupabase.from('bid_packages').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
