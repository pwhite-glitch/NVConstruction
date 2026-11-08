import { createClient } from '@supabase/supabase-js'
import { requireAuth, requirePM, isPM, isSub } from '../../../lib/server-auth'
import { getSubContracts } from '../../../lib/sub-access'
import { denyJobOf, accessibleJobIds } from '../../../lib/roles'
import { resolveUniqueCompany, renameImpact, sameExactName } from '../../../lib/company-identity'
import { coiUploadError } from '../../../lib/coi-status'

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
// (No "equals the stored w9_url/coi_url" shortcut: stored paths must be under dir.id/ too.)
async function subOwnsPath(auth, path, dir) {
  if (!path || typeof path !== 'string' || path.includes('..') || path.startsWith('/')) return false
  if (dir && path.startsWith(`${dir.id}/`)) return true
  const m = path.match(/^contracts\/([^/]+)\//)
  if (!m) return false
  return (await getSubContracts(auth)).some(c => c.id === m[1])
}

// Office PM/APM: a contracts/<subcontract id>/ path must be on one of their jobs.
// Other documents-bucket paths (sub directory W-9/COI files) are company-wide.
async function denyContractPath(auth, path) {
  const m = String(path || '').match(/^contracts\/([^/]+)\//)
  return m ? denyJobOf(adminSupabase, auth, 'subcontracts', m[1]) : null
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

    // Shared company record: exact (escaped) name match only. Two companies with
    // the same name → none is picked (office links later via Fix Company Links).
    let company_id = null
    let company_note = null
    if (fields.company_name) {
      const co = await resolveUniqueCompany(adminSupabase, fields.company_name)
      if (co.error) {
        company_note = 'Directory entry saved; company lookup failed: ' + co.error.message
      } else if (co.company) {
        company_id = co.company.id
      } else if (co.reason === 'ambiguous') {
        company_note = `More than one company is named "${fields.company_name.trim()}"; none was linked.`
      } else {
        const { data: newCo, error: coErr } = await adminSupabase.from('companies')
          .insert({ name: fields.company_name.trim(), email: fields.email || null, phone: fields.phone || null })
          .select('id').single()
        if (coErr) company_note = 'Directory entry saved; company record not created: ' + coErr.message
        company_id = newCo?.id || null
      }
    }

    return Response.json({ ok: true, id: data.id, company_id, company_note })
  }

  if (action === 'upload-url') {
    if (!body.path) return Response.json({ error: 'path required' }, { status: 400 })
    if (!office && !(await subOwnsPath(auth, body.path, dir))) return forbidden()
    if (office) {
      const denied = await denyContractPath(auth, body.path)
      if (denied) return denied
    }
    const { data, error } = await adminSupabase.storage.from('documents').createSignedUploadUrl(body.path)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ signedUrl: data.signedUrl })
  }

  if (action === 'signed-url') {
    if (!file_path) return Response.json({ error: 'file_path required' }, { status: 400 })
    if (!office && !(await subOwnsPath(auth, file_path, dir))) return forbidden()
    if (office) {
      const denied = await denyContractPath(auth, file_path)
      if (denied) return denied
    }
    const opts = body.download ? { download: true } : undefined
    const { data, error } = await adminSupabase.storage.from('documents').createSignedUrl(file_path, 3600, opts)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ url: data.signedUrl })
  }

  // Read-only: what a Directory company-name change would / would not change.
  if (action === 'rename-preview') {
    if (!office) return forbidden()
    if (!directory_id) return Response.json({ error: 'directory_id required' }, { status: 400 })
    const r = await renameImpact(adminSupabase, directory_id, body.company_name)
    if (r.error) return Response.json({ error: r.error }, { status: r.status })
    // Job ids only for jobs the caller can see; the rest are counted.
    const acc = await accessibleJobIds(adminSupabase, auth)
    if (acc.error) return Response.json({ error: acc.error.message }, { status: 500 })
    const all = r.preview.contract_job_ids
    const visible = acc.ids ? all.filter(id => acc.ids.has(id)) : all
    let jobs = []
    if (visible.length) {
      const { data: jr, error: jErr } = await adminSupabase.from('jobs').select('id, job_number, project_name').in('id', visible)
      if (jErr) return Response.json({ error: jErr.message }, { status: 500 })
      jobs = jr || []
    }
    const { contract_job_ids, ...preview } = r.preview
    return Response.json({ preview: { ...preview, jobs, other_jobs: all.length - visible.length } })
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
  // Office upload / replace of a COI file: the new expiration date comes with it,
  // so the expired list, badges and reminders don't keep using the old one.
  if (office && updates.coi_url) {
    const { data: curCoi, error: curErr } = await adminSupabase.from('sub_directory').select('coi_url').eq('id', directory_id).maybeSingle()
    if (curErr) return Response.json({ error: curErr.message }, { status: 500 })
    if (curCoi?.coi_url !== updates.coi_url) {
      const coiErr = coiUploadError(updates)
      if (coiErr) return Response.json({ error: coiErr }, { status: 400 })
    }
  }
  if (!office) {
    if (!dir || dir.id !== directory_id) return forbidden()
    for (const key of ['w9_url', 'coi_url']) {
      if (updates[key] && updates[key] !== dir[key] && !updates[key].startsWith(`${dir.id}/`)) return forbidden()
    }
  }

  // Company-name change: only as a confirmed rename (Directory shows the
  // rename-preview first). Changes this Directory row and, when exactly one
  // company has the old name and the reviewed company_id matches, that company
  // record by id. Existing subcontracts, prime CO descriptions and profiles are
  // NOT rewritten (they keep the name they were recorded under).
  let rename = null
  if ('company_name' in updates) {
    const next = String(updates.company_name || '').trim()
    const { data: existing, error: exErr } = await adminSupabase.from('sub_directory').select('company_name').eq('id', directory_id).maybeSingle()
    if (exErr) return Response.json({ error: exErr.message }, { status: 500 })
    if (!existing) return Response.json({ error: 'Directory entry not found.' }, { status: 404 })
    const oldName = existing.company_name || ''
    if (!next) {
      if (oldName.trim()) return Response.json({ error: 'Company name cannot be blank.' }, { status: 400 })
      delete updates.company_name
    } else if (next === oldName.trim()) {
      delete updates.company_name
    } else {
      if (body.confirm_rename !== true) {
        return Response.json({ error: 'Company name change needs the rename confirmation. Review the rename and try again.', rename_required: true }, { status: 409 })
      }
      if (typeof body.expected_old_name !== 'string' || body.expected_old_name !== oldName) {
        return Response.json({ error: 'This entry was renamed since you opened it. Reload and review again.', stale: true }, { status: 409 })
      }
      updates.company_name = next
      const r = await renameImpact(adminSupabase, directory_id, next)
      if (r.error) return Response.json({ error: r.error }, { status: r.status })
      const reviewed = body.company_id || null
      if (reviewed !== r.preview.company_id) {
        return Response.json({ error: 'The company record affected by this rename changed since you reviewed it. Review again.', stale: true }, { status: 409 })
      }
      rename = { oldName, next, companyId: r.preview.company_id }
    }
  }

  let oldCompanyName = null
  if (rename?.companyId) {
    const { data: co, error: coErr } = await adminSupabase.from('companies').select('id, name').eq('id', rename.companyId).maybeSingle()
    if (coErr) return Response.json({ error: coErr.message }, { status: 500 })
    if (!co || !sameExactName(co.name, rename.oldName)) return Response.json({ error: 'The company record changed since you reviewed it. Review again.', stale: true }, { status: 409 })
    oldCompanyName = co.name
    const { data: upd, error: upErr } = await adminSupabase.from('companies')
      .update({ name: rename.next }).eq('id', co.id).eq('name', oldCompanyName).select('id')
    if (upErr) return Response.json({ error: 'Company record not renamed: ' + upErr.message }, { status: 500 })
    if (!upd?.length) return Response.json({ error: 'The company record changed since you reviewed it. Nothing was saved.', stale: true }, { status: 409 })
  }

  let q = adminSupabase.from('sub_directory').update(updates).eq('id', directory_id)
  if (rename) q = q.eq('company_name', rename.oldName)
  const { data: saved, error } = await q.select('id')
  if (error || !saved?.length) {
    const msg = error ? error.message : 'This entry changed since you opened it. Reload and try again.'
    if (oldCompanyName) {
      // Put the company name back (guarded) so nothing is half-renamed.
      const { data: back, error: backErr } = await adminSupabase.from('companies')
        .update({ name: oldCompanyName }).eq('id', rename.companyId).eq('name', rename.next).select('id')
      if (backErr || !back?.length) {
        return Response.json({ error: `${msg} The company record was already renamed to "${rename.next}" and could not be changed back; rename it back to "${oldCompanyName}" in Directory.`, partial: true }, { status: 500 })
      }
    }
    return Response.json({ error: msg }, { status: error ? 500 : 409 })
  }

  return Response.json({ ok: true, renamed: rename ? { from: rename.oldName, to: rename.next, company_renamed: !!oldCompanyName } : null })
}
