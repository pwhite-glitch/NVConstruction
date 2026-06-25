import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Called on sub login. Links the user to their company and any unlinked contracts.
export async function POST(request) {
  const { user_id, company_name } = await request.json()
  if (!user_id || !company_name) return Response.json({ ok: true, updated: 0 })

  // Find matching company by name
  const { data: company } = await adminSupabase
    .from('companies')
    .select('id')
    .ilike('name', company_name.trim())
    .limit(1)
    .maybeSingle()

  const companyId = company?.id

  // Set company_id on profile if not already set
  if (companyId) {
    await adminSupabase
      .from('profiles')
      .update({ company_id: companyId })
      .eq('id', user_id)
      .is('company_id', null)
  }

  // Link unlinked subcontracts where vendor_name matches
  const { data: unlinked } = await adminSupabase
    .from('subcontracts')
    .select('id')
    .is('sub_id', null)
    .ilike('vendor_name', company_name.trim())

  if (unlinked?.length > 0) {
    const ids = unlinked.map(c => c.id)
    const update = { sub_id: user_id }
    if (companyId) update.company_id = companyId
    await adminSupabase.from('subcontracts').update(update).in('id', ids)
  }

  // Also ensure any company-linked contracts without sub_id get it set
  if (companyId) {
    const { data: companyContracts } = await adminSupabase
      .from('subcontracts')
      .select('id')
      .eq('company_id', companyId)
      .is('sub_id', null)
    if (companyContracts?.length > 0) {
      await adminSupabase
        .from('subcontracts')
        .update({ sub_id: user_id })
        .in('id', companyContracts.map(c => c.id))
    }
  }

  return Response.json({ ok: true, updated: unlinked?.length || 0, company_id: companyId || null })
}
