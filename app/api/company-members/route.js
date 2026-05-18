import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const company_id = searchParams.get('company_id')

  let query = adminSupabase
    .from('profiles')
    .select('id, full_name, phone, company_id, invite_email')
    .eq('role', 'subcontractor')

  if (company_id) query = query.eq('company_id', company_id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ members: data || [] })
}
