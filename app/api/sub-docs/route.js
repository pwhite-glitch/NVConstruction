import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_FIELDS = ['w9_url', 'coi_url', 'coi_expiration', 'company_name', 'contact_name', 'email', 'phone', 'address', 'trade', 'license_number', 'scope_description']

export async function POST(request) {
  try {
    const body = await request.json()
    const { action, directory_id, file_path } = body

    if (action === 'upload-url') {
      if (!body.path) return Response.json({ error: 'path required' }, { status: 400 })
      const { data, error } = await adminSupabase.storage
        .from('documents')
        .createSignedUploadUrl(body.path)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ signedUrl: data.signedUrl })
    }

    if (action === 'signed-url') {
      if (!file_path) return Response.json({ error: 'file_path required' }, { status: 400 })
      const opts = body.download ? { download: true } : undefined
      const { data, error } = await adminSupabase.storage
        .from('documents')
        .createSignedUrl(file_path, 3600, opts)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    if (action === 'insert') {
      const fields = {}
      for (const key of ALLOWED_FIELDS) {
        if (key in body) fields[key] = body[key] || null
      }
      const { data, error } = await adminSupabase.from('sub_directory').insert({
        ...fields,
        contact_name: fields.contact_name || fields.company_name || '',
        status: 'approved',
        applied_at: new Date().toISOString(),
      }).select().single()
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Ensure a companies entry exists so profiles.company_id can be set
      let company_id = null
      if (fields.company_name) {
        const { data: existingCo } = await adminSupabase
          .from('companies')
          .select('id')
          .ilike('name', fields.company_name.trim())
          .maybeSingle()
        if (existingCo) {
          company_id = existingCo.id
        } else {
          const { data: newCo } = await adminSupabase
            .from('companies')
            .insert({ name: fields.company_name.trim(), email: fields.email || null, phone: fields.phone || null })
            .select('id')
            .single()
          company_id = newCo?.id || null
        }
      }

      return Response.json({ ok: true, id: data.id, company_id })
    }

    if (action === 'delete') {
      if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })
      const { error } = await adminSupabase.from('sub_directory').delete().eq('id', directory_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }

    if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })

    const updates = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) updates[key] = body[key] || null
    }

    // Cascade rename: if company_name is changing, grab the old name first
    let oldName = null
    if ('company_name' in updates && updates.company_name) {
      const { data: existing } = await adminSupabase
        .from('sub_directory')
        .select('company_name')
        .eq('id', directory_id)
        .single()
      oldName = existing?.company_name || null
    }

    const { error } = await adminSupabase
      .from('sub_directory')
      .update(updates)
      .eq('id', directory_id)

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Propagate the rename to subcontracts and companies
    if (oldName && updates.company_name && oldName !== updates.company_name) {
      await adminSupabase
        .from('subcontracts')
        .update({ vendor_name: updates.company_name })
        .eq('vendor_name', oldName)
      await adminSupabase
        .from('companies')
        .update({ name: updates.company_name })
        .ilike('name', oldName)
    }

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
