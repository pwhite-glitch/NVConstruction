import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Finds or creates a companies entry for the given company_name,
// then links all profiles and subcontracts that match by name.
export async function POST(request) {
  try {
    const { company_name } = await request.json()
    if (!company_name?.trim()) return Response.json({ error: 'company_name required' }, { status: 400 })

    const name = company_name.trim()

    // Find or create the companies entry
    let companyId = null
    const { data: existing } = await adminSupabase
      .from('companies')
      .select('id')
      .ilike('name', name)
      .maybeSingle()

    if (existing) {
      companyId = existing.id
    } else {
      const { data: created, error: createErr } = await adminSupabase
        .from('companies')
        .insert({ name })
        .select('id')
        .single()
      if (createErr) return Response.json({ error: createErr.message }, { status: 500 })
      companyId = created.id
    }

    // Link all profiles with matching company_name (regardless of current company_id)
    const { data: updatedProfiles, error: profErr } = await adminSupabase
      .from('profiles')
      .update({ company_id: companyId })
      .ilike('company_name', name)
      .select('id')
    if (profErr) return Response.json({ error: profErr.message }, { status: 500 })

    // Link all subcontracts with matching vendor_name that don't have a company_id yet
    const { data: updatedContracts, error: contractErr } = await adminSupabase
      .from('subcontracts')
      .update({ company_id: companyId })
      .ilike('vendor_name', name)
      .is('company_id', null)
      .select('id')
    if (contractErr) return Response.json({ error: contractErr.message }, { status: 500 })

    return Response.json({
      ok: true,
      company_id: companyId,
      profiles_linked: updatedProfiles?.length ?? 0,
      contracts_linked: updatedContracts?.length ?? 0,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
