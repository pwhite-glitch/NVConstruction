import { createClient } from '@supabase/supabase-js'
import { requirePM } from '../../../lib/server-auth'
import { denyJob, denyJobOf, denyJobs, isJobLimited } from '../../../lib/roles'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const { job_id, sub_email, sub_id, company_id, invited_at, billing_enabled } = body
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
    if (!sub_email && !company_id) return Response.json({ error: 'sub_email or company_id required' }, { status: 400 })
    const denied = await denyJob(adminSupabase, auth, job_id)
    if (denied) return denied

    const row = { job_id }
    if (sub_email) row.sub_email = sub_email.toLowerCase().trim()
    if (invited_at) row.invited_at = invited_at
    // Omitted → DB default (true). The job page / dashboard "Assign" step passes false.
    if (typeof billing_enabled === 'boolean') row.billing_enabled = billing_enabled

    // Resolve sub_id from email if not provided
    let resolvedSubId = sub_id || null
    if (!resolvedSubId && sub_email) {
      const { data: prof } = await adminSupabase
        .from('profiles')
        .select('id, company_id')
        .ilike('invite_email', sub_email.toLowerCase().trim())
        .maybeSingle()
      resolvedSubId = prof?.id || null
      if (!row.company_id && prof?.company_id) row.company_id = prof.company_id
    }
    if (resolvedSubId) row.sub_id = resolvedSubId
    if (company_id) row.company_id = company_id

    const { error } = await adminSupabase.from('job_assignments').insert(row)
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'Already assigned to this job.' }, { status: 409 })
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Turn billing on/off for one or more assignment rows. Sends no email or notification.
export async function PATCH(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { ids, billing_enabled } = await request.json()
    if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'ids required' }, { status: 400 })
    if (typeof billing_enabled !== 'boolean') return Response.json({ error: 'billing_enabled must be true or false' }, { status: 400 })
    if (isJobLimited(auth.role)) {
      const { data: rows, error: rowsErr } = await adminSupabase.from('job_assignments').select('job_id').in('id', ids)
      if (rowsErr) return Response.json({ error: rowsErr.message }, { status: 500 })
      const denied = await denyJobs(adminSupabase, auth, (rows || []).map(r => r.job_id))
      if (denied) return denied
    }
    const { error } = await adminSupabase.from('job_assignments').update({
      billing_enabled,
      billing_enabled_at: billing_enabled ? new Date().toISOString() : null,
      billing_enabled_by: billing_enabled ? auth.userId : null,
    }).in('id', ids)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  const auth = await requirePM(request)
  if (auth.error) return auth.error
  try {
    const { id, job_id } = await request.json()
    const denied = id ? await denyJobOf(adminSupabase, auth, 'job_assignments', id) : (job_id ? await denyJob(adminSupabase, auth, job_id) : null)
    if (denied) return denied
    if (id) {
      await adminSupabase.from('job_assignments').delete().eq('id', id)
    } else if (job_id) {
      await adminSupabase.from('job_assignments').delete().eq('job_id', job_id)
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
