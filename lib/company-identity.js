// Company identity helpers for Directory edits (finding 3) and Fix Company Links
// (finding 10). A company name is never used as a LIKE pattern: lookups escape
// %, _ and \ (ilikeExact) and then re-check exact case-insensitive equality, and
// an ambiguous name (two companies with the same name) never picks one.
// No server-only imports: the confirm-message builder is used by the browser too.
import { ilikeExact, normEmail } from './roles'

export const SUB_ROLE_LIST = ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']

// Literal case-insensitive name key (trim + lowercase). Not the loose companyKey.
export const nameKey = s => String(s ?? '').trim().toLowerCase()
export const sameExactName = (a, b) => !!nameKey(a) && nameKey(a) === nameKey(b)

// companies rows whose name is exactly `name` (case-insensitive, trimmed).
// Returns { rows } or { error }.
export async function findCompaniesByExactName(db, name) {
  const n = String(name ?? '').trim()
  if (!n) return { rows: [] }
  const { data, error } = await db.from('companies').select('id, name').ilike('name', ilikeExact(n))
  if (error) return { error }
  return { rows: (data || []).filter(c => sameExactName(c.name, n)) }
}

// One company for a name: { company } when exactly one matches, { company: null,
// reason: 'none' | 'ambiguous', matches } otherwise, or { error }.
export async function resolveUniqueCompany(db, name) {
  const r = await findCompaniesByExactName(db, name)
  if (r.error) return { error: r.error }
  if (r.rows.length === 1) return { company: r.rows[0], matches: r.rows }
  return { company: null, reason: r.rows.length ? 'ambiguous' : 'none', matches: r.rows }
}

// ── Finding 3: Directory company-name change ────────────────────────────────

// What a Directory rename would and would not change. Read-only.
// Returns { preview } or { error, status }.
export async function renameImpact(db, directoryId, newName) {
  const next = String(newName ?? '').trim()
  if (!next) return { status: 400, error: 'Company name cannot be blank.' }
  const { data: dir, error: dirErr } = await db.from('sub_directory').select('id, company_name').eq('id', directoryId).maybeSingle()
  if (dirErr) return { status: 500, error: dirErr.message }
  if (!dir) return { status: 404, error: 'Directory entry not found.' }
  const oldName = dir.company_name || ''
  const changed = oldName.trim() !== next

  const co = await resolveUniqueCompany(db, oldName)
  if (co.error) return { status: 500, error: co.error.message }
  // Renaming the shared company onto a name another company already uses would
  // merge two identities by name; leave that to Merge Companies.
  const clash = await findCompaniesByExactName(db, next)
  if (clash.error) return { status: 500, error: clash.error.message }
  const clashOther = (clash.rows || []).filter(c => c.id !== co.company?.id)

  let company = null
  let companyNote
  if (!changed) companyNote = 'Name unchanged.'
  else if (co.company && clashOther.length) companyNote = `Shared company record "${co.company.name}" will NOT be renamed: another company is already named "${next}" (use Merge Companies).`
  else if (co.company) { company = co.company; companyNote = `Shared company record "${co.company.name}" will be renamed to "${next}" (portal header for its users).` }
  else if (co.reason === 'ambiguous') companyNote = `Shared company record NOT renamed: ${co.matches.length} companies are named "${oldName}" — fix with Merge Companies first.`
  else companyNote = `No shared company record is named exactly "${oldName}"; none will be renamed.`

  // Existing contracts keep the name they were written under. Listed so the
  // user sees what is NOT being rewritten.
  const { data: contracts, error: scErr } = oldName.trim()
    ? await db.from('subcontracts').select('id, job_id, vendor_name').ilike('vendor_name', ilikeExact(oldName.trim()))
    : { data: [], error: null }
  if (scErr) return { status: 500, error: scErr.message }
  const kept = (contracts || []).filter(c => sameExactName(c.vendor_name, oldName))

  return {
    preview: {
      directory_id: dir.id,
      old_name: oldName,
      new_name: next,
      changed,
      company_id: company?.id || null,
      company_note: companyNote,
      contracts_kept: kept.length,
      contract_job_ids: [...new Set(kept.map(c => c.job_id).filter(Boolean))],
    },
  }
}

// Browser confirm text for a rename preview.
export function renameConfirmMessage(p, jobLabels = []) {
  const lines = [
    `Rename "${p.old_name}" to "${p.new_name}"?`,
    '',
    'This will change:',
    '• This Directory entry',
    `• ${p.company_note}`,
    '',
    'This will NOT change:',
    p.contracts_kept
      ? `• ${p.contracts_kept} existing subcontract${p.contracts_kept === 1 ? '' : 's'}${jobLabels.length ? ` (jobs ${jobLabels.join(', ')})` : ''} — they keep "${p.old_name}"`
      : '• Existing subcontracts (none are recorded under the old name)',
    '• Prime change order descriptions, signed contracts, or user profiles',
  ]
  return lines.join('\n')
}

