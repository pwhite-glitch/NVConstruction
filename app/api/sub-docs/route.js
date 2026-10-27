import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_FIELDS = ['w9_url', 'coi_url', 'coi_expiration', 'company_name', 'contact_name', 'email', 'phone', 'address', 'trade', 'license_number', 'scope_description']
// What a sub may change on their own directory record (My Documents tab)
const SUB_FIELDS = ['w9_url', 'coi_url', 'coi_expiration']

const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 })

// The sub's own directory row, matched by login email (as the sub portal loads it)
async function ownDirectoryRow(auth) {
  if (!auth.email) return null
  const { data } = await adminSupabase.from('sub_directory').select('id, w9_url, coi_url').ilike('email', auth.email).maybeSingle()
  return data
}

// Storage paths in the documents bucket a sub may read or write:
// <their directory id>/... and contracts/<accessible contract id>/...
async function subOwnsPath(auth, path, dir) {
  if (!path || path.includes('..') || path.startsWith('/')) return false
  if (dir && (path.startsWith(`${dir.id}/`) || path === dir.w9_url || path === dir.coi_url)) return true
  const m = path.match(/^contracts\/([^/]+)\//)
  if (!m) return false
  return (await getSubContracts(auth)).some(c => c.id === m[1])
}

// Office staff: every action. Sub users: upload / view their own documents and
// signed contracts, and update the document fields on their own directory record.
export async function POST(request) {
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { action, directory_id, file_path } = body

  const auth = await requireAuth(request)
  if (auth.error) return auth.error
  const office = isPM(auth.role)
  if (!office && !isSub(auth.role)) return forbidden()
  const dir = office ? null : await ownDirectoryRow(auth)

  // Add a directory entry (Directory "Add sub")
  if (action === 'insert') {
    if (!office) return forbidden()
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

    let company_id = null
    if (fields.company_name) {
      const { data: existingCo } = await adminSupabase.from('companies').select('id').ilike('name', fields.company_name.trim()).maybeSingle()
      if (existingCo) {
        company_id = existingCo.id
      } else {
        const { data: newCo } = await adminSupabase.from('companies')
          .insert({ name: fields.company_name.trim(), email: fields.email || null, phone: fields.phone || null })
          .select('id').single()
        company_id = newCo?.id || null
      }
    }

    return Response.json({ ok: true, id: data.id, company_id })
  }

  if (action === 'upload-url') {
    if (!body.path) return Response.json({ error: 'path required' }, { status: 400 })
    if (!office && !(await subOwnsPath(auth, body.path, dir))) return forbidden()
    const { data, error } = await adminSupabase.storage.from('documents').createSignedUploadUrl(body.path)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ signedUrl: data.signedUrl })
  }

  if (action === 'signed-url') {
    if (!file_path) return Response.json({ error: 'file_path required' }, { status: 400 })
    if (!office && !(await subOwnsPath(auth, file_path, dir))) return forbidden()
    const opts = body.download ? { download: true } : undefined
    const { data, error } = await adminSupabase.storage.from('documents').createSignedUrl(file_path, 3600, opts)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ url: data.signedUrl })
  }

  if (action === 'delete') {
    const pmAuth = await requirePM(request)
    if (pmAuth.error) return pmAuth.error
    if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })
    const { error } = await adminSupabase.from('sub_directory').delete().eq('id', directory_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // Default: update sub_directory record (office: any record; sub: their own, documents only)
  if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })

  const updates = {}
  for (const key of office ? ALLOWED_FIELDS : SUB_FIELDS) {
    if (key in body) updates[key] = body[key] || null
  }
  if (!office) {
    if (!dir || dir.id !== directory_id) return forbidden()
    for (const key of ['w9_url', 'coi_url']) {
      if (updates[key] && updates[key] !== dir[key] && !updates[key].startsWith(`${dir.id}/`)) return forbidden()
    }
  }

  let oldName = null
  if ('company_name' in updates && updates.company_name) {
    const { data: existing } = await adminSupabase.from('sub_directory').select('company_name').eq('id', directory_id).single()
    oldName = existing?.company_name || null
  }

  const { error } = await adminSupabase.from('sub_directory').update(updates).eq('id', directory_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (oldName && updates.company_name && oldName !== updates.company_name) {
    await adminSupabase.from('subcontracts').update({ vendor_name: updates.company_name }).eq('vendor_name', oldName)
    await adminSupabase.from('companies').update({ name: updates.company_name }).ilike('name', oldName)
    const { data: primeCOs } = await adminSupabase.from('prime_change_orders').select('id, description').like('description', `${oldName} — %`)
    if (primeCOs?.length > 0) {
      await Promise.all(primeCOs.map(co =>
        adminSupabase.from('prime_change_orders').update({ description: co.description.replace(oldName, updates.company_name) }).eq('id', co.id)
      ))
    }
  }

  return Response.json({ ok: true })
}
