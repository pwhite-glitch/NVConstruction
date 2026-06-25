import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const body = await request.json()
    const { job_id, sub_email, sub_id, company_id, invited_at } = body
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 })
    if (!sub_email && !company_id) return Response.json({ error: 'sub_email or company_id required' }, { status: 400 })

    const row = { job_id }
    if (sub_email) row.sub_email = sub_email.toLowerCase().trim()
    if (invited_at) row.invited_at = invited_at

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

export async function DELETE(request) {
  try {
    const { id, job_id } = await request.json()
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