// Browser side of a Directory save (dashboard + admin). When the company name
// changed, loads the rename preview and asks for confirmation.
// Returns { proceed: true, extra } (extra goes into the save body),
// { proceed: false } (cancelled), or { error }.
export async function prepareDirectorySave({ fetchFn, confirmFn, directoryId, originalName, newName }) {
  const next = String(newName ?? '').trim()
  if (!next || next === String(originalName ?? '').trim()) return { proceed: true, extra: {} }
  let res, json
  try {
    res = await fetchFn('/api/sub-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename-preview', directory_id: directoryId, company_name: next }),
    })
    json = await res.json().catch(() => ({}))
  } catch (e) {
    return { error: 'Could not load rename impact: ' + (e?.message || 'network error') }
  }
  if (!res.ok || !json?.preview) return { error: json?.error || 'Could not load rename impact.' }
  const p = json.preview
  const labels = (p.jobs || []).map(j => j.job_number || j.project_name || j.id)
  if (p.other_jobs) labels.push(`+${p.other_jobs} other job${p.other_jobs === 1 ? '' : 's'}`)
  if (!confirmFn(renameConfirmMessage(p, labels))) return { proceed: false }
  return { proceed: true, extra: { confirm_rename: true, expected_old_name: p.old_name, company_id: p.company_id } }
}

// ── Finding 10: Fix Company Links (review list) ─────────────────────────────

// Classify one profile for linking to `company` given the auth login email and
// that email's directory rows. Returns { eligible: true } or { eligible: false, reason }.
export function classifyLinkCandidate(profile, company, authEmail, dirRows) {
  if (!SUB_ROLE_LIST.includes(profile.role)) return { eligible: false, reason: 'Not a subcontractor account (office/other role).' }
  if (profile.company_id) {
    return { eligible: false, reason: profile.company_id === company.id ? 'Already linked to this company.' : 'Already linked to another company.' }
  }
  if (!authEmail) return { eligible: false, reason: 'Login email could not be confirmed.' }
  const mine = (dirRows || []).filter(d => normEmail(d.email) === normEmail(authEmail))
  if (!mine.length) return { eligible: false, reason: 'No Directory application for this login email.' }
  const approved = mine.filter(d => d.status === 'approved')
  if (!approved.length) {
    const st = [...new Set(mine.map(d => d.status || 'pending'))].join('/')
    return { eligible: false, reason: `Directory application is ${st}, not approved.` }
  }
  const forThis = approved.filter(d => sameExactName(d.company_name, company.name))
  if (!forThis.length) return { eligible: false, reason: 'Approved Directory entry is for a different company.' }
  if (approved.length > forThis.length) return { eligible: false, reason: 'Login email has approved Directory entries for more than one company.' }
  return { eligible: true }
}

async function loginEmail(db, userId) {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId)
    if (error) return null
    return data?.user?.email ? normEmail(data.user.email) : null
  } catch {
    return null
  }
}

async function dirRowsFor(db, email) {
  const { data, error } = await db.from('sub_directory').select('id, company_name, email, status').ilike('email', ilikeExact(email))
  if (error) return { error }
  return { rows: (data || []).filter(d => normEmail(d.email) === email) }
}

// Evaluate one profile row against company. Returns { eligible, reason } or { error }.
export async function evaluateProfile(db, profile, company) {
  // Role / existing-link checks first (no auth lookup needed to exclude).
  if (!SUB_ROLE_LIST.includes(profile.role) || profile.company_id) return classifyLinkCandidate(profile, company, null, [])
  const email = await loginEmail(db, profile.id)
  if (!email) return { eligible: false, reason: 'Login email could not be confirmed.' }
  const d = await dirRowsFor(db, email)
  if (d.error) return { error: d.error }
  return { ...classifyLinkCandidate(profile, company, email, d.rows), email }
}

const PROFILE_COLS = 'id, full_name, role, company_id, company_name, invite_email'

