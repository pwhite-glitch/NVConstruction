// Server-only. Who hears about a lookahead: the job's PMs when the super submits
// it, and the people at each tagged sub when the PM sends it.
import { createClient } from '@supabase/supabase-js'
import { SUB_ROLE_LIST } from './sub-access'
import { subName } from './lookahead-fields'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// profiles has no email column; auth.users does. One page covers this company.
async function authEmails(ids) {
  if (!ids.length) return {}
  const { data } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  const want = new Set(ids)
  return Object.fromEntries((data?.users || []).filter(u => want.has(u.id)).map(u => [u.id, u.email]))
}

// Office users on the job: PM/APM/admin assigned to it, plus the user whose email
// is the job's pm_email. The submitter is left out.
export async function jobPmUserIds(job, excludeId) {
  const ids = new Set()
  const { data: assigns } = await adminSupabase.from('pm_job_assignments').select('user_id').eq('job_id', job.id)
  const assigned = (assigns || []).map(a => a.user_id).filter(Boolean)
  if (assigned.length) {
    const { data: profs } = await adminSupabase.from('profiles').select('id, role').in('id', assigned)
    for (const p of profs || []) if (['pm', 'apm', 'admin'].includes(p.role)) ids.add(p.id)
  }
  if (job.pm_email) {
    const { data } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
    const u = (data?.users || []).find(x => x.email?.toLowerCase() === job.pm_email.toLowerCase())
    if (u) ids.add(u.id)
  }
  ids.delete(excludeId)
  return [...ids]
}

// One entry per subcontract tagged on the activities:
// { contract_id, vendor_name, activities: [...], people: [{ id, name, email, portal }] }
// people: the sub user on the contract and the company's portal users; when there
// are none, the company email on file (email only, no portal).
export async function lookaheadSubRecipients(activities) {
  const byContract = new Map()
  for (const a of activities || []) {
    if (a.responsible_type !== 'sub' || !a.sub_id) continue
    if (!byContract.has(a.sub_id)) byContract.set(a.sub_id, [])
    byContract.get(a.sub_id).push(a)
  }
  if (!byContract.size) return []
  const { data: contracts } = await adminSupabase.from('subcontracts').select('id, vendor_name, sub_id, company_id').in('id', [...byContract.keys()])
  const companyIds = [...new Set((contracts || []).map(c => c.company_id).filter(Boolean))]
  const [{ data: members }, { data: companies }] = await Promise.all([
    companyIds.length
      ? adminSupabase.from('profiles').select('id, full_name, invite_email, role, company_id').in('company_id', companyIds).in('role', SUB_ROLE_LIST)
      : Promise.resolve({ data: [] }),
    companyIds.length ? adminSupabase.from('companies').select('id, name, email').in('id', companyIds) : Promise.resolve({ data: [] }),
  ])
  const directIds = (contracts || []).map(c => c.sub_id).filter(Boolean)
  const { data: directProfs } = directIds.length
    ? await adminSupabase.from('profiles').select('id, full_name, invite_email, role, company_id').in('id', directIds)
    : { data: [] }
  const allProfs = [...(members || []), ...(directProfs || [])]
  const missing = allProfs.filter(p => !p.invite_email).map(p => p.id)
  const emails = await authEmails(missing)

  return (contracts || []).map(c => {
    const profs = allProfs.filter(p => p.id === c.sub_id || (c.company_id && p.company_id === c.company_id))
    const seen = new Set()
    const people = profs.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .map(p => ({ id: p.id, name: p.full_name || '', email: p.invite_email || emails[p.id] || '', portal: true }))
    const company = (companies || []).find(co => co.id === c.company_id)
    if (!people.length && company?.email) people.push({ id: null, name: company.name || subName(c), email: company.email, portal: false })
    return { contract_id: c.id, vendor_name: subName(c), activities: byContract.get(c.id) || [], people }
  }).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name))
}
