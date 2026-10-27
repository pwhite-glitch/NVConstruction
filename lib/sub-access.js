// Server-only. Single source of truth for "which sub users see which jobs, and
// who can bill". Used by the sub portal APIs and the PM-side company APIs so
// both sides agree.
//
// Rules (see migration 027):
// - A company is "on a job" when any job_assignments row for the job has its
//   company_id, or belongs to one of its people, or it has a non-draft
//   subcontract on the job.
// - A person sees a job when they have their own assignment row (sub_id or
//   sub_email), or their profile.job_access is 'company' and the company is on
//   the job.
// - Billing is on for the company on a job when any of those assignment rows
//   has billing_enabled = true. A company that is only on the job through a
//   subcontract (no assignment rows) is billable, matching the old behaviour.
// - A person can bill when they see the job, billing is on, and their
//   profile.can_bill is not false.
import { createClient } from '@supabase/supabase-js'
import { isSub } from './server-auth'
import { sameCompany } from './company-name'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const SUB_ROLE_LIST = ['subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin']
export const PORTAL_JOB_FIELDS = 'id, job_number, project_name, status, pm_email, sub_billing_due, sub_billing_frequency, sub_billing_anchor, sub_billing_start, owner_name, owner_company, location, cover_image_path'

const lc = s => (s || '').toLowerCase().trim()
const notDraft = q => q.or('status.is.null,status.neq.draft')

export async function getCompanyProfiles(companyId) {
  if (!companyId) return []
  const { data } = await adminSupabase
    .from('profiles')
    .select('id, full_name, role, phone, invite_email, company_id, company_name, job_access, can_bill')
    .eq('company_id', companyId)
  return data || []
}

// Every job_assignments row that belongs to this company: company-level rows
// plus rows for any of its people.
export async function getCompanyAssignmentRows(companyId, members, jobId = null) {
  const ids = members.map(m => m.id)
  const emails = [...new Set(members.map(m => lc(m.invite_email)).filter(Boolean))]
  const ors = []
  if (companyId) ors.push(`company_id.eq.${companyId}`)
  if (ids.length) ors.push(`sub_id.in.(${ids.join(',')})`)
  if (emails.length) ors.push(`sub_email.in.(${emails.map(e => `"${e}"`).join(',')})`)
  if (!ors.length) return []
  let q = adminSupabase.from('job_assignments').select('*').or(ors.join(','))
  if (jobId) q = q.eq('job_id', jobId)
  const { data } = await q
  return data || []
}

const isPersonRow = (row, person) =>
  (person.id && row.sub_id === person.id) || (lc(person.invite_email || person.email) && lc(row.sub_email) === lc(person.invite_email || person.email))

export const isCompanyLevelRow = row => !row.sub_id && !row.sub_email