// Read-only review list for a Directory entry. Returns { review } or { status, error }.
export async function linkReview(db, directoryId) {
  const { data: dir, error: dirErr } = await db.from('sub_directory').select('id, company_name, email, status').eq('id', directoryId).maybeSingle()
  if (dirErr) return { status: 500, error: dirErr.message }
  if (!dir) return { status: 404, error: 'Directory entry not found.' }
  if (dir.status !== 'approved') return { status: 409, error: 'Approve this Directory entry before linking people to it.' }
  const co = await resolveUniqueCompany(db, dir.company_name)
  if (co.error) return { status: 500, error: co.error.message }
  const base = { directory_id: dir.id, company_name: dir.company_name, company: co.company, company_reason: co.company ? null : co.reason, candidates: [], excluded: [] }
  if (!co.company) return { review: base }

  // Suggestions: literal company_name match, or the Directory entry's own email.
  const n = String(dir.company_name || '').trim()
  const byName = await db.from('profiles').select(PROFILE_COLS).ilike('company_name', ilikeExact(n))
  if (byName.error) return { status: 500, error: byName.error.message }
  let rows = (byName.data || []).filter(p => sameExactName(p.company_name, n))
  if (dir.email) {
    const byEmail = await db.from('profiles').select(PROFILE_COLS).ilike('invite_email', ilikeExact(normEmail(dir.email)))
    if (byEmail.error) return { status: 500, error: byEmail.error.message }
    for (const p of byEmail.data || []) if (normEmail(p.invite_email) === normEmail(dir.email) && !rows.some(r => r.id === p.id)) rows.push(p)
  }
  for (const p of rows) {
    const r = await evaluateProfile(db, p, co.company)
    if (r.error) return { status: 500, error: r.error.message }
    const person = { id: p.id, full_name: p.full_name || null, role: p.role, email: r.email || p.invite_email || null }
    if (r.eligible) base.candidates.push(person)
    else base.excluded.push({ ...person, reason: r.reason })
  }
  return { review: base }
}

// Link explicitly selected profiles to a verified company. Each is re-checked now
// and written only while company_id is still NULL. Returns { result } or { status, error }.
export async function linkSelected(db, { company_id, directory_id, profile_ids }) {
  if (!company_id || !directory_id) return { status: 400, error: 'company_id and directory_id required' }
  if (!Array.isArray(profile_ids) || !profile_ids.length || profile_ids.some(id => typeof id !== 'string' || !id)) {
    return { status: 400, error: 'Select at least one person (profile_ids).' }
  }
  const { data: company, error: coErr } = await db.from('companies').select('id, name').eq('id', company_id).maybeSingle()
  if (coErr) return { status: 500, error: coErr.message }
  if (!company) return { status: 404, error: 'Company not found.' }
  const { data: dir, error: dirErr } = await db.from('sub_directory').select('id, company_name, status').eq('id', directory_id).maybeSingle()
  if (dirErr) return { status: 500, error: dirErr.message }
  if (!dir) return { status: 404, error: 'Directory entry not found.' }
  if (dir.status !== 'approved') return { status: 409, error: 'Directory entry is not approved.' }
  if (!sameExactName(dir.company_name, company.name)) return { status: 409, error: 'Directory entry and company no longer have the same name. Reload and review again.' }
  const uniq = await resolveUniqueCompany(db, company.name)
  if (uniq.error) return { status: 500, error: uniq.error.message }
  if (uniq.company?.id !== company.id) return { status: 409, error: 'More than one company has this name. Merge them first.' }

  const linked = []
  const skipped = []
  const failed = []
  for (const id of [...new Set(profile_ids)]) {
    const { data: p, error } = await db.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()
    if (error) { failed.push({ id, reason: error.message }); continue }
    if (!p) { skipped.push({ id, reason: 'Profile not found.' }); continue }
    const r = await evaluateProfile(db, p, company)
    if (r.error) { failed.push({ id, reason: r.error.message }); continue }
    if (!r.eligible) { skipped.push({ id, name: p.full_name || null, reason: r.reason }); continue }
    const { data: upd, error: updErr } = await db.from('profiles')
      .update({ company_id: company.id })
      .eq('id', id)
      .is('company_id', null)
      .in('role', SUB_ROLE_LIST)
      .select('id')
    if (updErr) { failed.push({ id, reason: updErr.message }); continue }
    if (!upd?.length) { skipped.push({ id, name: p.full_name || null, reason: 'Changed since review (already linked).' }); continue }
    linked.push({ id, name: p.full_name || null })
  }
  return { result: { ok: failed.length === 0, company_id: company.id, linked, skipped, failed } }
}

// Create the shared company record for an approved Directory entry when no
// company has that name (exact or loose-equivalent is checked by the caller).
export async function createCompanyForDirectory(db, directoryId, looseMatch) {
  const { data: dir, error: dirErr } = await db.from('sub_directory').select('id, company_name, email, phone, status').eq('id', directoryId).maybeSingle()
  if (dirErr) return { status: 500, error: dirErr.message }
  if (!dir) return { status: 404, error: 'Directory entry not found.' }
  if (dir.status !== 'approved') return { status: 409, error: 'Approve this Directory entry first.' }
  const name = String(dir.company_name || '').trim()
  if (!name) return { status: 400, error: 'Directory entry has no company name.' }
  const { data: all, error: allErr } = await db.from('companies').select('id, name')
  if (allErr) return { status: 500, error: allErr.message }
  const similar = (all || []).filter(c => sameExactName(c.name, name) || (looseMatch && looseMatch(c.name, name)))
  if (similar.length) return { status: 409, error: `A company named "${similar[0].name}" already exists. Use it (or Merge Companies) instead of creating another.` }
  const { data: created, error } = await db.from('companies').insert({ name, email: dir.email || null, phone: dir.phone || null }).select('id, name').single()
  if (error) return { status: 500, error: error.message }
  return { company: created }
}
