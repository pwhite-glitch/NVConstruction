import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { user_id, company_name, contact_name, full_name, email, phone, address, trade, scope_description, coi_expiration, license_number, w9_url, coi_url } = await request.json()
    if (!user_id || !company_name) return Response.json({ error: 'user_id and company_name required' }, { status: 400 })

    // Find or create companies entry
    const { data: existingCo } = await adminSupabase
      .from('companies')
      .select('id')
      .ilike('name', company_name.trim())
      .maybeSingle()

    let company_id
    if (existingCo) {
      company_id = existingCo.id
    } else {
      const { data: newCo, error: coErr } = await adminSupabase
        .from('companies')
        .insert({ name: company_name.trim(), email: email || null, phone: phone || null })
        .select('id')
        .single()
      if (coErr) return Response.json({ error: coErr.message }, { status: 500 })
      company_id = newCo.id
    }

    // Insert sub_directory entry
    const { error: dirErr } = await adminSupabase.from('sub_directory').insert({
      company_name: company_name.trim(),
      contact_name: contact_name || company_name.trim(),
      email: email?.toLowerCase().trim() || null,
      phone: phone || null,
      address: address || null,
      trade: trade || null,
      scope_description: scope_description || null,
      coi_expiration: coi_expiration || null,
      license_number: license_number || null,
      w9_url: w9_url || null,
      coi_url: coi_url || null,
      status: 'approved',
      applied_at: new Date().toISOString(),
    })
    if (dirErr && dirErr.code !== '23505') return Response.json({ error: dirErr.message }, { status: 500 })

    // Upsert profile — works whether or not a row exists yet
    const { error: profErr } = await adminSupabase
      .from('profiles')
      .upsert({
        id: user_id,
        company_id,
        company_name: company_name.trim(),
        full_name: full_name || contact_name || null,
        phone: phone || null,
        role: 'subcontractor',
        invite_email: email?.toLowerCase().trim() || null,
      }, { onConflict: 'id', ignoreDuplicates: false })
    if (profErr) return Response.json({ error: profErr.message }, { status: 500 })

    return Response.json({ ok: true, company_id })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