// Subcontracts on a job a sub user may bill against: anything for their
// company, anything linked to one of their teammates, their own legacy links,
// and unlinked contracts whose vendor name matches the company name.
export async function getBillableContracts({ jobId, userId, companyId, companyName, memberIds = [] }) {
  const select = 'id, description, retainage_pct, contract_value, company_id, sub_id, vendor_name'
  const queries = [notDraft(adminSupabase.from('subcontracts').select(select).eq('job_id', jobId).eq('sub_id', userId))]
  if (companyId) queries.push(notDraft(adminSupabase.from('subcontracts').select(select).eq('job_id', jobId).eq('company_id', companyId)))
  if (memberIds.length) queries.push(notDraft(adminSupabase.from('subcontracts').select(select).eq('job_id', jobId).in('sub_id', memberIds)))
  if (companyName?.trim()) queries.push(notDraft(adminSupabase.from('subcontracts').select(select).eq('job_id', jobId).is('company_id', null).ilike('vendor_name', companyName.trim())))
  const results = await Promise.all(queries)
  const seen = new Set()
  return results.flatMap(r => r.data || []).filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

// What one sub user can see and bill. `email` is their login email.
export async function getSubAccess(userId, email) {
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('id, full_name, role, phone, invite_email, company_id, company_name, job_access, can_bill')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return { profile: null, members: [], jobs: [] }

  const me = { ...profile, invite_email: profile.invite_email || email }
  const companyId = profile.company_id || null
  const members = companyId ? await getCompanyProfiles(companyId) : [me]
  if (!members.some(m => m.id === userId)) members.push(me)

  // Own rows (by id or email), and all company rows
  const ownOrs = [`sub_id.eq.${userId}`]
  if (lc(me.invite_email)) ownOrs.push(`sub_email.ilike.${lc(me.invite_email)}`)
  const [{ data: ownRows }, companyRows, { data: ownContracts }, companyContractsRes] = await Promise.all([
    adminSupabase.from('job_assignments').select('*').or(ownOrs.join(',')),
    companyId ? getCompanyAssignmentRows(companyId, members) : Promise.resolve([]),
    notDraft(adminSupabase.from('subcontracts').select('job_id').eq('sub_id', userId)),
    companyId ? notDraft(adminSupabase.from('subcontracts').select('job_id').eq('company_id', companyId)) : Promise.resolve({ data: [] }),
  ])

  const seesAllCompanyJobs = (profile.job_access || 'company') === 'company'
  const visible = new Map() // job_id → 'person' | 'company'
  for (const r of ownRows || []) visible.set(r.job_id, 'person')
  for (const c of ownContracts || []) if (!visible.has(c.job_id)) visible.set(c.job_id, 'person')
  if (seesAllCompanyJobs) {
    for (const r of companyRows) if (!visible.has(r.job_id)) visible.set(r.job_id, 'company')
    for (const c of companyContractsRes.data || []) if (!visible.has(c.job_id)) visible.set(c.job_id, 'company')
  }

  const jobIds = [...visible.keys()]
  if (!jobIds.length) return { profile: me, members, jobs: [] }
  const { data: jobRows } = await adminSupabase.from('jobs').select(PORTAL_JOB_FIELDS).in('id', jobIds).eq('status', 'active').order('project_name')

  const allRows = [...(ownRows || []), ...companyRows]
  const jobs = (jobRows || []).map(j => {
    const rows = allRows.filter(r => r.job_id === j.id)
    const billingOn = rows.length === 0 || rows.some(r => r.billing_enabled !== false)
    let lockReason = null
    if (!billingOn) lockReason = 'billing_off'
    else if (profile.can_bill === false) lockReason = 'person_cannot_bill'
    return { ...j, access_via: visible.get(j.id), billing_on: billingOn, can_bill: !lockReason, billing_lock_reason: lockReason }
  })
  return { profile: me, members, jobs }
}

// Everyone at a sub company the PM might want to email or give access to:
// portal users, company_contacts, and sub_directory contacts — merged by email.
// With jobId, each person also gets their access/billing state on that job.
// Finds the companies row by id, then by name (punctuation / "LLC" ignored), then
// through a known contact email (e.g. the directory contact's portal profile).
export async function resolveCompany({ companyId, companyName, email }) {
  const cols = 'id, name, email, phone'
  if (companyId) {
    const { data } = await adminSupabase.from('companies').select(cols).eq('id', companyId).maybeSingle()
    if (data) return data
  }
  if (companyName?.trim()) {
    const { data: all } = await adminSupabase.from('companies').select(cols)
    const hit = (all || []).find(co => sameCompany(co.name, companyName))
    if (hit) return hit
  }
  if (email?.trim()) {
    const { data: prof } = await adminSupabase.from('profiles').select('company_id').ilike('invite_email', email.trim()).not('company_id', 'is', null).limit(1).maybeSingle()
    if (prof?.company_id) {
      const { data } = await adminSupabase.from('companies').select(cols).eq('id', prof.company_id).maybeSingle()
      if (data) return data
    }
  }
  return null
}

export async function getCompanyPeople({ companyId, companyName, email = null, jobId = null }) {
  const company = await resolveCompany({ companyId, companyName, email })
  const name = company?.name || companyName || ''

  const [linkedProfiles, { data: unlinkedProfiles }, { data: contacts }, { data: dirRows }] = await Promise.all([
    company ? getCompanyProfiles(company.id) : Promise.resolve([]),
    name.trim()
      ? adminSupabase.from('profiles').select('id, full_name, role, phone, invite_email, company_id, company_name, job_access, can_bill').is('company_id', null).in('role', SUB_ROLE_LIST)
      : Promise.resolve({ data: [] }),
    company ? adminSupabase.from('company_contacts').select('*').eq('company_id', company.id).order('full_name') : Promise.resolve({ data: [] }),
    adminSupabase.from('sub_directory').select('id, contact_name, email, phone, company_name, status'),
  ])

  let authByEmail = {}
  try {
    const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    for (const u of authData?.users || []) if (u.email) authByEmail[lc(u.email)] = u
  } catch (_) {}

  const people = new Map()
  const keyOf = (email, fallback) => lc(email) || fallback
  const upsert = (key, patch, source) => {
    const cur = people.get(key) || { key, sources: [] }
    for (const [k, v] of Object.entries(patch)) if (v != null && v !== '' && cur[k] == null) cur[k] = v
    if (!cur.sources.includes(source)) cur.sources.push(source)
    people.set(key, cur)
  }

  // Unlinked users and directory rows match on a loose company name, or (directory) on
  // the email of someone already at the company.
  const knownEmails = new Set([...linkedProfiles.map(p => lc(p.invite_email)), ...(contacts || []).map(c => lc(c.email)), lc(email)].filter(Boolean))
  const nameMatches = n => sameCompany(n, name) || (company && sameCompany(n, companyName))
  const unlinked = (unlinkedProfiles || []).filter(p => nameMatches(p.company_name))
  const dirMatches = (dirRows || []).filter(d => nameMatches(d.company_name) || knownEmails.has(lc(d.email)))

  for (const p of [...linkedProfiles, ...unlinked]) {
    if (!SUB_ROLE_LIST.includes(p.role)) continue
    const auth = authByEmail[lc(p.invite_email)]
    upsert(keyOf(p.invite_email, `user:${p.id}`), {
      user_id: p.id, name: p.full_name, email: lc(p.invite_email) || null, phone: p.phone, role: p.role,
      job_access: p.job_access || 'company', can_bill: p.can_bill !== false,
      linked_to_company: !!p.company_id, last_sign_in_at: auth?.last_sign_in_at || null,
    }, 'portal')
  }
  for (const c of contacts || []) {
    upsert(keyOf(c.email, `contact:${c.id}`), { contact_id: c.id, name: c.full_name, email: lc(c.email) || null, phone: c.phone, title: c.title }, 'contact')
  }
  for (const d of dirMatches) {
    if (!d.email && !d.contact_name) continue
    upsert(keyOf(d.email, `dir:${d.id}`), { directory_id: d.id, name: d.contact_name, email: lc(d.email) || null, phone: d.phone }, 'directory')
  }

  const list = [...people.values()].map(p => ({ ...p, has_login: !!p.user_id }))

  let job = null
  if (jobId && company) {
    const members = linkedProfiles
    const [rows, { data: contractRows }] = await Promise.all([
      getCompanyAssignmentRows(company.id, members, jobId),
      notDraft(adminSupabase.from('subcontracts').select('id, contract_value').eq('job_id', jobId).eq('company_id', company.id)),
    ])
    const onJob = rows.length > 0 || (contractRows || []).length > 0
    const billingOn = onJob && (rows.length === 0 || rows.some(r => r.billing_enabled !== false))
    for (const p of list) {
      const named = rows.some(r => isPersonRow(r, { id: p.user_id, email: p.email }))
      const sees = p.has_login && (named || (onJob && p.linked_to_company && p.job_access === 'company'))
      p.job = {
        assigned_by_name: named,
        sees_job: sees,
        sees_via: !sees ? null : named ? 'assigned' : 'company',
        can_bill_job: sees && billingOn && p.can_bill,
      }
    }
    job = {
      job_id: jobId,
      on_job: onJob,
      has_company_row: rows.some(isCompanyLevelRow),
      billing_on: billingOn,
      contract_total: (contractRows || []).reduce((a, c) => a + Number(c.contract_value || 0), 0),
      row_ids: rows.map(r => r.id),
    }
  }

  list.sort((a, b) => (b.has_login - a.has_login) || (a.name || a.email || '').localeCompare(b.name || b.email || ''))
  return { company: company || (name ? { id: null, name } : null), people: list, job }
}

// Resolves the caller's billing context for one job, or an error Response.
export async function billingContext(auth, jobId) {
  if (!isSub(auth.role)) return { error: Response.json({ error: 'Sub portal only' }, { status: 403 }) }
  if (!jobId) return { error: Response.json({ error: 'job_id required' }, { status: 400 }) }
  const { profile, members, jobs } = await getSubAccess(auth.userId, auth.email)
  const job = jobs.find(j => j.id === jobId)
  if (!job) return { error: Response.json({ error: 'You do not have access to this project.' }, { status: 403 }) }
  const contracts = await getBillableContracts({
    jobId, userId: auth.userId, companyId: profile.company_id, companyName: profile.company_name, memberIds: members.map(m => m.id),
  })
  return { profile, job, contracts }
}
