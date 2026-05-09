import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { directory_id } = await request.json()
    if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })

    const { data: dir } = await adminSupabase
      .from('sub_directory')
      .select('email')
      .eq('id', directory_id)
      .single()

    if (dir?.email) {
      const { data: { users } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
      const authUser = users.find(u => u.email?.toLowerCase() === dir.email.toLowerCase())
      if (authUser) {
        await adminSupabase.auth.admin.deleteUser(authUser.id)
      }
    }

    const { error } = await adminSupabase.from('sub_directory').delete().eq('id', directory_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
