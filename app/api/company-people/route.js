import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { getCompanyPeople, getCompanyName, SUB_ROLE_LIST } from '../../../lib/sub-access'
import { denyJob } from '../../../lib/roles'
import { canManageCompanyPeople } from '../../../lib/company-people-access'
import { logChange } from '../../../lib/change-log'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Every write (POST / PATCH / DELETE) needs canManageCompanyPeople for the
// target company: Owner/admin any company; PM/APM/super only a company on one
// of their jobs. Reads stay requirePM (GET reports can_manage for the UI).
async function denyManage(auth, companyId) {
  const r = await canManageCompanyPeople(adminSupabase, auth, companyId)
  return r.ok ? null : Response.json({ error: r.error }, { status: r.status })
}

async function companyNote(companyId, prefix) {
  const name = await getCompanyName(companyId).catch(() => null)
  return `${prefix} — ${name || companyId}`
}

// "Name <email>", "Name", "email", or null.
function contactLabel(c) {
  if (c?.full_name && c?.email) return `${c.full_name} <${c.email}>`
  return c?.full_name || c?.email || null
}

// GET ?company_id= | ?company_name= [&job_id=] → everyone at the company
// (portal users, contacts, directory contacts) merged by email. With job_id,
// each person also carries their access/billing state on that job.
// can_manage: whether the caller may change people for this company.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    // With job_id the result carries per-job access/billing state; without it, company-wide
    if (searchParams.get('job_id')) {
      const denied = await denyJob(adminSupabase, auth, searchParams.get('job_id'))
      if (denied) return denied
    }
    const result = await getCompanyPeople({
      companyId: searchParams.get('company_id') || null,
      companyName: searchParams.get('company_name') || null,
      email: searchParams.get('email') || null,
      jobId: searchParams.get('job_id') || null,
    })
    const companyId = result?.company?.id || null
    const can_manage = companyId ? (await canManageCompanyPeople(adminSupabase, auth, companyId)).ok === true : false
    return Response.json({ ...result, can_manage })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST { company_id, full_name, email, phone, title } → add a contact (no portal login). Sends no email.
export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { company_id, full_name, email, phone, title } = await request.json()
    if (!company_id) return Response.json({ error: 'company_id required' }, { status: 400 })
    if (!full_name?.trim() && !email?.trim()) return Response.json({ error: 'Name or email required' }, { status: 400 })
    const denied = await denyManage(auth, company_id)
    if (denied) return denied
    const { data, error } = await adminSupabase.from('company_contacts').insert({
      company_id,
      full_name: full_name?.trim() || null,
      email: email?.trim().toLowerCase() || null,
      phone: phone?.trim() || null,
      title: title?.trim() || null,
      created_by: auth.userId,
    }).select().single()
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'That email is already a contact for this company.' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    await logChange({
      job_id: null, entity_type: 'company_contact', entity_id: data?.id, field_name: 'contact',
      old_value: null, new_value: contactLabel(data), changed_by: auth.userId,
      note: await companyNote(company_id, 'Contact added'),
    })
    return Response.json({ ok: true, contact: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH { user_id, job_access?, can_bill? } → per-person settings for a portal user (apply to all their jobs).
// PATCH { contact_id, full_name?, email?, phone?, title? } → edit a contact.
// Sends no email.
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    if (body.user_id) {
      const update = {}
      if (body.job_access !== undefined) {
        if (!['company', 'assigned'].includes(body.job_access)) return Response.json({ error: "job_access must be 'company' or 'assigned'" }, { status: 400 })
        update.job_access = body.job_access
      }
      if (body.can_bill !== undefined) update.can_bill = !!body.can_bill
      if (!Object.keys(update).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
      const { data: prof, error: profErr } = await adminSupabase.from('profiles').select('role, company_id, job_access, can_bill').eq('id', body.user_id).maybeSingle()
      if (profErr) return Response.json({ error: profErr.message }, { status: 500 })
      // Authorize first when the profile has a company, so an out-of-scope caller gets
      // 403 instead of learning whether the id is a sub user.
      if (prof?.company_id) {
        const denied = await denyManage(auth, prof.company_id)
        if (denied) return denied
      }
      if (!SUB_ROLE_LIST.includes(prof?.role)) return Response.json({ error: 'Not a subcontractor user' }, { status: 400 })
      if (!prof.company_id) return Response.json({ error: 'That user is not linked to a company.' }, { status: 400 })
      const { error } = await adminSupabase.from('profiles').update(update).eq('id', body.user_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      // Old values as the panel shows them (null job_access = 'company', null can_bill = true).
      const before = { job_access: prof.job_access || 'company', can_bill: prof.can_bill !== false }
      const changed = Object.keys(update).filter(k => String(before[k]) !== String(update[k]))
      if (changed.length) {
        const note = await companyNote(prof.company_id, 'Sub portal permission')
        await Promise.all(changed.map(k => logChange({
          job_id: null, entity_type: 'profile', entity_id: body.user_id, field_name: k,
          old_value: String(before[k]), new_value: String(update[k]), changed_by: auth.userId, note,
        })))
      }
      return Response.json({ ok: true })
    }
    if (body.contact_id) {
      const { data: contact, error: cErr } = await adminSupabase.from('company_contacts').select('id, company_id, full_name, email, phone, title').eq('id', body.contact_id).maybeSingle()
      if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
      if (!contact) return Response.json({ error: 'Contact not found.' }, { status: 404 })
      const denied = await denyManage(auth, contact.company_id)
      if (denied) return denied
      const update = {}
      for (const k of ['full_name', 'email', 'phone', 'title']) {
        if (body[k] !== undefined) update[k] = k === 'email' ? (body[k]?.trim().toLowerCase() || null) : (body[k]?.trim() || null)
      }
      const { error } = await adminSupabase.from('company_contacts').update(update).eq('id', body.contact_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      const changed = Object.keys(update).filter(k => (contact[k] ?? null) !== (update[k] ?? null))
      if (changed.length) {
        const note = await companyNote(contact.company_id, 'Contact edited')
        await Promise.all(changed.map(k => logChange({
          job_id: null, entity_type: 'company_contact', entity_id: contact.id, field_name: k,
          old_value: contact[k] ?? null, new_value: update[k] ?? null, changed_by: auth.userId, note,
        })))
      }
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'user_id or contact_id required' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE { contact_id } → remove a contact. Portal users are removed from the Directory's Portal Access list instead.
export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { contact_id } = await request.json()
    if (!contact_id) return Response.json({ error: 'contact_id required' }, { status: 400 })
    const { data: contact, error: cErr } = await adminSupabase.from('company_contacts').select('id, company_id, full_name, email').eq('id', contact_id).maybeSingle()
    if (cErr) return Response.json({ error: cErr.message }, { status: 500 })
    if (!contact) return Response.json({ error: 'Contact not found.' }, { status: 404 })
    const denied = await denyManage(auth, contact.company_id)
    if (denied) return denied
    const { error } = await adminSupabase.from('company_contacts').delete().eq('id', contact_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await logChange({
      job_id: null, entity_type: 'company_contact', entity_id: contact.id, field_name: 'contact',
      old_value: contactLabel(contact), new_value: null, changed_by: auth.userId,
      note: await companyNote(contact.company_id, 'Contact removed'),
    })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
