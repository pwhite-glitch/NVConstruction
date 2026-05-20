import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const { user_id, company_name } = await request.json()
  if (!user_id || !company_name) return Response.json({ ok: true, updated: 0 })

  // Find subcontracts where vendor_name matches and sub_id is not yet set
  const { data: unlinked } = await adminSupabase
    .from('subcontracts')
    .select('id')
    .is('sub_id', null)
    .ilike('vendor_name', company_name.trim())

  if (!unlinked || unlinked.length === 0) return Response.json({ ok: true, updated: 0 })

  const ids = unlinked.map(c => c.id)
  await adminSupabase.from('subcontracts').update({ sub_id: user_id }).in('id', ids)

  return Response.json({ ok: true, updated: ids.length })
}
