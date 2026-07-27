import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const { keep_company_id, remove_company_id } = await request.json()
  if (!keep_company_id || !remove_company_id) return Response.json({ error: 'keep_company_id and remove_company_id required' }, { status: 400 })
  if (keep_company_id === remove_company_id) return Response.json({ error: 'Cannot merge a company with itself' }, { status: 400 })

  const { data: keepCompany } = await adminSupabase.from('companies').select('id, name').eq('id', keep_company_id).single()
  if (!keepCompany) return Response.json({ error: 'Keep company not found' }, { status: 404 })

  const { count: profileCount } = await adminSupabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', remove_company_id)

  await adminSupabase.from('profiles')
    .update({ company_id: keep_company_id, company_name: keepCompany.name })
    .eq('company_id', remove_company_id)

  await adminSupabase.from('subcontracts')
    .update({ company_id: keep_company_id })
    .eq('company_id', remove_company_id)

  await adminSupabase.from('job_assignments')
    .update({ company_id: keep_company_id })
    .eq('company_id', remove_company_id)

  const { error: delErr } = await adminSupabase.from('companies').delete().eq('id', remove_company_id)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })

  return Response.json({ ok: true, profiles_moved: profileCount || 0, kept: keepCompany.name })
}
