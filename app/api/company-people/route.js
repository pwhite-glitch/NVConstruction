import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { getCompanyPeople, SUB_ROLE_LIST } from '../../../lib/sub-access'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET ?company_id= | ?company_name= [&job_id=] → everyone at the company
// (portal users, contacts, directory contacts) merged by email. With job_id,
// each person also carries their access/billing state on that job.
export async function GET(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const result = await getCompanyPeople({
      companyId: searchParams.get('company_id') || null,
      companyName: searchParams.get('company_name') || null,
      email: searchParams.get('email') || null,
      jobId: searchParams.get('job_id') || null,
    })
    return Response.json(result)
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
      const { data: prof } = await adminSupabase.from('profiles').select('role').eq('id', body.user_id).maybeSingle()
      if (!SUB_ROLE_LIST.includes(prof?.role)) return Response.json({ error: 'Not a subcontractor user' }, { status: 400 })
      const { error } = await adminSupabase.from('profiles').update(update).eq('id', body.user_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ ok: true })
    }
    if (body.contact_id) {
      const update = {}
      for (const k of ['full_name', 'email', 'phone', 'title']) {
        if (body[k] !== undefined) update[k] = k === 'email' ? (body[k]?.trim().toLowerCase() || null) : (body[k]?.trim() || null)
      }
      const { error } = await adminSupabase.from('company_contacts').update(update).eq('id', body.contact_id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
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
    const { error } = await adminSupabase.from('company_contacts').delete().eq('id', contact_id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
