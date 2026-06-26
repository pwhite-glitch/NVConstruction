import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { primaryId, duplicateId } = await request.json()
    if (!primaryId || !duplicateId) return Response.json({ error: 'primaryId and duplicateId required' }, { status: 400 })

    const [{ data: primary, error: e1 }, { data: dup, error: e2 }] = await Promise.all([
      adminSupabase.from('sub_directory').select('*').eq('id', primaryId).single(),
      adminSupabase.from('sub_directory').select('*').eq('id', duplicateId).single(),
    ])
    if (e1 || e2 || !primary || !dup) return Response.json({ error: 'Could not load entries' }, { status: 400 })

    // Build merged row: primary wins, fall back to duplicate for any blank fields
    const merged = {
      company_name: primary.company_name || dup.company_name,
      contact_name: primary.contact_name || dup.contact_name,
      email:        primary.email        || dup.email,
      phone:        primary.phone        || dup.phone,
      address:      primary.address      || dup.address,
      trade:        primary.trade        || dup.trade,
      license_number:  primary.license_number  || dup.license_number,
      coi_expiration:  primary.coi_expiration  || dup.coi_expiration,
      coi_url:      primary.coi_url      || dup.coi_url,
      w9_url:       primary.w9_url       || dup.w9_url,
      scope_description: primary.scope_description || dup.scope_description,
      // Prefer approved status
      status: primary.status === 'approved' || dup.status === 'approved' ? 'approved' : (primary.status || dup.status),
    }

    // 1. Update primary row with merged data
    await adminSupabase.from('sub_directory').update(merged).eq('id', primaryId)

    // 2. Reassign job_assignments from duplicate email → primary email
    if (dup.email && merged.email && dup.email.toLowerCase() !== merged.email.toLowerCase()) {
      await adminSupabase.from('job_assignments').update({ sub_email: merged.email }).eq('sub_email', dup.email)
    }

    // 3. Update profiles: point company_name from dup → merged name
    if (dup.company_name) {
      await adminSupabase.from('profiles').update({ company_name: merged.company_name }).ilike('company_name', dup.company_name)
    }

    // 4. Handle companies table duplicates
    const [{ data: primaryCo }, { data: dupCo }] = await Promise.all([
      merged.company_name ? adminSupabase.from('companies').select('id').ilike('name', merged.company_name).maybeSingle() : { data: null },
      dup.company_name    ? adminSupabase.from('companies').select('id').ilike('name', dup.company_name).maybeSingle()    : { data: null },
    ])
    if (primaryCo && dupCo && primaryCo.id !== dupCo.id) {
      // Re-point all profiles with the duplicate company_id → primary company_id
      await adminSupabase.from('profiles').update({ company_id: primaryCo.id }).eq('company_id', dupCo.id)
      await adminSupabase.from('companies').delete().eq('id', dupCo.id)
    }

    // 5. Delete the duplicate sub_directory row
    await adminSupabase.from('sub_directory').delete().eq('id', duplicateId)

    return Response.json({ ok: true, merged })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
