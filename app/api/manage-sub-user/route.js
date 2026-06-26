import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function PATCH(request) {
  try {
    const { userId, full_name, phone, role, company_name, company_id } = await request.json()
    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

    const update = {}
    if (full_name !== undefined) update.full_name = full_name
    if (phone !== undefined) update.phone = phone
    if (role !== undefined) update.role = role
    if (company_name !== undefined) update.company_name = company_name
    if (company_id !== undefined) update.company_id = company_id

    const { error } = await adminSupabase.from('profiles').update(update).eq('id', userId)
    if (error) return Response.json({ error: error.message }, { status: 400 })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { userId } = await request.json()
    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

    // Remove profile first so RLS-protected tables don't block the auth delete
    await adminSupabase.from('profiles').delete().eq('id', userId)

    // Hard-delete from auth — this invalidates any pending invite links
    const { error } = await adminSupabase.auth.admin.deleteUser(userId)
    if (error) return Response.json({ error: error.message }, { status: 400 })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
